# Switchboard Setup Engine — Operator Guide

Internal client-provisioning engine that takes a Switchboard client from intake →
live as a state machine. Lives alongside Cadence; the operator console is at
**`/setup`** (only verified emails on `SWITCHBOARD_OPERATOR_EMAILS`; deny-by-default).

> **Status: Phases 1–3 complete.** A run goes intake → live: the brain
> (config → prompt → QA go/no-go), then the provisioning auto steps (voice agent,
> Cal.com event types, Twilio number, n8n registration), pausing only at the three
> human walls (forwarding, A2P, trust-check). A2P approval is polled and
> auto-advances. The operator console lists runs with progress, exposes
> run/retry/mark-done + editable config, polls live, gates to an operator
> allowlist, and emails on blocked + go-live. Everything runs offline via stub
> mode with zero keys.

## Naming (collision notes)

The build spec's `Client` model collides with Cadence's existing CRM `Client`, and
its `/onboarding` route collides with Cadence's workspace-setup wizard. So:

- Prisma model is **`SwitchboardClient`** (+ `OnboardingRun`, `ProvisioningStep`).
- Console route is **`/setup`** (not `/onboarding`).

## The pipeline (12 steps)

`src/lib/setup/pipeline.ts` is the single source of truth.

| # | key | type | Phase |
|---|-----|------|-------|
| 1 | `intake` | manual | seeded done on creation |
| 2 | `generate_config` | auto | **1** — LLM → config; blocks if required fields missing |
| 3 | `generate_prompt` | auto | **1** — LLM → filled vertical agent prompt |
| 4 | `qa_review` | auto | **1** — LLM go/no-go; blocks on no-go |
| 5 | `provision_voice` | auto | **2** — Retell/Vapi agent (prompt, voice, functions, webhook) |
| 6 | `provision_calcom` | auto | **2** — one Cal.com event type per service |
| 7 | `provision_twilio` | auto | **2** — buy + attach the agent number |
| 8 | `register_n8n` | auto | **2** — upsert the client row for n8n flows |
| 9 | `forwarding` | manual | **2** — carrier forwarding to the agent number |
| 10 | `a2p` | manual (async) | **2** — A2P 10DLC, needs the client's **EIN**; polled |
| 11 | `trust_check` | manual | **2** — operator runs the 12-case call script |
| 12 | `go_live` | auto | **2** — flip the agent live, set a 48h watch flag |

Auto steps run via a handler registered in `src/lib/steps/index.ts`. Manual steps
**block** the run for the operator (they never fake-complete). The engine
(`src/lib/engine.ts`) `advanceRun(runId)` always recomputes from persisted state,
so it doubles as the resume entrypoint and is safe to call repeatedly. Handlers
are **idempotent** — they check `step.result` for an existing external ID first
and skip creation if present, so a retry never double-creates an agent / number /
event type.

## How a run flows

1. Operator submits intake at `/setup/new` (paste-a-doc **or** form).
2. `createRunFromIntake` makes a `SwitchboardClient` + `OnboardingRun` with all 12
   `ProvisioningStep` rows (intake → done), then calls `advanceRun`.
3. The engine runs the brain (`generate_config → generate_prompt → qa_review`) and
   the four provisioning steps, then halts at `forwarding` (first human wall).
4. The run view `/setup/[runId]` shows step chips, the config (pretty JSON), the
   prompt, the QA verdict + flags, and any blocker. The operator can **edit the
   intake and re-run** the brain, **Run / Retry** an auto step, or **Mark done** a
   manual task. The **A2P** task takes the client's EIN inline (`/setup/[runId]`
   form) and starts approval polling.

Blocks surface specifics: missing-field runs list the exact `missing[]` keys; QA
no-go runs list each risk + one-line fix; manual tasks render their instructions /
checklist / call-script.

## Provisioning integrations & stub mode

Each integration (`src/lib/integrations/`) is env-keyed and runs in **stub mode**
when its key is absent or `SWITCHBOARD_PROVISION_STUB=true` — returning
deterministic fake IDs so the whole pipeline runs offline and retries stay
idempotent (same seed → same id). The live REST shapes follow each provider's
docs but are **unverified against live accounts** — confirm before production.

