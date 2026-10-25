import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findPipelineInWorkspace, findStageInWorkspace, notFound } from "@/lib/tenant";
import { requireAuth, requireWorkspace, requireRole } from "@/lib/api-helpers";
import { importSchema, importClientSchema } from "@/lib/validations";

export async function POST(req: NextRequest) {
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, member, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const roleError = requireRole(member!, "ADMIN");
  if (roleError) return roleError;

  const body = await req.json();
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { clients: rows, pipelineId, stageId } = parsed.data;

  if (pipelineId && !(await findPipelineInWorkspace(pipelineId, workspace.id))) {
    return notFound("Pipeline");
  }
  if (stageId) {
    const stage = await findStageInWorkspace(stageId, workspace.id);
    if (!stage || (pipelineId && stage.pipelineId !== pipelineId)) return notFound("Stage");
  }

  // Resolve default pipeline and stage if not provided
  let resolvedPipelineId = pipelineId;
  let resolvedStageId = stageId;

  if (!resolvedPipelineId) {
    const defaultPipeline = await prisma.pipeline.findFirst({
      where: { workspaceId: workspace.id, isDefault: true },
      include: { stages: { orderBy: { order: "asc" }, take: 1 } },
    });
    if (defaultPipeline) {
      resolvedPipelineId = defaultPipeline.id;
      if (!resolvedStageId) {
        resolvedStageId = defaultPipeline.stages[0]?.id;
      }
    }
  }

  const created: string[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const valid = importClientSchema.safeParse(row);
    if (!valid.success) {
      errors.push({ row: i + 1, message: valid.error.issues[0].message });
      continue;
    }

    try {
      const client = await prisma.client.create({
        data: {
          name: row.name,
          email: row.email || null,
          phone: row.phone || null,
          companyName: row.companyName || null,
          projectType: row.projectType || null,
          projectValue: row.projectValue ?? null,
          source: "IMPORT",
          workspaceId: workspace.id,
          pipelineId: resolvedPipelineId,
          currentStageId: resolvedStageId,
        },
      });

      await prisma.activity.create({
        data: {
          type: "CLIENT_CREATED",
          title: `${client.name} was imported`,
          clientId: client.id,
          userId,
        },
      });

      created.push(client.id);
    } catch (err) {
      errors.push({ row: i + 1, message: "Failed to create client" });
    }
  }

  return NextResponse.json({
    created: created.length,
    skipped: errors.length,
    errors,
    total: rows.length,
  });
}
