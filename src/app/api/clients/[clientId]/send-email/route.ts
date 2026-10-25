import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWorkspace } from "@/lib/api-helpers";
import { sendEmail, applyMergeFields, generateTrackingId, type MergeFields } from "@/lib/email";
import { z } from "zod";
import { sanitizeEmailHtml } from "@/lib/sanitize-html";

type Params = { params: Promise<{ clientId: string }> };

const schema = z.object({
  templateId: z.string().optional(),
  subject: z.string().min(1, "Subject is required").optional(),
  body: z.string().min(1, "Body is required").optional(),
}).refine(
  (d) => d.templateId || (d.subject && d.body),
  { message: "Provide either a templateId or subject + body" }
);

export async function POST(req: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const { userId, error } = await requireAuth();
  if (error) return error;
  const { workspace, error: wsError } = await requireWorkspace(userId);
  if (wsError) return wsError;

  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: workspace.id },
    include: { currentStage: { select: { name: true } } },
  });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.email) return NextResponse.json({ error: "Client has no email address" }, { status: 400 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let subject: string;
  let htmlBody: string;
  let templateName = "Manual email";

  if (parsed.data.templateId) {
    const template = await prisma.emailTemplate.findFirst({
      where: { id: parsed.data.templateId, workspaceId: workspace.id },
    });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    subject = template.subject;
    htmlBody = template.body;
    templateName = template.name;
  } else {
    subject = parsed.data.subject!;
    htmlBody = parsed.data.body!;
  }

  // Build merge fields
  const daysInStage = Math.floor(
    (Date.now() - new Date(client.stageEnteredAt).getTime()) / 86_400_000
  );
  const portalUrl = client.portalToken
    ? `${process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3002"}/portal/${client.portalToken}`
    : "";

  const mergeFields: MergeFields = {
    client_name: client.name,
    client_email: client.email ?? "",
    client_phone: client.phone ?? "",
    project_type: client.projectType ?? "",
    project_value: client.projectValue?.toString() ?? "",
    stage_name: client.currentStage?.name ?? "",
    workspace_name: workspace.name,
    company_name: client.companyName ?? "",
    portal_url: portalUrl,
    days_in_stage: String(daysInStage),
  };

  const finalSubject = applyMergeFields(subject, mergeFields);
  const finalBody = sanitizeEmailHtml(applyMergeFields(htmlBody, mergeFields, { html: true }));

  const trackingId = generateTrackingId();

  const result = await sendEmail({
    to: client.email,
    subject: finalSubject,
    html: finalBody,
    fromName: workspace.emailFromName ?? workspace.name,
    replyTo: workspace.emailReplyTo ?? undefined,
    trackingId,
  });

  const status = result.success ? "SENT" : "FAILED";

  // Log the email
  await prisma.emailLog.create({
    data: {
      subject: finalSubject,
      body: finalBody,
      status,
      trackingId,
      clientId: client.id,
      workspaceId: workspace.id,
      templateId: parsed.data.templateId ?? null,
    },
  });

  // Create activity
  await prisma.activity.create({
    data: {
      type: "EMAIL_SENT",
      title: `Email sent: ${templateName}`,
      description: `To: ${client.email}`,
      clientId: client.id,
      userId,
    },
  });

  if (!result.success) {
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
