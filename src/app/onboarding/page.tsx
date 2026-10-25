import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OnboardingChooser } from "@/components/onboarding/onboarding-chooser";
import { listBlueprintSummaries } from "@/lib/templates";
import { Building2 } from "lucide-react";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  if (!member) redirect("/signup");

  // If already completed, no need to onboard again. Only Owners and Admins
  // run setup, because it replaces the workspace's pipelines.
  if (member.workspace.onboardingCompleted || member.role === "MEMBER") {
    redirect("/dashboard");
  }

  const blueprints = listBlueprintSummaries();
  // AI on-ramps require the key AND can be disabled per-environment. On Netlify
  // the synchronous generator exceeds the function timeout, so they're gated by
  // ONBOARDING_AI_DISABLED until the async background flow is in place.
  const aiAvailable =
    !!process.env.ANTHROPIC_API_KEY &&
    process.env.ONBOARDING_AI_DISABLED !== "true";

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Building2 className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm tracking-tight">Cadence</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {member.workspace.name}
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <OnboardingChooser blueprints={blueprints} aiAvailable={aiAvailable} />
      </main>
    </div>
  );
}
