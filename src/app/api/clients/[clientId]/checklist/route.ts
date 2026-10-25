import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace } from "@/lib/api-helpers";

type Params = { params: Promise<{ clientId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const existing = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: workspace.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { stageId, checklistItemId, completed } = await req.json();
  if (!stageId || !checklistItemId) {
    return NextResponse.json({ error: "stageId and checklistItemId required" }, { status: 400 });
  }

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, pipeline: { workspaceId: workspace.id } },
    select: { id: true },
  });
  if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });

  if (completed) {
    await prisma.stageCompletion.upsert({
      where: {
        clientId_stageId_checklistItemId: { clientId, stageId, checklistItemId },
      },
      update: {},
      create: { clientId, stageId, checklistItemId, completedBy: userId },
    });
  } else {
    await prisma.stageCompletion.deleteMany({
      where: { clientId, stageId, checklistItemId },
    });
  }

  return NextResponse.json({ ok: true });
}
