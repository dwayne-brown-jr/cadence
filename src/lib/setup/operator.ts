// Operator access gate for the Switchboard console. Deny-by-default: only
// emails listed in SWITCHBOARD_OPERATOR_EMAILS get in, and only once that email
// has been verified (so nobody can pre-register an allowlisted address they
// don't own). With no allowlist set, nobody is an operator.

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export function operatorEmails(): string[] {
  return (process.env.SWITCHBOARD_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isOperatorEmail(email?: string | null): boolean {
  if (!email) return false;
  return operatorEmails().includes(email.toLowerCase());
}

/** Allowlisted AND verified. Hits the DB, so use for access decisions. */
export async function isOperator(userId?: string | null, email?: string | null): Promise<boolean> {
  if (!userId || !isOperatorEmail(email)) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return !!user?.emailVerified && isOperatorEmail(user.email);
}

/** Recipients for operator notifications (allowlist, else OPERATOR_EMAIL). */
export function notifyRecipients(): string[] {
  const allow = operatorEmails();
  if (allow.length > 0) return allow;
  const fallback = process.env.OPERATOR_EMAIL?.trim();
  return fallback ? [fallback] : [];
}

/** API-route guard: 401 if not authed, 403 if not an allowed operator. */
export async function requireOperator() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const email = session.user?.email ?? null;
  if (!(await isOperator(userId, email))) {
    return {
      error: NextResponse.json({ error: "Operator access required" }, { status: 403 }),
    };
  }
  return { userId, email, error: null as null };
}

/** Page guard for /setup server components. Redirects non-operators away. */
export async function requireOperatorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await isOperator(session.user.id, session.user.email))) redirect("/dashboard");
  return session;
}
