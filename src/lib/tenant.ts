import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

/**
 * Ownership checks for IDs that arrive in a request body or query string.
 * Those IDs are untrusted: always confirm the record belongs to the caller's
 * workspace before writing it onto another row.
 */

export function findStageInWorkspace(stageId: string, workspaceId: string) {
  return prisma.stage.findFirst({
    where: { id: stageId, pipeline: { workspaceId } },
    select: { id: true, pipelineId: true },
  });
}

export function findPipelineInWorkspace(pipelineId: string, workspaceId: string) {
  return prisma.pipeline.findFirst({
    where: { id: pipelineId, workspaceId },
    select: { id: true },
  });
}

export async function isWorkspaceMember(userId: string, workspaceId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  return !!member;
}

export async function allCustomFieldsInWorkspace(fieldIds: string[], workspaceId: string) {
  if (fieldIds.length === 0) return true;
  const count = await prisma.customField.count({
    where: { id: { in: fieldIds }, workspaceId },
  });
  return count === new Set(fieldIds).size;
}

export function notFound(what: string) {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 });
}
