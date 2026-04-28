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

### Phase 2b — Compute blast radius

Before moving on, compute the **blast radius** — who and what is affected.
This becomes a section of the final artifact and feeds the
`copy-to-incident` skill's customer / exec summaries. Capture all of:

- **Affected operations** — names + bad-event share (from Phase 2.2).
- **Callers** — every Application Signals service that calls the
  breaching operation in the breach window. Pull from the service map.
- **AZ / region** — is the breach concentrated in one AZ (single-AZ
  deploy issue) or fleet-wide? Group failed/slow events by AZ if the
  metric supports it; otherwise note "AZ breakdown unavailable."
- **Customer segments** — if requests carry a `tenantId`, `customerTier`,
  or similar tag, group the bad events by that dimension. If no
  segmentation tag exists, surface "customer-segment data unavailable"
  rather than guessing.
- **Upstream services** — for each caller, note whether *they* are also
  breaching an SLO or alarming. A caller that's silently absorbing
  errors is different from one that's also breaching.
- **Estimated failed requests** — bad-event count over the breach window.
  Compute as: `(error rate now − baseline error rate) × request rate ×
  duration`. Round and surface uncertainty (e.g. "~1,200 failed
  requests, ±20%").
- **Severity label** — proposed SEV1 / SEV2 / SEV3 / SEV4 based on:
  - SEV1: customer-facing, fast-burn SLO, broad caller fan-out
  - SEV2: customer-facing, fast-burn SLO, narrow scope
  - SEV3: slow-burn, internal-only callers OR fast-burn with low
    request rate
  - SEV4: internal tooling, no customer impact
  This is a **proposal** — the on-call engineer / IC makes the final
  call, not the skill.

Render this in the final artifact as a "Blast radius" subsection. If any
field is unavailable (e.g. no AZ breakdown, no tenant tag), say so
explicitly rather than omitting the line.

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

## False-positive / noisy-breach handling

Before presenting a verdict, run these checks. If any apply, the breach
may be a measurement artifact rather than a real customer-impacting
problem. Surface the finding **above** the artifact and downgrade the
verdict accordingly — never present a 🔴 verdict on a false positive.

1. **Traffic too low** — request rate during the breach window is <1
   request / minute, OR <1% of the SLO's typical evaluation traffic. A
   single failed request can flip a 99.9% SLO into "breach" when volume
   is tiny. Note: "Low traffic — single-event sensitivity, breach may
   not represent customer impact."
2. **Sample size too small** — fewer than 100 events in the SLO's
   evaluation window. Burn rate math is unreliable. Note: "Sample size
   <100 — confidence in burn rate is Low."
3. **Deploy window expected** — CloudTrail shows a `RegisterTaskDefinition`
   / `UpdateService` / `UpdateFunctionCode` exactly at breach start AND
   the team has a documented "expected error budget consumption during
   deploy" pattern. If the breach decays within the expected post-deploy
   stabilization window, label "Expected deploy-window noise" — but do
   NOT auto-suppress. The user decides.
4. **Alarm / SLO recently edited** — `PutMetricAlarm` or SLO
   configuration change in the last 24h tightened the threshold. The
   metric may not have moved; the bar moved. Surface the edit and the
   "before" threshold so the user can judge.
5. **Missing data** — gaps in the SLO's input metric (e.g. publisher
   lag, agent restart, region-wide CloudWatch incident). Detect via
   timestamps with no datapoints in the breach window. Note: "Missing
   data — breach computation includes treat-missing-data behavior; verify
   in console."
6. **Synthetic-only failure** — the SLO is fed by a synthetics canary
   (CloudWatch Synthetics or similar) and only the canary is failing
   while real-user traffic looks normal. This is often a canary
   credential / network egress issue, not a customer-impacting service
   problem. Note: "Synthetics-only — real traffic on the same operation
   is healthy."

If two or more of these conditions hold, downgrade the verdict to ⚠️
and lead with "Possible false positive — <reasons>." Do not present
🔴 Fast burn / Slow burn until at least one false-positive condition is
ruled out OR the user confirms it's real.

## Degraded telemetry handling

If the inputs you need are unavailable, the investigation must
gracefully degrade rather than fabricate. Detect each gap and apply the
matching rule. Cap final confidence based on the worst gap, and tell
the user explicitly which signals were missing.

| Gap | Detect | Behavior | Confidence cap |
|---|---|---|---|
| Traces missing | `search_traces` returns 0 results when error/latency metrics show events | Skip Phases 3 + 6's trace-based steps; rely on metrics + logs only | Medium |
| Logs not correlated to traces | No `traceId` field on log lines for the affected operation | Surface log patterns without trace cross-reference | Medium |
| SLOs absent | `list_slos` returns empty for the service | Hand off to `latency-regression` or `error-spike-triage`; do NOT compute fictional burn rates | N/A — switch skill |
| CloudTrail denied | `AccessDenied` on `LookupEvents` / Lake / Logs integration | Skip Phase 4 entirely; surface "Cannot correlate with CloudTrail — no access" in artifact | Medium |
| Operation-level metrics flat / missing | `get_service_operations` returns no per-operation breakdown | Skip Phase 2 ranking; analyze service-level only | Medium |
| Application Signals service map empty | No callers / dependencies returned | Skip blast radius "Callers" + "Upstream services" lines; note explicitly | Low for blast radius |
| All telemetry unavailable | `list_services` errors or returns empty for the configured region | Stop. Run `/cw-doctor` and `/cw-set-context` first | N/A — refuse to run |

Always tell the user which signals degraded and why. A confident-looking
artifact built on missing data is worse than a hedged one — silent gaps
erode trust faster than visible ones.

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
- **Blast radius** (from Phase 2b): callers, AZ/region scope, customer
  segments, upstream services, estimated failed requests, proposed
  severity label
- Correlated deploys / config changes
- Ranked hypotheses
- Downstream dependency health (from Phase 6, when applicable)
- Owner + suggested page (from `service-ownership` skill)
- False-positive checks — list each condition checked + result
- Degraded-telemetry note (if any signal was missing)
- Deep links into CloudWatch console (use `open-in-cloudwatch` skill)
- Metadata footer: source metric, time range, queries used, MCP tools
  called, confidence (capped per degraded-telemetry rules)

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

## What this skill does NOT do

- Does not diagnose latency regressions in services *without* SLOs configured — use
  `latency-regression` instead.
- Does not investigate generic error spikes when no SLO is breaching — use
  `error-spike-triage`.
- Does not handle synthetics canary failures unless a downstream SLO is also breaching.
