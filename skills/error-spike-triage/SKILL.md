---
name: error-spike-triage
description: >
  Triage error spikes in AWS Application Signals services — error rate vs baseline,
  exception class clustering, log pattern detection via Logs Insights, top failing
  operations, and correlated deploys via CloudTrail.
  Trigger phrases: "error spike", "errors spiking", "5xx errors up", "4xx errors",
  "error rate increased", "exception spike", "failures up", "fault rate",
  "investigate errors", "error budget burning fast", "errors in service",
  "service throwing errors", "unhandled exceptions", "error cluster",
  "request failures", "API errors", "errors increased", "service erroring",
  or any request about diagnosing a sudden increase in errors.
metadata:
  version: "0.1.0"
---

# Error Spike Triage

Workflow for finding *what is causing a burst of errors* in an Application Signals
service. Produces a **Service Health Card** + **Top Suspected Cause** artifact.

## When this activates

- Error rate jumped above baseline
- Specific 5xx / 4xx pattern reported
- An alarm on `ErrorCount` / `FaultRate` triggered

If an availability SLO is breaching as a result, prefer
`slo-breach-investigation` — it includes this workflow.

## Required MCP servers

- `awslabs.cloudwatch-applicationsignals-mcp-server` — services, operations, traces
- `awslabs.cloudwatch-mcp-server` — Logs Insights for pattern detection
- `awslabs.cloudtrail-mcp-server` — change correlation

## Triage workflow

### Phase 1 — Quantify the spike

1. Pull error count and error rate over:
   - Last 30 min (current)
   - Previous 30 min baseline
   - Same window 24h ago
2. Distinguish:
   - **4xx** (client errors) — usually NOT actionable for the service unless the rate is
     >10× baseline (could indicate a bad client release, abusive caller, or public API
     contract change)
   - **5xx** (server errors) — almost always actionable
3. Compute customer impact:
   - % of total requests failing
   - Estimated affected users (if request volume is high enough to assume distinct users)

### Phase 2 — Localize: which operation, which exception class?

1. Rank operations on the service by error count contribution.
2. For each top operation, query Logs Insights for the spike window:
   - Group by `errorType` / `exception.type` / `error.class`
   - Top 5 patterns by count
   - Sample 2 raw log lines per pattern
3. Render as patterns first, raw second (this is the canonical AWS APM logs UX).

Example Logs Insights query:
```
fields @timestamp, @message, level, errorType, exception
| filter level = "ERROR"
| stats count() as occurrences by errorType
| sort occurrences desc
| limit 5
```

### Phase 3 — Pull failing traces

1. Search for failed traces (status = error) in the spike window.
2. For each top exception class, pull 2–3 representative traces.
3. Extract:
   - Failed span (where the exception was thrown)
   - Stack trace (if Application Signals captured it)
   - Upstream caller and downstream dependency on the failed path

### Phase 4 — Correlate with changes

Same as `slo-breach-investigation` Phase 4 — CloudTrail for the spike window ± 30 min.
Pay special attention to:
- Recent deploys (most common error spike cause)
- IAM / role changes (auth-error spikes)
- Secret rotations (sudden 401/403 storms)
- Network / SG changes (sudden timeout patterns)

### Phase 5 — Hypotheses

Common root causes ranked by base rate:
1. **Bad deploy** — new code path throwing on real production traffic.
2. **Downstream dependency failing** — your service is faithfully reflecting an upstream
   issue. Check if the dependency has its own breach or alarm.
3. **Secret / credential rotation** — auth errors only, started cleanly at a specific
   minute, no code change near it.
4. **Throttling** — burst of 429s from a downstream API or DB connection pool exhaustion.
   Check `Throttles` metric.
5. **Bad input from a single caller** — 4xx storm from one IP / userId. Less common but
   visible in logs by `requestId` / `principalId`.

## Final artifact

End with **Service Health Card** + **Top Suspected Cause**. Include deep links to:
- Logs Insights query that surfaced the patterns
- Application Signals operation view
- The specific traces sampled

## What this skill does NOT do

- Does not handle latency-only regressions — use `latency-regression`.
- Does not investigate cross-service breaches — use `slo-breach-investigation`.
- Does not analyze RUM session errors — out of scope for the AWS APM plugin.
