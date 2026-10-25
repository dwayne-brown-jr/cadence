import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api-helpers";
import { getBlueprint } from "@/lib/templates";
import {
  validateWorkspaceConfig,
  persistWorkspaceConfig,
} from "@/lib/workspace-setup";

const bodySchema = z.object({
  blueprintId: z.string().min(1),
});

// On-ramp #1: deterministic curated template. No AI call.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const blueprint = getBlueprint(parsed.data.blueprintId);
  if (!blueprint) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
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

  // Validate the curated config through the same gate as AI output.
  let config;
  try {
    config = validateWorkspaceConfig(blueprint.config);
  } catch (err) {
    console.error("[Onboarding template] Invalid blueprint config:", err);
    return NextResponse.json(
      { error: "Template configuration is invalid" },
      { status: 500 }
    );
  }

  try {
    await persistWorkspaceConfig(member.workspaceId, config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Onboarding template] DB error:", err);
    return NextResponse.json(
      { error: "Failed to save workspace configuration" },
      { status: 500 }
    );
  }
}
