import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api-helpers";
import {
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

const answersSchema = z.object({
  // Step 1 invites detail ("be as specific as you like"), so allow a full
  // paragraph — consistent with the other free-text fields.
  businessType: z.string().min(1).max(2000),
  services: z.string().min(10).max(2000),
  clientJourney: z.string().min(10).max(2000),
  painPoints: z.string().min(5).max(2000),
  tone: z.enum(["formal", "professional", "friendly"]),
  teamSize: z.string().min(1).max(50),
});

const FIELD_LABELS: Record<string, string> = {
  businessType: "Business type",
  services: "Services",
  clientJourney: "Client journey",
  painPoints: "Pain points",
  tone: "Tone",
  teamSize: "Team size",
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = answersSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = FIELD_LABELS[String(issue.path[0])] ?? "Answer";
    return NextResponse.json(
      { error: `${field}: ${issue.message}` },
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

  // Serverless: offload the ~84s Claude call to a background function and let
  // the client poll /api/onboarding/status for completion.
  if (runsAsync()) {
    await triggerBackgroundGeneration({
      workspaceId: member.workspaceId,
      origin: requestOrigin(req),
      kind: "answers",
      answers: parsed.data,
    });
    return NextResponse.json({ status: "processing" });
  }

  // Inline path (local dev / long-running hosts with no function timeout).
  const generated = await generateWorkspaceFromAnswers(parsed.data);
  if (!generated) {
    return NextResponse.json(
      { error: "Failed to generate workspace. Please try again or skip setup." },
      { status: 502 }
    );
  }

  let config;
  try {
    config = validateWorkspaceConfig(generatedToWorkspaceConfig(generated));
  } catch (err) {
    console.error("[Onboarding generate] Invalid generated config:", err);
    return NextResponse.json(
      { error: "Generated workspace was invalid. Please try again." },
      { status: 502 }
    );
  }

  try {
    await persistWorkspaceConfig(member.workspaceId, config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Onboarding generate] DB error:", err);
    return NextResponse.json(
      { error: "Failed to save workspace configuration" },
      { status: 500 }
    );
  }
}
