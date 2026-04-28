---
name: slo-breach-investigation
description: >
  Investigate AWS Application Signals SLO breaches end-to-end — burn rate analysis,
  error budget remaining, impacted operations, breach start time, correlated deploys
  via CloudTrail, and root-cause hypotheses ranked by evidence.
  Trigger phrases: "SLO breach", "SLO breached", "SLO violated", "SLO violation",
  "burning error budget", "error budget burn", "fast burn", "slow burn",
  "SLO at risk", "SLO degraded", "SLO red", "investigate SLO",
  "service level objective", "availability SLO", "latency SLO",
  "service in breach", "SLO compliance", "SLO miss", "missing SLO target",
  or any request about diagnosing why an Application Signals SLO is breaching.
metadata:
  version: "0.1.0"
---

# SLO Breach Investigation

End-to-end workflow for diagnosing an AWS Application Signals SLO breach using the
CloudWatch, Application Signals, and CloudTrail MCP servers. The goal is to produce
a structured **SLO Breach Explainer** artifact (see `slo-breach-explainer` skill) the
on-call engineer can act on without leaving Claude.

## When this activates

Triggers on any of:
- An explicit SLO breach mention by the user
- A burn-rate or error-budget concern
- An ambiguous "service unhealthy" report where the service has SLOs configured

If it is unclear whether SLOs are configured, list SLOs first (Phase 1) before
committing to this workflow. If no SLOs exist, hand off to `service-health-card` or
`error-spike-triage`.

## Required MCP servers

- `awslabs.cloudwatch-applicationsignals-mcp-server` — SLOs, services, operations, traces
- `awslabs.cloudwatch-mcp-server` — supporting metrics and logs
- `awslabs.cloudtrail-mcp-server` — recent deploys / IAM / config changes

If any required MCP is not connected, run the `aws-apm-setup` skill before continuing.

## Presentation

How to surface progress to the on-call engineer while the investigation runs:

1. **Show reasoning before each phase.** Before kicking off a phase, write a one-line
   thought explaining what you are about to do and why — e.g. "Pulling burn rate over
   1h / 6h / 24h to classify this as fast vs slow burn." This makes the investigation
   inspectable in real time, not a black box.
