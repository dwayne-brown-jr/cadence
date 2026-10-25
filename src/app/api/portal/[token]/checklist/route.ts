import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ token: string }> };

const schema = z.object({
  checklistItemId: z.string(),
  stageId: z.string(),
  completed: z.boolean(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;

  const client = await prisma.client.findUnique({
    where: { portalToken: token },
    select: { id: true, workspaceId: true, workspace: { select: { portalEnabled: true } } },
  });
  if (!client || !client.workspace.portalEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { checklistItemId, stageId, completed } = parsed.data;

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, pipeline: { workspaceId: client.workspaceId } },
    select: { id: true },
  });
  if (!stage) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (completed) {
    await prisma.stageCompletion.upsert({
      where: {
        clientId_stageId_checklistItemId: {
          clientId: client.id,
          stageId,
          checklistItemId,
        },
      },
      update: {},
      create: {
        clientId: client.id,
        stageId,
        checklistItemId,
        completedBy: "portal",
      },
    });
  } else {
    await prisma.stageCompletion.deleteMany({
      where: { clientId: client.id, stageId, checklistItemId },
    });
  }

  return NextResponse.json({ ok: true });
}
