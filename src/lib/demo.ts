// The public /demo account. Its password is published on purpose, so the
// account is read-only: the auth gatekeeper (auth.config.ts) refuses its
// writes except the few harmless ones below. Edge-safe (no Node/DB imports).

export const DEMO_EMAIL = "alex@prestigerealty.com";
export const DEMO_PASSWORD = "password123";

export function isDemoEmail(email?: string | null): boolean {
  return !!email && email.toLowerCase() === DEMO_EMAIL;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Writes the demo may still make so the tour feels alive. Content is
// server-generated or per-user, so visitors can't plant anything for others.
const DEMO_WRITE_ALLOWLIST: RegExp[] = [
  /^\/api\/auth\//, // sign-in / sign-out
  /^\/api\/clients\/[^/]+\/move$/, // kanban drag between stages
  /^\/api\/clients\/[^/]+\/checklist$/, // tick a checklist item
  /^\/api\/notifications(\/|$)/, // mark own notifications read
];

// Reads that cost money (AI calls) are blocked too.
const DEMO_READ_BLOCKLIST: RegExp[] = [/^\/api\/clients\/[^/]+\/ai-summary$/];

/** True when the demo account may make this request. */
export function demoMayRequest(method: string, pathname: string, isServerAction: boolean): boolean {
  if (SAFE_METHODS.has(method)) {
    return !DEMO_READ_BLOCKLIST.some((re) => re.test(pathname));
  }
  // The only server action in the app is sign-out (src/lib/actions.ts).
  // If you add another, check it here before it becomes writable by the demo.
  if (isServerAction) return true;
  return DEMO_WRITE_ALLOWLIST.some((re) => re.test(pathname));
}
