"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  GitBranch,
  Zap,
  Mail,
  BarChart3,
  Settings,
  Building2,
  X,
  CalendarClock,
  Code2,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSidebar } from "./sidebar-context";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Pipelines", href: "/pipelines", icon: GitBranch },
  { label: "Automations", href: "/automations", icon: Zap },
  { label: "Email Templates", href: "/email-templates", icon: Mail },
  { label: "Timeline", href: "/timeline", icon: CalendarClock },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Switchboard Setup", href: "/setup", icon: Radio },
  { label: "API Docs", href: "/api-docs", icon: Code2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

function SidebarContent({
  workspaceName,
  showSetup,
  onNavClick,
}: {
  workspaceName: string;
  showSetup: boolean;
  onNavClick?: () => void;
}) {
  const pathname = usePathname();
  const items = showSetup ? navItems : navItems.filter((item) => item.href !== "/setup");

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sidebar-primary shrink-0">
          <Building2 className="h-4 w-4 text-sidebar-primary-foreground" />
        </div>
        <span className="font-bold text-sidebar-foreground text-sm tracking-tight leading-tight truncate">
          {workspaceName}
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="text-xs text-sidebar-foreground/40">Cadence v1.0</p>
      </div>
    </div>
  );
}

export function Sidebar({
  workspaceName,
  showSetup = false,
}: {
  workspaceName: string;
  showSetup?: boolean;
}) {
  const { open, setOpen } = useSidebar();

  return (
    <>
      <aside className="hidden lg:flex h-full w-56 flex-col border-r border-sidebar-border shrink-0">
        <SidebarContent workspaceName={workspaceName} showSetup={showSetup} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-56 p-0 bg-sidebar border-sidebar-border [&>button]:hidden">
          <span className="sr-only">Navigation menu</span>
          <button
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-10 rounded-sm opacity-70 text-sidebar-foreground hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
          <SidebarContent
            workspaceName={workspaceName}
            showSetup={showSetup}
            onNavClick={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
