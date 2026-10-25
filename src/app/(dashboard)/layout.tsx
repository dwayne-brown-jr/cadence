import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { SidebarProvider } from "@/components/dashboard/sidebar-context";
import { RoleProvider, type Role } from "@/components/dashboard/role-context";
import { DemoTour } from "@/components/demo-tour";
import { OnboardingReminder } from "@/components/dashboard/onboarding-reminder";
import { RealtimeProvider } from "@/components/dashboard/realtime-provider";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/setup/operator";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  let memberships;
  try {
    memberships = await prisma.workspaceMember.findMany({
      where: { userId: session.user.id },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (err) {
    console.error("[layout] DB error:", err);
    throw err;
  }

  if (!memberships || memberships.length === 0) redirect("/signup");

  // Determine active workspace from cookie or default to first
  const cookieStore = await cookies();
  const activeWsId = cookieStore.get("active_workspace")?.value;
  const member =
    memberships.find((m) => m.workspaceId === activeWsId) ?? memberships[0];
  const showSetup = await isOperator(session.user.id, session.user.email);
  const allWorkspaces = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
  }));

  return (
    <SidebarProvider>
      <RoleProvider role={member.role as Role}>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar workspaceName={member.workspace.name} showSetup={showSetup} />
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <Header
              workspaceName={member.workspace.name}
              userName={session.user.name ?? ""}
              userEmail={session.user.email ?? ""}
              userImage={session.user.image ?? undefined}
              workspaces={allWorkspaces}
              currentWorkspaceId={member.workspaceId}
            />
            <RealtimeProvider>
              <main className="flex-1 overflow-auto">
                {!member.workspace.onboardingCompleted && member.role !== "MEMBER" && <OnboardingReminder />}
                {children}
              </main>
            </RealtimeProvider>
          </div>
          <Suspense>
            <DemoTour />
          </Suspense>
        </div>
      </RoleProvider>
    </SidebarProvider>
  );
}
