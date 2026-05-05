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

## Rendering — do not author HTML

Delegate every visual artifact to the `hybrid-renderer` skill. Pass the data you
collected; let `hybrid-renderer` + `widget-catalog` choose the manifest, and let
`render-standalone.mjs` produce the HTML. Do not write `<html>` or any HTML
markup yourself, do not narrate the pipeline at the user, and do not invent
new widget types or shells. See top-level `CLAUDE.md` rule 1.

## When this activates

Activate ONLY when the user has asked for investigation, triage, or
root-cause analysis of an error situation that already shows a delta
from baseline. Concretely:

- Error rate jumped above baseline (delta is in the prompt or evident
  from a cited metric)
- Specific 5xx / 4xx pattern reported with cause-finding intent
- An alarm on `ErrorCount` / `FaultRate` triggered and the user wants to
  triage
- The user used words like "investigate", "triage", "what's going on",
  "why are errors up", "diagnose", or "root cause"

If an availability SLO is breaching as a result, prefer
`slo-breach-investigation` — it includes this workflow.

## When NOT to activate

The 6-phase triage takes ~60–90 seconds. Lookup-style and yes/no
questions do not justify it. **Do not activate** for:

- **Lookups** — "what's the error rate on `<svc>`?", "how many 5xx in
  the last hour?", "show me errors for X". Answer text-only with one
  `get_service` / `get_metric_data` call. ≤ 80 words. No Logs Insights,
  no trace sampling, no CloudTrail correlation.
- **Yes/no health checks** — "any errors right now?", "is `<svc>`
  erroring?". Answer in one sentence after one MCP call.
- **Sweeps / inventory** — "any services erroring?", "show me errors
  across the fleet". Defer to a direct sweep using
  `list_services` + `get_service`, or to `/cw-health-check`.
- **Single-number cites without delta intent** — the user is reading a
  dashboard and asking what a number is. Answer the question, don't
  triage.
- **Trigger-phrase overlap with no investigation intent** — words like
  "errors", "5xx", "fault" appear in many non-incident contexts.
  Activate only when the user is asking for cause, not just for the
  number.