2. **Label tool calls in human-readable terms.** When invoking MCP tools, prefix each
   call with a plain-English label ("Checking SLO status…", "Fetching correlated
   CloudTrail events…", "Sampling failed traces…") rather than dumping raw API or
   tool names. Raw names go in the metadata footer, not the running narrative.
3. **Track phases with `TodoWrite`.** At the start of the workflow, create a todo per
   phase (Frame the breach, Localize impact, Pull traces, Correlate changes,
   Hypothesize, Follow dependencies). Mark each `in_progress` when you start it and
   `completed` when its data is in hand. Exactly one phase is `in_progress` at a
   time. The on-call engineer should be able to read the todo list and know where
   the investigation is.

## Investigation workflow

### Phase 1 — Frame the breach

1. List SLOs in `BREACHING` or `WARNING` state via Application Signals.
2. For each candidate SLO, fetch:
   - Target (e.g. 99.9% availability over 30 days)
   - Current attainment
   - Error budget remaining (raw + percent)
   - Burn rate over the last 1h, 6h, 24h
   - Breach start time (first sample where attainment dropped below target)
3. Classify the breach:
   - **Fast burn** — burning >14× normal rate (will exhaust budget in <2 days)
   - **Slow burn** — burning 1–14× normal rate
   - **Recovered** — currently above target but budget depleted

The classification drives urgency. Fast burn → page-worthy, mitigate first, RCA later.
Slow burn → investigate first, mitigate based on root cause.

### Phase 2 — Localize the impact

For the breaching SLO, identify *which operations are responsible*:

1. Get top contributors to the breach (operation-level error rate / latency).
2. Rank operations by % of bad events contributed.
3. For each top contributor:
   - Pull RED metrics (request rate, error rate, latency p50/p90/p99)
   - Compare to baseline (same window 7 days ago)
   - Note any operation that is *new* (didn't exist in baseline) — likely deploy

### Phase 3 — Pull representative traces

For the worst-contributing operation:

1. Search recent failed / slow traces in the breach window.
2. Pick 3–5 representative traces (one canonical failure mode each).
3. For each trace, extract:
   - Trace ID
   - Total duration
   - Failed span (if any) with exception class + message
   - Top 3 slowest spans by self-time
   - Downstream dependency that failed (if any)

The `trace-waterfall-summary` skill renders this as an artifact.

### Phase 4 — Correlate with changes

1. Query CloudTrail for the breach window ± 30 minutes:
   - Deploys (`UpdateService`, `UpdateFunctionCode`, `RegisterTaskDefinition`)
   - Config changes (`PutScalingPolicy`, `ModifyDBInstance`, `UpdateAlias`)
   - IAM changes (`AttachRolePolicy`, `PutRolePolicy`) — relevant for auth-related errors
2. Rank changes by proximity to breach start time and by services they touched.
3. Highlight any change in a service that appears on the trace path.

Follow the CloudTrail data source priority: Lake event data store → CloudWatch Logs
integration → Lookup Events API. Do not rely solely on Lookup Events for windows >7 days.

### Phase 5 — Hypothesize and rank causes

Produce 2–4 ranked hypotheses (use `top-suspected-cause` skill for the artifact). Each
hypothesis must include:
- One-line claim
- Evidence (specific metrics, logs, traces, deploys cited)
- Confidence (Low / Medium / High) with stated reason
- Suggested next action (read-only verification step, *not* a write action)

Bias toward hypotheses with multi-source evidence (metric + trace + deploy correlation).
A hypothesis backed only by metrics is weaker than one with a matching trace exception.

### Phase 6 — Follow dependencies (cascading health check)

If Phase 5's top hypothesis implicates a **downstream dependency** (a service / DB / API
this service calls, or a downstream Application Signals service shown on the trace path),
follow the chain one hop:

1. **Pick the implicated dependency.** Use the dependency named in the top hypothesis or
   the slowest / most-failing dependency surfaced in Phases 2–3. Pick at most one — do
   not fan out across every dependency.
2. **Run a service health snapshot on it.** Invoke the `service-health-card` skill on
   the dependency, scoped to the same time window as the breach.
3. **Include the result in the final summary.** The dependency's verdict (Healthy /
   Degraded / Unhealthy), its own RED metric deltas, and any of its own SLOs in
   Warning / Breach get embedded in the Explainer artifact under a "Downstream
   dependency health" subsection. If the dependency is itself Unhealthy, escalate the
   ranking of the "downstream dependency degradation" hypothesis accordingly.
4. **Cap the chain at depth 2.** If the dependency's health card itself implicates
   *its* dependency, you may follow one more hop (depth 2) — but stop there. Note
   "Further dependencies not auto-followed; investigate manually" in the summary.
   Never follow a third hop, even if implicated. This is the loop guard.
5. **Skip the cascade entirely** if:
   - No dependency is implicated (top hypothesis is a code change, GC, capacity, etc.)
   - The implicated dependency is outside the user's account (3rd-party API) — note it
     in the summary and recommend the user contact the owning team
   - The dependency was already covered by an earlier phase's data with high confidence

## Final artifact

**Lead with a one-line verdict** before presenting the artifact. The verdict goes
ABOVE the artifact, in plain text, so it's the first thing the user reads. Shape:

> 🔴 **Fast burn at 28× normal** — `checkout-availability` will exhaust its remaining
> 12% budget in ~6h. Top hypothesis: bad deploy at 14:18 UTC (High confidence).

