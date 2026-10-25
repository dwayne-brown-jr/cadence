import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace, requireRole } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

type Params = { params: Promise<{ ruleId: string }> };

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  templateId: z.string().optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ruleId } = await params;
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const existing = await prisma.automationRule.findFirst({
    where: { id: ruleId, workspaceId: workspace.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { triggerConfig, ...rest } = parsed.data;

  if (rest.templateId) {
    const template = await prisma.emailTemplate.findFirst({
      where: { id: rest.templateId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const rule = await prisma.automationRule.update({
    where: { id: ruleId },
    data: {
      ...rest,
      ...(triggerConfig !== undefined
        ? { triggerConfig: JSON.stringify(triggerConfig) }
        : {}),
    },
    include: {
      template: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true } },
    },
  });

  logAudit({
    action: "AUTOMATION_UPDATED",
    description: `Updated automation rule "${rule.name}"`,
    metadata: { ruleId, changes: Object.keys(parsed.data) },
    userId,
    workspaceId: workspace.id,
  }).catch(console.error);

  return NextResponse.json(rule);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { ruleId } = await params;
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, member, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const roleError = requireRole(member!, "ADMIN");
  if (roleError) return roleError;

  const existing = await prisma.automationRule.findFirst({
    where: { id: ruleId, workspaceId: workspace.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.automationRule.delete({ where: { id: ruleId } });

  logAudit({
    action: "AUTOMATION_DELETED",
    description: `Deleted automation rule "${existing.name}"`,
    metadata: { ruleId },
    userId,
    workspaceId: workspace.id,
  }).catch(console.error);

  return NextResponse.json({ ok: true });
}
