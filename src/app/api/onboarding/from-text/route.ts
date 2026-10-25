import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api-helpers";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  extractOnboardingAnswers,
  generateWorkspaceFromAnswers,
  generatedToWorkspaceConfig,
} from "@/lib/onboarding-ai";
import {
  validateWorkspaceConfig,
  persistWorkspaceConfig,
} from "@/lib/workspace-setup";
import {
  runsAsync,
  requestOrigin,
  triggerBackgroundGeneration,
} from "@/lib/onboarding-trigger";

export const MAX_DOC_CHARS = 12_000;

const bodySchema = z.object({
  text: z.string().trim().min(40).max(MAX_DOC_CHARS),
});

// On-ramp #3: paste a description / SOP / process doc. Extract the six
// questionnaire fields, then reuse the existing generation + persistence path.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Graceful degradation — this on-ramp requires the AI surface.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI setup is not available. Please pick a template instead." },
      { status: 503 }
    );
  }

  // Reuse the Upstash limiter (per-user) on this AI endpoint.
  const { success, resetAt } = await rateLimit({
    key: `onboarding-ai:${session.user.id}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (!success) return rateLimitResponse(resetAt);

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  if (!member) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  // Setup replaces the workspace's pipelines, templates and automations.
  const roleError = requireRole(member, "ADMIN");
  if (roleError) return roleError;

  if (member.workspace.onboardingCompleted) {
    return NextResponse.json(
      { error: "Onboarding already completed" },
      { status: 400 }
    );
  }

  // Serverless: offload extraction + generation to a background function.
  if (runsAsync()) {
    await triggerBackgroundGeneration({
      workspaceId: member.workspaceId,
      origin: requestOrigin(req),
      kind: "text",
      text: parsed.data.text,
    });
    return NextResponse.json({ status: "processing" });
  }

  // Inline path (local dev / long-running hosts).
  // Step A — extract the six fields from the pasted text.
  const answers = await extractOnboardingAnswers(parsed.data.text);
  if (!answers) {
    return NextResponse.json(
      { error: "Couldn't read that document. Try adding more detail or use the questionnaire." },
      { status: 502 }
    );
  }

  // Step B — reuse the existing generator.
  const generated = await generateWorkspaceFromAnswers(answers);
  if (!generated) {
    return NextResponse.json(
      { error: "Failed to generate workspace. Please try again." },
      { status: 502 }
    );
  }

  // Normalize → validate → persist through the shared path.
  let config;
  try {
    config = validateWorkspaceConfig(generatedToWorkspaceConfig(generated));
  } catch (err) {
    console.error("[Onboarding from-text] Invalid generated config:", err);
    return NextResponse.json(
      { error: "Generated workspace was invalid. Please try again." },
      { status: 502 }
    );
  }

  try {
    await persistWorkspaceConfig(member.workspaceId, config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Onboarding from-text] DB error:", err);
    return NextResponse.json(
      { error: "Failed to save workspace configuration" },
      { status: 500 }
    );
  }
}
