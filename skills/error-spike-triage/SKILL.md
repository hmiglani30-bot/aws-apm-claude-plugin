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

## Presentation

How to surface progress while the triage runs:

1. **Show reasoning before each phase.** Before each phase, write a one-line thought
   explaining what you are about to do and why — e.g. "Grouping log lines by
   `errorType` to see whether this is one exception class spiking or a fan-out across
   many." Make the triage inspectable, not a black box.
2. **Label tool calls in human-readable terms.** When invoking MCP tools, prefix each
   call with a plain-English label ("Pulling error rate vs baseline…", "Running
   Logs Insights for top exception classes…", "Sampling failed traces…") rather than
   dumping raw API or tool names. Raw names go in the metadata footer.
3. **Track phases with `TodoWrite`.** At the start of the workflow, create a todo
   per phase (Quantify spike, Localize, Pull failing traces, Correlate changes,
   Hypothesize, Follow dependencies). Mark each `in_progress` when you start it and
   `completed` when its data is in hand. Exactly one phase is `in_progress` at a
   time.

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

### Phase 6 — Follow dependencies (cascading health check)

If Phase 5's top hypothesis is **downstream dependency failing** — or the failed traces
in Phase 3 consistently fail at a downstream span — follow the chain one hop:

1. **Pick the implicated downstream service.** Use the dependency named in the top
   hypothesis or the downstream span where the exception was thrown. Pick at most one.
2. **Run a service health snapshot on it.** Invoke the `service-health-card` skill on
   the dependency, scoped to the spike window.
3. **Include the result in the final summary.** Add a "Downstream dependency health"
   section to the Service Health Card / Top Suspected Cause output, showing the
   dependency's RED-metric verdict and any of its own SLOs in Warning / Breach. If the
   dependency's error rate has also spiked or any of its SLOs is breaching, escalate the
   "downstream dependency failing" hypothesis to High confidence and note that the
   spike most likely originated upstream of this service.
4. **Cap the chain at depth 2.** If the dependency's health card implicates *its*
   dependency, you may follow one more hop (depth 2) — but stop there. Note "Further
   dependencies not auto-followed" in the summary. Never follow a third hop. This is
   the loop guard.
5. **Skip the cascade entirely** if:
   - Top hypothesis is a bad deploy on this service, a credential rotation, or a
     bad-input pattern (no downstream component implicated)
   - The implicated dependency is outside the user's account (3rd-party API)
   - The spike is purely 4xx with no downstream involvement

## Final artifact

**Lead with a one-line verdict** before presenting the artifact. The verdict goes
ABOVE the artifact, in plain text, so it's the first thing the user reads. Shape:

> 🔴 **5xx rate up 14× since 14:20 UTC** on `POST /checkout` — single
> `NullPointerException` cluster, correlated with deploy at 14:18 UTC. Top
> hypothesis: bad deploy (High confidence).

The verdict must name (1) the magnitude of the spike, (2) the worst operation, (3)
the dominant exception class or pattern, and (4) the top-ranked hypothesis with its
confidence. Never hide the verdict inside the artifact.

Then present **Service Health Card** + **Top Suspected Cause**. Include deep links to:
- Logs Insights query that surfaced the patterns
- Application Signals operation view
- The specific traces sampled

For a full postmortem-style writeup (timeline + root cause + impact + remediation),
use the artifact template at `artifacts/investigation-summary.html` and populate the
`{{PLACEHOLDERS}}` with actual data — see that file for the full placeholder list.

## Empty states and data unavailability

Surface missing data; do not hide it.

**Empty states (UX11)** — render a short, helpful message with a suggested
next action:

- **No services found / wrong region** → "No Application Signals services
  in `<region>`. Confirm region or run `aws-apm-setup`."
- **No errors in the window** → "Error rate is at baseline; no spike
  detected. If user pasted an alarm name, confirm the alarm fired in this
  region/account. Otherwise widen the window or pivot to
  `latency-regression`."
- **No log group resolvable for the service** → "No log group found for
  `<service>`. Logs Insights pattern detection skipped; continue with
  trace + metric evidence."
- **No traces with status=error** → "No failed traces in window — errors
  may be returning at the edge before instrumented spans, or X-Ray
  sampled them out. Surface this gap in the artifact."
- **Multiple ambiguous services match** → "Multiple matches for `<name>`:
  <list>. Ask the user which one."

**Data unavailability (UX8)** — surface failures in the artifact's
data-unavailable banner. Examples:

> **Data unavailable** — Logs Insights query timed out after 30s. Pattern
> detection skipped for the worst operation; falling back to top-level
> error counts only. Confidence capped at Medium.

> **Data unavailable** — CloudTrail Lake unreachable: AccessDenied.
> Change correlation skipped. Confidence capped at Medium.

The rule: a missing source caps confidence at Medium. State the cap in
the confidence justification per `investigation-validator`.

## What this skill does NOT do

- Does not handle latency-only regressions — use `latency-regression`.
- Does not investigate cross-service breaches — use `slo-breach-investigation`.
- Does not analyze RUM session errors — out of scope for the AWS APM plugin.
