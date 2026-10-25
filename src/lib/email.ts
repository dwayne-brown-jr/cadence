import { Resend } from "resend";
import crypto from "crypto";
import { escapeHtml } from "@/lib/utils";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export type MergeFields = {
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  project_type?: string;
  project_value?: string;
  stage_name?: string;
  workspace_name?: string;
  company_name?: string;
  portal_url?: string;
  days_in_stage?: string;
};

export const MERGE_FIELD_TOKENS: { token: string; label: string }[] = [
  { token: "{{client_name}}", label: "Client Name" },
  { token: "{{client_email}}", label: "Client Email" },
  { token: "{{client_phone}}", label: "Client Phone" },
  { token: "{{project_type}}", label: "Project Type" },
  { token: "{{project_value}}", label: "Project Value" },
  { token: "{{stage_name}}", label: "Stage Name" },
  { token: "{{workspace_name}}", label: "Workspace Name" },
  { token: "{{company_name}}", label: "Company Name (alias)" },
  { token: "{{portal_url}}", label: "Client Portal URL" },
  { token: "{{days_in_stage}}", label: "Days in Current Stage" },
];

/**
 * Fill {{tokens}} in a template. Pass `{ html: true }` for email bodies so
 * values typed by clients (name, company...) can't inject markup.
 */
export function applyMergeFields(
  template: string,
  fields: MergeFields,
  { html = false }: { html?: boolean } = {}
): string {
  let result = template;
  for (const [key, value] of Object.entries(fields)) {
    result = result.replaceAll(`{{${key}}}`, html ? escapeHtml(value) : value ?? "");
  }
  return result;
}

export function generateTrackingId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function injectTrackingPixel(html: string, trackingId: string): string {
  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3002";
  const pixel = `<img src="${baseUrl}/api/email-tracking?id=${trackingId}" width="1" height="1" style="display:none" alt="" />`;
  // Insert before closing </body> or append to end
  if (html.includes("</body>")) {
    return html.replace("</body>", `${pixel}</body>`);
  }
  return html + pixel;
}

export async function sendEmail({
  to,
  subject,
  html,
  fromName = "Cadence",
  replyTo,
  trackingId,
}: {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
  trackingId?: string;
}): Promise<{ success: boolean; error?: string }> {
  // Inject tracking pixel if trackingId provided
  const finalHtml = trackingId ? injectTrackingPixel(html, trackingId) : html;
  if (!resend) {
    // No API key configured — log and succeed silently (dev/demo mode)
    console.log(`[Email] No RESEND_API_KEY — skipping send to ${to}: ${subject}`);
    return { success: true };
  }
  try {
    await resend.emails.send({
      from: `${fromName} <onboarding@resend.dev>`,
      to,
      subject,
      html: finalHtml,
      ...(replyTo ? { replyTo } : {}),
    });
    return { success: true };
  } catch (err) {
    console.error("[Email] Send failed:", err);
    return { success: false, error: String(err) };
  }
}
