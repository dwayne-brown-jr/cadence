import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace } from "@/lib/api-helpers";
import { createClientSchema } from "@/lib/validations";
import { fireAutomations } from "@/lib/automation-engine";
import { notifyWorkspaceMembers } from "@/lib/notifications";
import { fireWebhooks } from "@/lib/webhooks";
import { encrypt, decrypt } from "@/lib/encryption";
import { findPipelineInWorkspace, findStageInWorkspace, isWorkspaceMember, notFound } from "@/lib/tenant";

export async function GET(req: NextRequest) {
  const { session, userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const { searchParams } = new URL(req.url);
  const pipelineId = searchParams.get("pipelineId");
  const stageId = searchParams.get("stageId");
  const status = searchParams.get("status");

  try {
    const clients = await prisma.client.findMany({
      where: {
        workspaceId: workspace.id,
        ...(pipelineId && { pipelineId }),
        ...(stageId && { currentStageId: stageId }),
        status: status ?? "ACTIVE",
      },
      include: {
        currentStage: {
          select: { id: true, name: true, color: true, daysExpected: true },
        },
        assignedTo: { select: { id: true, name: true, image: true } },
        stageCompletions: { select: { checklistItemId: true, stageId: true } },
      },
      orderBy: { stageEnteredAt: "asc" },
    });

    // Decrypt PII fields before returning
    const decrypted = clients.map((c) => {
      let phone = c.phone;
      try { phone = phone ? decrypt(phone) : null; } catch { /* no-op */ }
      return { ...c, phone };
    });

    return NextResponse.json(decrypted);
  } catch (err) {
    console.error("[clients GET] Error:", err);
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const body = await req.json();
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { pipelineId, stageId: initialStageId, skipDuplicateCheck, ...rest } = parsed.data;

  // Duplicate detection
  if (!skipDuplicateCheck && rest.email) {
    const duplicate = await prisma.client.findFirst({
      where: { workspaceId: workspace.id, email: rest.email },
      select: { id: true, name: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "A client with this email already exists in your workspace", duplicate: true, existingClientId: duplicate.id },
        { status: 409 }
      );
    }
  }

  if (rest.assignedToId && !(await isWorkspaceMember(rest.assignedToId, workspace.id))) {
    return notFound("Assignee");
  }
  if (pipelineId && !(await findPipelineInWorkspace(pipelineId, workspace.id))) {
    return notFound("Pipeline");
  }

  let currentStageId: string | undefined;
  let resolvedPipelineId = pipelineId;

  if (initialStageId) {
    // Caller specified an exact stage — find its pipeline
    const stage = await findStageInWorkspace(initialStageId, workspace.id);
    if (!stage) return notFound("Stage");
    currentStageId = stage.id;
    resolvedPipelineId = stage.pipelineId;
  } else if (pipelineId) {
    const firstStage = await prisma.stage.findFirst({
      where: { pipelineId },
      orderBy: { order: "asc" },
    });
    currentStageId = firstStage?.id;
  } else {
    const defaultPipeline = await prisma.pipeline.findFirst({
      where: { workspaceId: workspace.id, isDefault: true },
      include: { stages: { orderBy: { order: "asc" }, take: 1 } },
    });
    if (defaultPipeline) {
      resolvedPipelineId = defaultPipeline.id;
      currentStageId = defaultPipeline.stages[0]?.id;
    }
  }

  const client = await prisma.client.create({
    data: {
      ...rest,
      email: rest.email || null,
      phone: rest.phone ? encrypt(rest.phone) : null,
      workspaceId: workspace.id,
      pipelineId: resolvedPipelineId,
      currentStageId,
    },
    include: {
      currentStage: { select: { id: true, name: true, color: true, daysExpected: true } },
      assignedTo: { select: { id: true, name: true, image: true } },
      stageCompletions: { select: { checklistItemId: true, stageId: true } },
    },
  });

  await prisma.activity.create({
    data: {
      type: "CLIENT_CREATED",
      title: `${client.name} was added`,
      clientId: client.id,
      userId,
    },
  });

  // Fire webhooks (non-blocking)
  fireWebhooks(workspace.id, "CLIENT_CREATED", {
    clientId: client.id,
    name: client.name,
    email: client.email,
    stage: client.currentStage?.name,
  }).catch(console.error);

  // Notify workspace members (non-blocking)
  notifyWorkspaceMembers(workspace.id, userId, {
    type: "CLIENT_CREATED",
    title: `New client: ${client.name}`,
    message: client.currentStage?.name ? `Added to ${client.currentStage.name}` : undefined,
    link: `/clients/${client.id}`,
  }).catch(console.error);

  // Fire automation rules (non-blocking — don't fail the request if automation fails)
  fireAutomations(
    { type: "CLIENT_CREATED" },
    { ...client, portalToken: client.portalToken ?? null, stageEnteredAt: client.stageEnteredAt ?? null },
    { ...workspace, portalEnabled: workspace.portalEnabled ?? false }
  ).catch(console.error);

  return NextResponse.json(client, { status: 201 });
}
