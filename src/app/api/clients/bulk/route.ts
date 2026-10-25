import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findStageInWorkspace, isWorkspaceMember, notFound } from "@/lib/tenant";
import { requireAuth, requireWorkspace, requireRole } from "@/lib/api-helpers";
import { bulkActionSchema } from "@/lib/validations";

export async function POST(req: NextRequest) {
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, member, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const body = await req.json();
  const parsed = bulkActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { action, clientIds, data } = parsed.data;

  // DELETE requires ADMIN
  if (action === "DELETE") {
    const roleError = requireRole(member!, "ADMIN");
    if (roleError) return roleError;
  }

  // Verify all clients belong to this workspace
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds }, workspaceId: workspace.id },
    select: { id: true },
  });
  if (clients.length !== clientIds.length) {
    return NextResponse.json({ error: "Some clients were not found" }, { status: 400 });
  }

  let affected = 0;

  switch (action) {
    case "MOVE_STAGE": {
      if (!data?.stageId) {
        return NextResponse.json({ error: "stageId is required" }, { status: 400 });
      }
      const stage = await findStageInWorkspace(data.stageId, workspace.id);
      if (!stage) return notFound("Stage");
      const result = await prisma.client.updateMany({
        where: { id: { in: clientIds } },
        data: { currentStageId: stage.id, pipelineId: stage.pipelineId, stageEnteredAt: new Date() },
      });
      affected = result.count;
      break;
    }
    case "CHANGE_STATUS": {
      if (!data?.status) {
        return NextResponse.json({ error: "status is required" }, { status: 400 });
      }
      const result = await prisma.client.updateMany({
        where: { id: { in: clientIds } },
        data: { status: data.status },
      });
      affected = result.count;
      break;
    }
    case "ASSIGN": {
      if (data?.assignedToId && !(await isWorkspaceMember(data.assignedToId, workspace.id))) {
        return notFound("Assignee");
      }
      const result = await prisma.client.updateMany({
        where: { id: { in: clientIds } },
        data: { assignedToId: data?.assignedToId ?? null },
      });
      affected = result.count;
      break;
    }
    case "DELETE": {
      const result = await prisma.client.deleteMany({
        where: { id: { in: clientIds } },
      });
      affected = result.count;
      break;
    }
  }

  return NextResponse.json({ ok: true, affected });
}
