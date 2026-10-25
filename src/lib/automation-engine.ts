import { prisma } from "@/lib/prisma";
import { applyMergeFields, sendEmail, generateTrackingId, MergeFields } from "@/lib/email";
import { formatCurrency } from "@/lib/utils";
import { sanitizeEmailHtml } from "@/lib/sanitize-html";
import { generateWeeklySummaryEmail, type WorkspaceSummaryData } from "@/lib/ai-summary";

type TriggerEvent =
  | { type: "CLIENT_CREATED" }
  | { type: "STAGE_ENTRY"; stageId: string; fromStageId?: string }
  | { type: "TIME_IN_STAGE"; stageId: string; daysInStage: number };

type ClientForAutomation = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  projectType: string | null;
  projectValue: number | null;
  portalToken: string | null;
  stageEnteredAt: Date | null;
};

type WorkspaceForAutomation = {
  id: string;
  name: string;
  emailFromName: string | null;
  emailReplyTo: string | null;
  portalEnabled: boolean;
};

export async function fireAutomations(
  event: TriggerEvent,
  client: ClientForAutomation,
  workspace: WorkspaceForAutomation,
  stageName?: string
) {
  if (!client.email) return;

  const rules = await prisma.automationRule.findMany({
    where: { workspaceId: workspace.id, isActive: true, triggerType: event.type },
    include: { template: true },
  });

  for (const rule of rules) {
    if (!rule.template) continue;

    try {
      const config: Record<string, unknown> = JSON.parse(rule.triggerConfig || "{}");

      // Enhancement 1: from/to stage matching
      if (event.type === "STAGE_ENTRY") {
        if (config.stageId && config.stageId !== event.stageId) continue;
        if (config.fromStageId && config.fromStageId !== event.fromStageId) continue;
      }

      // Enhancement 2: gte matching + lifetime dedup for TIME_IN_STAGE
      if (event.type === "TIME_IN_STAGE") {
        if (config.stageId && config.stageId !== event.stageId) continue;
        // Fire when client has been in stage AT LEAST N days (not exact match)
        if (config.days && event.daysInStage < Number(config.days)) continue;
        // Lifetime dedup: only fire once per rule+client combo
        const prevSend = await prisma.emailLog.findFirst({
          where: { clientId: client.id, automationRuleId: rule.id },
          select: { id: true },
        });
        if (prevSend) continue;
      }
    } catch {
      continue;
    }

    // Enhancement 3: new merge fields
    const daysInStage = client.stageEnteredAt
      ? Math.floor((Date.now() - new Date(client.stageEnteredAt).getTime()) / 86400000)
      : 0;

    const portalUrl =
      client.portalToken && workspace.portalEnabled && process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/${client.portalToken}`
        : undefined;

    const mergeFields: MergeFields = {
      client_name: client.name,
      client_email: client.email ?? undefined,
      client_phone: client.phone ?? undefined,
      project_type: client.projectType ?? undefined,
      project_value: client.projectValue ? formatCurrency(client.projectValue) : undefined,
      stage_name: stageName ?? undefined,
      workspace_name: workspace.name,
      company_name: workspace.name,
      portal_url: portalUrl,
      days_in_stage: String(daysInStage),
    };

    const subject = applyMergeFields(rule.template.subject, mergeFields);
    const html = sanitizeEmailHtml(applyMergeFields(rule.template.body, mergeFields, { html: true }));

    const trackingId = generateTrackingId();

    const result = await sendEmail({
      to: client.email,
      subject,
      html,
      fromName: workspace.emailFromName ?? workspace.name,
      replyTo: workspace.emailReplyTo ?? undefined,
      trackingId,
    });

    await prisma.emailLog.create({
      data: {
        subject,
        body: html,
        status: result.success ? "SENT" : "FAILED",
        clientId: client.id,
        templateId: rule.template.id,
        automationRuleId: rule.id,
        trackingId,
      },
    });

    await prisma.activity.create({
      data: {
        type: "EMAIL_SENT",
        title: `Email sent: ${rule.template.name}`,
        description: `To: ${client.email}`,
        clientId: client.id,
      },
    });
  }
}

// ==================== WEEKLY SUMMARY (AI) ====================

export async function fireWeeklySummary(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, emailFromName: true, emailReplyTo: true },
  });
  if (!workspace) return;

  // Check for an active WEEKLY_SUMMARY rule
  const rule = await prisma.automationRule.findFirst({
    where: { workspaceId, isActive: true, triggerType: "WEEKLY_SUMMARY" },
  });
  if (!rule) return;

  // Dedup: only send once per week per workspace (check last 6 days)
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const recentLog = await prisma.emailLog.findFirst({
    where: {
      workspaceId,
      automationRuleId: rule.id,
      sentAt: { gte: sixDaysAgo },
    },
  });
  if (recentLog) return;

  // Get OWNER + ADMIN member emails
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: { in: ["OWNER", "ADMIN"] } },
    include: { user: { select: { email: true, name: true } } },
  });
  const recipients = members.map((m) => m.user.email).filter(Boolean);
  if (recipients.length === 0) return;

  // Build summary data
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [activeClients, newThisWeek, completedThisWeek, stages, activities] = await Promise.all([
    prisma.client.count({ where: { workspaceId, status: "ACTIVE" } }),
    prisma.client.count({ where: { workspaceId, createdAt: { gte: oneWeekAgo } } }),
    prisma.client.count({ where: { workspaceId, status: "COMPLETED", updatedAt: { gte: oneWeekAgo } } }),
    prisma.stage.findMany({
      where: { pipeline: { workspaceId } },
      include: {
        clientsInStage: { where: { status: "ACTIVE" }, select: { id: true, stageEnteredAt: true, currentStage: { select: { daysExpected: true } } } },
      },
    }),
    prisma.activity.findMany({
      where: { client: { workspaceId }, createdAt: { gte: oneWeekAgo } },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const pipelineValueResult = await prisma.client.aggregate({
    where: { workspaceId, status: "ACTIVE" },
    _sum: { projectValue: true },
  });

  const now = Date.now();
  const stageBreakdown = stages.map((s) => ({
    stageName: s.name,
    count: s.clientsInStage.length,
    overdueCount: s.clientsInStage.filter((c) => {
      if (!s.daysExpected || !c.stageEnteredAt) return false;
      const daysIn = Math.floor((now - new Date(c.stageEnteredAt).getTime()) / 86400000);
      return daysIn > s.daysExpected;
    }).length,
  })).filter((s) => s.count > 0);

  const summaryData: WorkspaceSummaryData = {
    workspaceName: workspace.name,
    weekStarting: oneWeekAgo.toISOString().split("T")[0],
    activeClients,
    newClientsThisWeek: newThisWeek,
    completedThisWeek,
    totalPipelineValue: pipelineValueResult._sum.projectValue ?? 0,
    stageBreakdown,
    recentActivities: activities.map((a) => ({
      clientName: a.client.name,
      description: a.title,
    })),
  };

  const generated = await generateWeeklySummaryEmail(summaryData);
  if (!generated) {
    // Fallback: plain-text summary if AI unavailable
    generated ?? console.log(`[WeeklySummary] AI unavailable for workspace ${workspaceId}`);
    return;
  }

  // Send to each owner/admin
  for (const email of recipients) {
    if (!email) continue;
    await sendEmail({
      to: email,
      subject: generated.subject,
      html: generated.html,
      fromName: workspace.emailFromName ?? workspace.name,
      replyTo: workspace.emailReplyTo ?? undefined,
    });
  }

  // Log once for the workspace (no clientId)
  await prisma.emailLog.create({
    data: {
      subject: generated.subject,
      body: generated.html,
      status: "SENT",
      workspaceId,
      automationRuleId: rule.id,
    },
  });
}
