import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace } from "@/lib/api-helpers";
import { z } from "zod";

type Params = { params: Promise<{ clientId: string }> };

const schema = z.object({
  tagId: z.string(),
  action: z.enum(["add", "remove"]),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: workspace.id },
  });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  if (parsed.data.action === "add") {
    const tag = await prisma.tag.findFirst({
      where: { id: parsed.data.tagId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!tag) return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    await prisma.clientTag.upsert({
      where: { clientId_tagId: { clientId, tagId: parsed.data.tagId } },
      update: {},
      create: { clientId, tagId: parsed.data.tagId },
    });
  } else {
    await prisma.clientTag.deleteMany({
      where: { clientId, tagId: parsed.data.tagId },
    });
  }

  const tags = await prisma.clientTag.findMany({
    where: { clientId },
    include: { tag: true },
  });

  return NextResponse.json(tags.map((t) => t.tag));
}