- **Voice (Retell ⇄ Vapi):** interchangeable behind `VoiceProvider`. Picked per
  client via `config.voice_provider` (`retell`|`vapi`), else
  `SWITCHBOARD_VOICE_PROVIDER`, else `retell`. To swap, set `voice_provider` on
  the client config (or the env default) before `provision_voice` runs.
- **A2P (async):** `forwarding` and `trust_check` are simple mark-done tasks.
  `a2p` collects the EIN (`POST /api/setup/runs/[runId]/a2p`), registers the
  brand/campaign, and schedules polling. With `QSTASH_TOKEN` set, the poll runs
  via QStash delayed messages that call back into `POST /api/cron/a2p-poll`
  (CRON_SECRET-gated, public). Without QStash it polls inline. On approval the
  step auto-advances; on rejection the run fails. The raw EIN is never stored —
  only a masked tail + the returned SIDs.

## Env vars

All secrets are env-only — never in the DB, never sent to the browser.
`SwitchboardClient.config` holds business data + non-secret IDs only.

| var | purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | required for live LLM calls (already used by Cadence) |
| `ANTHROPIC_MODEL` | config + prompt model. Default `claude-sonnet-4-5` |
| `ANTHROPIC_QA_MODEL` | stronger QA model. Defaults to `ANTHROPIC_MODEL` |
| `SWITCHBOARD_LLM_STUB` | `"true"` → deterministic offline brain stub, no Anthropic call |
| `SWITCHBOARD_PROVISION_STUB` | `"true"` → deterministic offline provisioning stub |
| `SWITCHBOARD_VOICE_PROVIDER` | `retell`\|`vapi` default when config doesn't set it |
| `RETELL_API_KEY` / `VAPI_API_KEY` | voice agent (whichever provider is used) |
| `CALCOM_API_KEY` | Cal.com event types |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | number purchase + A2P |
| `N8N_BROKER_URL` | base for the agent function URLs (check_availability, …) |
| `N8N_ADMIN_URL` / `N8N_ADMIN_TOKEN` | client upsert for n8n flows |
| `QSTASH_TOKEN` | schedules the A2P poll (inline if unset) |
| `CRON_SECRET` | gates `/api/cron/a2p-poll` (already used by Cadence crons) |

> Note: this project's `ANTHROPIC_API_KEY` is IP-allowlisted and fails from local
> machines. For local dev/testing set `SWITCHBOARD_LLM_STUB=true` (and, for
> provisioning, `SWITCHBOARD_PROVISION_STUB=true`).

## Testing

```bash
pnpm itest:setup   # full intake→live pipeline via stubs — zero API keys needed
```

Covers: happy path, missing-field block, QA no-go block, edit-intake recovery,
retry idempotency, the full provisioning path to go-live, the three manual walls,
A2P submit/poll/approve, and config-edit re-run (prompt + QA regenerate,
provisioning preserved). Cleans up everything it creates.

## Operator console (Phase 3)

- **`/setup`** — every client with a status badge + progress bar (done/12, current step).
- **`/setup/[runId]`** — full pipeline: per-step status chips, **Run / Retry** (auto),
  **Mark done** (manual), per-step **View log**, the QA verdict + flags, the editable
  **config** (saving re-runs prompt + QA via idempotent downstream, provisioning
  preserved), the agent prompt, and a **48-hour watch** indicator once live. The view
  **polls live** while the engine is running or A2P is awaiting approval.
- **Access:** deny-by-default. Only emails on `SWITCHBOARD_OPERATOR_EMAILS` whose
  Cadence account has a verified email (`User.emailVerified`) can reach `/setup/**` and
  `/api/setup/**` (`requireOperator` / `requireOperatorPage`). Unset = nobody.
- **Notifications:** on a new **blocked** step (operator needed) or **go-live**, an
  email goes to the operator(s) via Resend (`src/lib/setup/notify.ts`). No-ops without
  recipients or `RESEND_API_KEY`. De-duped — a retry that re-blocks the same step
  doesn't re-send.

## Database

Models added in migration `20260629211800_add_switchboard_setup_engine`. The
local `dev.db` already has the tables applied. Prod (Turso) is maintained via
`prisma/migrate-turso.sql` — apply the three `CREATE TABLE`s from the migration
there when deploying.
