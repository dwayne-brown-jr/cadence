import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace, requireRole } from "@/lib/api-helpers";
import { updateClientSchema, type UpdateClientInput } from "@/lib/validations";
import { logAudit } from "@/lib/audit";
import { encrypt, decrypt } from "@/lib/encryption";
import { allCustomFieldsInWorkspace, findPipelineInWorkspace, isWorkspaceMember, notFound } from "@/lib/tenant";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  try {
    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId: workspace.id },
      include: {
        currentStage: true,
        pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
        assignedTo: { select: { id: true, name: true, image: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { user: { select: { id: true, name: true, image: true } } },
        },
        stageCompletions: true,
        emailLogs: { orderBy: { sentAt: "desc" }, take: 10 },
        customFieldValues: true,
        tags: { include: { tag: true } },
      },
    });

    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let phone = client.phone;
    try {
      phone = phone ? decrypt(phone) : null;
    } catch {
      // decrypt may fail if crypto not available — return raw value
    }

    return NextResponse.json({ ...client, phone });
  } catch (err) {
    console.error("[client GET] Error:", err);
    return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const { session, userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const existing = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: workspace.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { customFields, ...rest } = body;
  const parsed = updateClientSchema.safeParse(rest);
  if (!parsed.success && Object.keys(rest).length > 0) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // stageId and skipDuplicateCheck aren't client columns; stage moves go through /move.
  const data: UpdateClientInput = parsed.success ? parsed.data : {};
  const { stageId: _stageId, skipDuplicateCheck: _skip, ...fields } = data;

  if (fields.assignedToId && !(await isWorkspaceMember(fields.assignedToId, workspace.id))) {
    return notFound("Assignee");
  }
  if (fields.pipelineId && !(await findPipelineInWorkspace(fields.pipelineId, workspace.id))) {
    return notFound("Pipeline");
  }
  const hasCustomFields = customFields && typeof customFields === "object";
  if (hasCustomFields && !(await allCustomFieldsInWorkspace(Object.keys(customFields), workspace.id))) {
    return notFound("Custom field");
  }

  // Update standard fields if provided
  if (Object.keys(fields).length > 0) {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        ...fields,
        email: fields.email === "" ? null : fields.email,
        ...(fields.phone !== undefined && { phone: fields.phone ? encrypt(fields.phone) : null }),
      },
    });
  }

  // Update custom field values if provided
  if (hasCustomFields) {
    for (const [fieldId, value] of Object.entries(customFields as Record<string, string>)) {
      await prisma.customFieldValue.upsert({
        where: { customFieldId_clientId: { customFieldId: fieldId, clientId } },
        update: { value: String(value) },
        create: { customFieldId: fieldId, clientId, value: String(value) },
      });
    }
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { customFieldValues: true },
  });

  return NextResponse.json(client ? { ...client, phone: client.phone ? decrypt(client.phone) : null } : client);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const { session, userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, member, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const roleError = requireRole(member!, "ADMIN");
  if (roleError) return roleError;

  const existing = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: workspace.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.client.delete({ where: { id: clientId } });

  logAudit({
    action: "CLIENT_DELETED",
    description: `Deleted client "${existing.name}"`,
    userId,
    workspaceId: workspace.id,
  }).catch(console.error);

  return NextResponse.json({ ok: true });
}
