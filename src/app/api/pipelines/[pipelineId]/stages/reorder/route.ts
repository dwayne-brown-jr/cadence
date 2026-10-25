import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace } from "@/lib/api-helpers";

type Params = { params: Promise<{ pipelineId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { pipelineId } = await params;
  const { session, userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, workspaceId: workspace.id },
  });
  if (!pipeline) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { stageIds } = await req.json();
  if (!Array.isArray(stageIds)) {
    return NextResponse.json({ error: "stageIds must be an array" }, { status: 400 });
  }

  // Only stages of this pipeline may be reordered.
  const owned = await prisma.stage.count({ where: { id: { in: stageIds }, pipelineId } });
  if (owned !== new Set(stageIds).size) {
    return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  }

  await prisma.$transaction(
    stageIds.map((id: string, index: number) =>
      prisma.stage.update({ where: { id }, data: { order: index } })
    )
  );

  return NextResponse.json({ ok: true });
}
