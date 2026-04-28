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

## Final artifact

Always end with the **SLO Breach Explainer** artifact (see `slo-breach-explainer` skill).
That artifact is the canonical output — it must include:

- Burn rate (1h / 6h / 24h)
- Error budget remaining
- Breach start time + duration
- Top impacted operations (with % contribution)
- Correlated deploys / config changes
- Ranked hypotheses
- Deep links into CloudWatch console (use `open-in-cloudwatch` skill)
- Metadata footer: source metric, time range, queries used, MCP tools called, confidence

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
