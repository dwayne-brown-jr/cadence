import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, AlertTriangle, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireOperatorPage } from "@/lib/setup/operator";
import { PIPELINE, stepOrder, getStepDef } from "@/lib/setup/pipeline";
import { StepStatusChip, RunStatusBadge, JsonBlock } from "@/components/setup/status";
import {
  RetryButton,
  IntakeEditor,
  MarkDoneButton,
  A2PForm,
  ConfigEditor,
  RunPoller,
  AutoAdvancer,
} from "@/components/setup/run-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const TOTAL = PIPELINE.length;

function watchRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "watch window ended";
  const hrs = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hrs}h ${mins}m left`;
}

// The operator action for a step: retry an auto step (failed/blocked), or mark a
// manual task done. Returns null when there's nothing to do.
function StepAction({
  runId,
  step,
}: {
  runId: string;
  step: { key: string; status: string; type: string };
}) {
  if (step.status === "failed") return <RetryButton runId={runId} stepKey={step.key} />;
  if (step.status !== "blocked") return null;
  if (step.type === "auto") return <RetryButton runId={runId} stepKey={step.key} />;
  return <MarkDoneButton runId={runId} stepKey={step.key} />;
}

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireOperatorPage();
  const { runId } = await params;
  const run = await prisma.onboardingRun.findUnique({
    where: { id: runId },
    include: { client: true, steps: true },
  });
  if (!run) notFound();

  const steps = [...run.steps].sort((a, b) => stepOrder(a.key) - stepOrder(b.key));
  const client = run.client;
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;

  const intakeStep = steps.find((s) => s.key === "intake");
  const intakeText = (intakeStep?.result as { intakeText?: string } | null)?.intakeText ?? "";
  const qaStep = steps.find((s) => s.key === "qa_review");
  const qa = qaStep?.result as { verdict?: string; flags?: { risk: string; fix: string }[] } | null;
  const blocker = steps.find((s) => s.key === run.currentStep);

  const config = (client.config ?? null) as Record<string, unknown> | null;
  const watchUntil = config?.watch_until as string | undefined;

  // While the run is "running", drive it one step per request (serverless-safe).
  // Separately, poll-refresh while an A2P submission awaits out-of-band approval.
  const a2pStep = steps.find((s) => s.key === "a2p");
  const a2pAwaiting =
    a2pStep?.status === "blocked" && !!(a2pStep.result as { brandSid?: string } | null)?.brandSid;
  const autoAdvance = run.status === "running";
  const a2pPolling = a2pAwaiting && run.status !== "live" && run.status !== "failed";

  const pct = Math.round((done / TOTAL) * 100);

  return (
    <div className="space-y-6">
      <AutoAdvancer runId={run.id} active={autoAdvance} />
      <RunPoller active={a2pPolling} />
      <Link href="/setup" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        All runs
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              {client.businessName}
              <Badge variant="outline" className="text-xs font-normal">{client.vertical}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">{done}/{TOTAL} steps complete</p>
          </div>
          <RunStatusBadge status={run.status} />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${run.status === "failed" ? "bg-destructive" : run.status === "live" ? "bg-emerald-600" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 48-hour watch indicator (post go-live) */}
      {run.status === "live" && watchUntil ? (
        <Card className="border-emerald-500/40 bg-emerald-50/50">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <ShieldCheck className="size-4 text-emerald-600" />
            <span className="font-medium">Live — 48-hour watch active.</span>
            <span className="text-muted-foreground">{watchRemaining(watchUntil)}</span>
          </CardContent>
        </Card>
      ) : null}

      {/* Blocker / failure banner */}
      {(run.status === "blocked" || run.status === "failed") && blocker ? (
        <Card className={run.status === "failed" ? "border-destructive/50" : "border-amber-400/60"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className={run.status === "failed" ? "size-4 text-destructive" : "size-4 text-amber-500"} />
              {run.status === "failed" ? "Step failed" : "Blocked"} · {getStepDef(blocker.key)?.label}
            </CardTitle>
            <CardDescription>{getStepDef(blocker.key)?.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {blocker.result ? <JsonBlock value={blocker.result} /> : null}
            {blocker.key === "a2p" &&
            blocker.status === "blocked" &&
            (blocker.result as { needsEin?: boolean; brandSid?: string } | null)?.needsEin &&
            !(blocker.result as { brandSid?: string } | null)?.brandSid ? (
              <A2PForm runId={run.id} />
            ) : null}
            <StepAction runId={run.id} step={blocker} />
          </CardContent>
        </Card>
      ) : null}

      {/* Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {steps.map((s, i) => {
            const def = getStepDef(s.key);
            const hasLog = s.result != null && Object.keys(s.result as object).length > 0;
            return (
              <div key={s.key} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{def?.label ?? s.key}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.type}</span>
                        {s.attempts > 1 ? (
                          <span className="text-[10px] text-muted-foreground">×{s.attempts}</span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{def?.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StepAction runId={run.id} step={s} />
                    <StepStatusChip status={s.status} />
                  </div>
                </div>
                {hasLog ? (
                  <details className="ml-8 mt-1.5">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      View log
                    </summary>
                    <div className="mt-1.5">
                      <JsonBlock value={s.result} />
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Intake */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Intake</CardTitle>
          <CardDescription>Edit and re-run the config if the run is blocked on missing fields or a QA no-go.</CardDescription>
        </CardHeader>
        <CardContent>
          {intakeText ? (
            <IntakeEditor runId={run.id} initialText={intakeText} />
          ) : (
            <p className="text-sm text-muted-foreground">No intake text recorded.</p>
          )}
        </CardContent>
      </Card>

      {/* QA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">QA review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {qa?.verdict ? (
            <>
              <Badge
                variant={qa.verdict === "go" ? "default" : "destructive"}
                className={qa.verdict === "go" ? "bg-emerald-600 text-white" : ""}
              >
                {qa.verdict.toUpperCase()}
              </Badge>
              {qa.flags && qa.flags.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {qa.flags.map((f, idx) => (
                    <li key={idx} className="rounded-md border bg-muted/40 p-2">
                      <p className="font-medium">{f.risk}</p>
                      <p className="text-muted-foreground">Fix: {f.fix}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No flags raised.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not reviewed yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Generated config (editable) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generated config</CardTitle>
          <CardDescription>Edit and save to regenerate the prompt + QA from the new values.</CardDescription>
        </CardHeader>
        <CardContent>
          {config ? (
            <ConfigEditor key={JSON.stringify(config)} runId={run.id} config={config} />
          ) : (
            <p className="text-sm text-muted-foreground">Not generated yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Generated prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent system prompt</CardTitle>
        </CardHeader>
        <CardContent>
          {client.systemPrompt ? (
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
              {client.systemPrompt}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">Not generated yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
