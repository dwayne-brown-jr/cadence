import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace, requireRole } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { z } from "zod";
import { randomBytes } from "crypto";
import { escapeHtml } from "@/lib/utils";

const invitationPublicFields = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
  workspaceId: true,
  invitedById: true,
  invitedBy: { select: { name: true, email: true } },
} as const;

const createSchema = z.object({
  email: z.string().email("Invalid email"),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export async function GET() {
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  // Never return the token: holding it is enough to accept the invite.
  const invitations = await prisma.invitation.findMany({
    where: { workspaceId: workspace.id, acceptedAt: null },
    orderBy: { createdAt: "desc" },
    select: invitationPublicFields,
  });

  return NextResponse.json(invitations);
}

export async function POST(req: NextRequest) {
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, member, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const roleError = requireRole(member!, "ADMIN");
  if (roleError) return roleError;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { email, role } = parsed.data;

  // Check if already a member
  const existingMember = await prisma.user.findFirst({
    where: {
      email,
      workspaces: { some: { workspaceId: workspace.id } },
    },
  });
  if (existingMember) {
    return NextResponse.json(
      { error: "This person is already a member of your workspace." },
      { status: 409 }
    );
  }

  // Check for existing pending invite
  await prisma.invitation.deleteMany({
    where: {
      workspaceId: workspace.id,
      email,
      acceptedAt: null,
    },
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = await prisma.invitation.create({
    data: {
      email,
      role,
      expiresAt,
      workspaceId: workspace.id,
      invitedById: userId,
      token: randomBytes(32).toString("base64url"),
    },
    include: { invitedBy: { select: { name: true, email: true } } },
  });

  // Send invite email (non-blocking)
  const inviteUrl = `${process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3002"}/invite/${invitation.token}`;
  sendEmail({
    to: email,
    subject: `You've been invited to join ${workspace.name} on Cadence`,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color: #1E3A5F;">You're invited!</h2>
        <p>${escapeHtml(invitation.invitedBy.name ?? invitation.invitedBy.email)} has invited you to join <strong>${escapeHtml(workspace.name)}</strong> on Cadence as a ${role.charAt(0) + role.slice(1).toLowerCase()}.</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}" style="background:#1E3A5F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Accept Invitation
          </a>
        </p>
        <p style="color:#888;font-size:13px;">This link expires in 7 days. If you didn't expect this invitation, you can safely ignore this email.</p>
      </div>
    `,
  }).catch(console.error);

  logAudit({
    action: "INVITATION_CREATED",
    description: `Invited ${email} as ${role}`,
    metadata: { invitationId: invitation.id, email, role },
    userId,
    workspaceId: workspace.id,
  }).catch(console.error);

  const { token: _token, ...publicInvitation } = invitation;
  return NextResponse.json(publicInvitation, { status: 201 });
}
