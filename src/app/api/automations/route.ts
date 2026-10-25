import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findStageInWorkspace, notFound } from "@/lib/tenant";
import { requireAuth, requireWorkspace } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  triggerType: z.enum(["CLIENT_CREATED", "STAGE_ENTRY", "TIME_IN_STAGE", "WEEKLY_SUMMARY"]),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  actionType: z.string().default("SEND_EMAIL"),
  actionConfig: z.record(z.string(), z.unknown()).default({}),
  templateId: z.string().min(1).optional(),
  stageId: z.string().optional(),
});

export async function GET() {
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const rules = await prisma.automationRule.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
    include: {
      template: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(rules);
}

export async function POST(req: NextRequest) {
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Verify template belongs to workspace (only if templateId provided)
  if (parsed.data.templateId) {
    const template = await prisma.emailTemplate.findFirst({
      where: { id: parsed.data.templateId, workspaceId: workspace.id },
    });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
  }

  if (parsed.data.stageId && !(await findStageInWorkspace(parsed.data.stageId, workspace.id))) {
    return notFound("Stage");
  }

  const rule = await prisma.automationRule.create({
    data: {
      name: parsed.data.name,
      triggerType: parsed.data.triggerType,
      triggerConfig: JSON.stringify(parsed.data.triggerConfig),
      actionType: parsed.data.actionType,
      actionConfig: JSON.stringify(parsed.data.actionConfig),
      templateId: parsed.data.templateId ?? null,
      stageId: parsed.data.stageId ?? null,
      workspaceId: workspace.id,
    },
    include: {
      template: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true } },
    },
  });

  logAudit({
    action: "AUTOMATION_CREATED",
    description: `Created automation rule "${parsed.data.name}"`,
    metadata: { ruleId: rule.id, triggerType: parsed.data.triggerType },
    userId,
    workspaceId: workspace.id,
  }).catch(console.error);

  return NextResponse.json(rule, { status: 201 });
}