The verdict must name (1) burn-rate state, (2) the SLO, (3) time-to-exhaustion if
applicable, and (4) the top-ranked hypothesis with its confidence. If the breach has
recovered, lead with "🟢 Recovered, but budget exhausted — …" instead. Never hide the
verdict inside the artifact; the on-call engineer should be able to read just the
verdict line and decide whether to page someone.

Then present the **SLO Breach Explainer** artifact (see `slo-breach-explainer` skill).
That artifact is the canonical output — it must include:

- Burn rate (1h / 6h / 24h)
- Error budget remaining
- Breach start time + duration
- Top impacted operations (with % contribution)
- Correlated deploys / config changes
- Ranked hypotheses
- Downstream dependency health (from Phase 6, when applicable)
- Deep links into CloudWatch console (use `open-in-cloudwatch` skill)
- Metadata footer: source metric, time range, queries used, MCP tools called, confidence

For a full postmortem-style writeup (timeline + root cause + impact + remediation),
use the artifact template at `artifacts/investigation-summary.html` and populate the
`{{PLACEHOLDERS}}` with actual data — see that file for the full placeholder list.

## Action safety

**Read-only by default.** Never call write actions (PutMetricAlarm, StartIncident, etc.)
without an explicit `confirmation gate` — propose the action, show exact diff, wait for
"yes" from the user. The plugin's PreToolUse hook enforces this for `Put*`, `Update*`,
`Delete*`, `Modify*`, and `Start*` actions, but rely on the rule, not the hook.

For destructive or billing-impacting actions (delete log group, change retention, modify
IAM), prefer **deep linking** the user to the AWS console via `open-in-cloudwatch` rather
than executing through MCP.

## Empty states and data unavailability

Every investigation must explicitly handle the case where data is missing
rather than silently skipping a phase. Surface the gap; do not hide it.

**Empty states (UX11)** — render a short, helpful message with a suggested
next action:

- **No SLOs configured** on the service → "No SLOs configured for
  `<service>`. Hand off to `service-health-card` for a RED snapshot, or
  recommend defining an availability + latency SLO via Application Signals."
- **No services found in region** → "No Application Signals services in
  `<region>`. Confirm the region is correct (current: `<region>`) or run
  `aws-apm-setup` to verify Application Signals is enabled."
- **No traces in the breach window** → "No traces sampled in window. X-Ray
  may have sampled them out, or the service may not be instrumented.
  Continue with metric + log evidence; flag attribution confidence as
  Medium (capped)."
- **No log group resolvable for the service** → "No log group found for
  `<service>`. Skip Logs Insights phase; surface that pattern detection
  was not run."
- **Multiple ambiguous services match** the user's name → "Multiple matches
  for `<name>`: <list>. Ask the user which one to investigate."
- **No CloudTrail events in window** → "No CloudTrail changes in breach
  window ± 30m." (This is meaningful evidence, not a gap — render it as a
  finding, not a missing-data state.)
- **Wrong region / no permissions** → surface the AWS error verbatim. Do
  not retry silently.

**Data unavailability (UX8)** — when a data source returns an error rather
than empty, surface it explicitly in the artifact's data-unavailable
banner. Examples:

> **Data unavailable** — CloudTrail Lake unreachable: AccessDenied. Change
> correlation skipped. Confidence capped at Medium.

> **Data unavailable** — Logs Insights query timed out after 30s. Pattern
> detection skipped for this phase. Continue with metric + trace evidence.

> **Data unavailable** — X-Ray returned `ThrottlingException`. Retried 2×
> with backoff and gave up. Trace sampling may be incomplete.

The rule: a missing source caps confidence at Medium for any hypothesis
that would have benefited from it. State this in the confidence
justification (see `investigation-validator` for the plain-English shape).

## What this skill does NOT do

- Does not diagnose latency regressions in services *without* SLOs configured — use
  `latency-regression` instead.
- Does not investigate generic error spikes when no SLO is breaching — use
  `error-spike-triage`.
- Does not handle synthetics canary failures unless a downstream SLO is also breaching.