If unsure, ask one clarifying question ("Do you want a quick number, or
should I run the full triage?") rather than running the full 6-phase
workflow.

## Context provider

Read these fields from the context provider (ARCHITECTURE.md context shape):

- `context.service` -- the Application Signals service name experiencing the error spike
- `context.region` -- AWS region (pass to all MCP calls)
- `context.account` -- AWS account ID (include in metadata footer)
- `context.time_window.start` / `.end` -- error spike window
- `context.environment` -- prod / staging / dev
- `context.data_sources_available.application_signals` -- MUST be true
- `context.data_sources_available.cloudwatch_logs` -- needed for Logs Insights pattern detection
- `context.data_sources_available.cloudtrail` -- needed for change correlation

## MCP tool dependencies

- `awslabs_cloudwatch-applicationsignals-mcp-server` -- `list_service_operations`, `get_top_contributors`, `get_trace_summaries`, `batch_get_traces`
- `awslabs_cloudwatch-mcp-server` -- `get_metric_data`, `start_query`, `get_query_results`
- `awslabs_cloudtrail-mcp-server` -- `lookup_events`

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

### Phase 1b — Compute blast radius

Before localizing, compute the **blast radius** of the spike. This
becomes a section of the final artifact and feeds the
`copy-to-incident` skill's customer / exec summaries. Capture all of:

- **Affected operations** — names + share of total error volume.
- **Callers** — every Application Signals service hitting these
  operations during the spike. Pull from the service map.
- **AZ / region** — concentrated in one AZ (single-instance / AZ issue)
  or fleet-wide? If the metric supports per-AZ breakdown, compute it;
  else note "AZ breakdown unavailable."
- **Customer segments** — group failed requests by `tenantId`,
  `customerTier`, or whatever segmentation tag the service emits. If no
  such tag exists, note "customer-segment data unavailable" rather than
  guessing.
- **Upstream services** — for each caller, note whether *they* are also
  spiking errors or alarming. A caller that's silently absorbing 5xx is
  different from one that's also breaching.
- **Estimated failed requests** — bad-event count over the spike window.
  Compute as: `(error rate now − baseline error rate) × request rate ×
  duration`. Round and surface uncertainty (e.g. "~1,200 failed
  requests, ±20%").
- **Severity label** — proposed SEV1 / SEV2 / SEV3 / SEV4:
  - SEV1: 5xx, customer-facing, broad caller fan-out, >5% of total
    requests failing
  - SEV2: 5xx, customer-facing, narrow scope OR <5% but rising
  - SEV3: internal-only callers OR pure 4xx storm with low rate
  - SEV4: internal tooling / synthetics-only impact
  This is a **proposal** — the IC makes the final call.

Render this as a "Blast radius" subsection. If any field is unavailable,
say so explicitly rather than omitting the line.

### Phase 2 — Localize: which operation, which exception class?

1. Rank operations on the service by error count contribution.
2. For each top operation, query Logs Insights for the spike window:
   - Group by `errorType` / `exception.type` / `error.class`
   - Top 5 patterns by count
   - Sample 2 raw log lines per pattern
3. Render as patterns first, raw second (this is the canonical AWS APM logs UX).

Example Logs Insights query (structured JSON logs):
```
fields @timestamp, @message, level, errorType, exception
| filter level = "ERROR"
| stats count() as occurrences by errorType
| sort occurrences desc
| limit 5
```

**If logs are unstructured (e.g., Lambda using `print()`, plain stdout, or no JSON
formatter), use these alternative queries:**

Detect error lines in unstructured logs:
```
fields @timestamp, @message
| filter @message like /(?i)(error|exception|traceback|fault|failed)/
| sort @timestamp desc
| limit 50
```

Cluster by exception class without structured fields (greedy regex on common shapes):
```
fields @timestamp, @message
| parse @message /(?<exc>[A-Z]\w+(Error|Exception))/
| filter ispresent(exc)
| stats count() as occurrences by exc
| sort occurrences desc
| limit 5
```

Pull stack-trace samples from Python / Java / Node logs:
```
fields @timestamp, @message
| filter @message like /Traceback|at \w+\.\w+\(|^\s+at /
| sort @timestamp desc
| limit 5
```

**Two-stage strategy:** always try the structured query first. If it returns 0 rows
(or `errorType` is null in every row), fall back to the unstructured queries above.
For Lambda functions specifically, the conventional log group is
`/aws/lambda/<function-name>` — use this as a fallback if Application Signals does
not surface a log group for the service.

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

## False-positive / noisy-spike handling

Before presenting a verdict, run these checks. If any apply, the spike
may be a measurement artifact or operationally-expected and not a real
customer-impacting problem. Surface the finding **above** the artifact
and downgrade the verdict accordingly.

1. **Traffic too low** — request rate is <1 req/min, or <1% of typical.
   A handful of error events flips a low-volume service into "spike" by
   percentage. Note: "Low traffic — single-event sensitivity, error rate
   may not represent meaningful impact."
2. **Sample size too small** — fewer than 100 requests in the spike
   window. Error rate math is unreliable. Note: "Sample size <100 — rate
   confidence is Low."
3. **Deploy window expected** — CloudTrail shows a `RegisterTaskDefinition`
   / `UpdateService` / `UpdateFunctionCode` exactly at spike start AND
   the team has documented "expected error blip during deploy" pattern.
   If the spike decays within the post-deploy stabilization window,
   label "Expected deploy-window noise" — but do NOT auto-suppress.
4. **Alarm / SLO recently edited** — `PutMetricAlarm` in the last 24h
   tightened the threshold. The metric may not have moved; the bar
   moved. Surface the edit and the "before" threshold so the user can
   judge. Same applies if the SLO fed by this metric was just retargeted.
5. **Missing data** — metric publisher gaps, agent restart, region-wide
   CloudWatch incident. Detect via timestamps with no datapoints. Note:
   "Missing data — error rate computation includes treat-missing-data
   behavior; verify in console."
6. **Synthetic-only failure** — the spike is from synthetics canary
   traffic only; real-user traffic to the same operations looks normal.
   Often a canary credential / network issue, not service. Note:
   "Synthetics-only — real user traffic on the same operations is
   healthy."

If two or more conditions hold, downgrade to ⚠️ and lead with "Possible
false positive — <reasons>." Do not present 🔴 spike until at least one
false-positive condition is ruled out OR the user confirms it's real.

## Degraded telemetry handling

If the inputs you need are unavailable, the triage must gracefully
degrade rather than fabricate. Detect each gap and apply the matching
rule. Cap final confidence based on the worst gap, and tell the user
explicitly which signals were missing.

| Gap | Detect | Behavior | Confidence cap |
|---|---|---|---|
| Traces missing | `search_traces` for failed traces returns 0 results when error metrics show events | Skip Phases 3 + 6 trace-based steps; rely on metrics + logs only | Medium |
| Logs not correlated to traces | No `traceId` field on log lines for the affected operation | Surface log patterns without trace cross-reference; note explicitly | Medium |
| Logs Insights query times out / returns empty | `StartQuery` succeeds but `GetQueryResults` returns no rows for the spike window | Skip pattern detection; surface raw error counts only | Medium |
| SLOs absent | `list_slos` returns empty; spike has no SLO consumer | Continue — error-spike-triage doesn't require SLOs. Note "no SLO context" in artifact | None |
| CloudTrail denied | `AccessDenied` on `LookupEvents` / Lake / Logs integration | Skip Phase 4 entirely; surface "Cannot correlate with CloudTrail" | Medium |
| Operation-level metrics flat | `get_service_operations` returns no per-operation breakdown | Skip Phase 2 ranking; analyze service-level only | Medium |
| Application Signals service map empty | No callers / dependencies returned | Skip blast radius "Callers" + "Upstream services" lines | Low for blast radius |
| All telemetry unavailable | `list_services` errors or returns empty | Stop. Run `/cw-doctor` and `/cw-set-context` first | N/A — refuse to run |

Always tell the user which signals degraded. A hedged artifact beats a
confident-looking one built on missing data.

## Final artifact

**Lead with a one-line verdict** before presenting the artifact. The verdict goes
ABOVE the artifact, in plain text, so it's the first thing the user reads. Shape:

> 🔴 **5xx rate up 14× since 14:20 UTC** on `POST /checkout` — single
> `NullPointerException` cluster, correlated with deploy at 14:18 UTC. Top
> hypothesis: bad deploy (High confidence).

The verdict must name (1) the magnitude of the spike, (2) the worst operation, (3)
the dominant exception class or pattern, and (4) the top-ranked hypothesis with its
confidence. Never hide the verdict inside the artifact.

Then present **Service Health Card** + **Top Suspected Cause**. Include
deep links to:
- Logs Insights query that surfaced the patterns
- Application Signals operation view
- The specific traces sampled

Both artifacts must include:
- **Blast radius** subsection (from Phase 1b): callers, AZ/region scope,
  customer segments, upstream services, estimated failed requests,
  proposed severity label.
- **Owner + suggested page** (from `service-ownership` skill).
- **False-positive checks** — list each condition checked + result.
- **Degraded-telemetry note** (if any signal was missing) with the
  capped confidence label.

For a full postmortem-style writeup (timeline + root cause + impact + remediation),
use the artifact template at `artifacts/investigation-summary.html` and populate the
`{{PLACEHOLDERS}}` with actual data — see that file for the full placeholder list.

## Action safety

**Read-only by default.** Never call write actions without an explicit confirmation
gate. The plugin's PreToolUse hook fails closed on state-changing MCP calls (Put /
Update / Delete / Modify / Create / Remove / Disable / Enable / Attach / Detach / Tag
/ Untag / Set / Batch / Send / Publish / Invoke / Execute / Run / Associate /
Disassociate / Register / Deregister / Restore / Reboot / Terminate / Start / Stop),
but rely on the rule, not the hook.

Before proposing any write, render this **structured approval block** to the user and
wait for the exact confirmation phrase before re-issuing the call:

```
🛑 Write action proposed
- API action: mcp__awslabs_<server>__<tool_name>
- Target ARN: <fully-qualified ARN or resource ID>
- Region / account: <region> · <account>
- Arguments: <full JSON the tool will receive>
- Blast radius: <single resource | service-wide | account-wide | cross-account>
- Reversible? <yes — how | no — why>
- Rollback plan: <exact reverse action and how to verify it took effect>
- Side-effect detection: <metric / log / event the user should watch post-write>

Type CONFIRM <ToolName> to proceed. Any other reply cancels.
```

Do not paraphrase or shorten this block — the structure is the safety surface. If any
field is unknown, say so explicitly ("blast radius unknown — refusing to propose").

For destructive or billing-impacting actions, prefer deep-linking the user to the AWS
console via `open-in-cloudwatch` rather than executing through MCP — the approval
block is for idempotent reversible writes only.

## Redaction

**Redact PII, tokens, and customer identifiers from logs and traces before including
them in any output.** Logs Insights queries in Phase 2 commonly surface raw user data
in `@message` and request-body fields — sample lines must be redacted before they
appear in the artifact:

- Email addresses, user IDs, customer IDs, account numbers — replace with `<redacted-user>`
- Auth tokens, API keys, session IDs, JWTs, bearer tokens — replace with `<redacted-token>`
- IP addresses in user contexts (not service-internal IPs) — replace with `<redacted-ip>`
- Request bodies that include any of the above

Cite **patterns and exception classes**, not raw lines. The artifact's value is in the
*shape* of the failure (errorType, count, operation), not in the specific user who hit
it. If you cannot tell whether a field is sensitive, redact it.

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
