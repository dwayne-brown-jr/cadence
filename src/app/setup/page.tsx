import Link from "next/link";
import { requireOperatorPage } from "@/lib/setup/operator";
import { prisma } from "@/lib/prisma";
import { PIPELINE } from "@/lib/setup/pipeline";
import { RunStatusBadge } from "@/components/setup/status";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, ChevronRight } from "lucide-react";

const TOTAL = PIPELINE.length;

export default async function SetupListPage() {
  await requireOperatorPage();
  const clients = await prisma.switchboardClient.findMany({
    include: { run: { include: { steps: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Onboarding runs</h1>
        <p className="text-sm text-muted-foreground">
          Every Switchboard client and where its provisioning run stands.
        </p>
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">No runs yet.</p>
            <Button asChild size="sm">
              <Link href="/setup/new">
                <Plus className="size-4" />
                Start your first run
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => {
            const run = c.run;
            const done = run
              ? run.steps.filter((s) => s.status === "done" || s.status === "skipped").length
              : 0;
            const currentLabel =
              PIPELINE.find((p) => p.key === run?.currentStep)?.label ?? null;
            const pct = Math.round((done / TOTAL) * 100);
            return (
              <Link key={c.id} href={run ? `/setup/${run.id}` : "/setup/new"}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{c.businessName}</span>
                        <span className="text-xs text-muted-foreground">{c.vertical}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {done}/{TOTAL} steps
                        {currentLabel ? ` · current: ${currentLabel}` : ""}
                      </p>
                      <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${run?.status === "failed" ? "bg-destructive" : run?.status === "live" ? "bg-emerald-600" : "bg-primary"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {run ? <RunStatusBadge status={run.status} /> : null}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
