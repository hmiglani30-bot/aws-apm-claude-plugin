---
name: alarm-response
description: >
  Respond to a fired CloudWatch alarm end-to-end — parse alarm metadata, pull the
  current metric values and trends, correlate with traces and logs for the affected
  service, check CloudTrail for recent config / deploy changes, and rank remediation
  hypotheses with evidence.
  Trigger phrases: "alarm fired", "alarm went off", "CloudWatch alarm", "alarm triggered",
  "alarm in ALARM state", "investigate alarm", "alarm response", "responding to alarm",
  "PagerDuty alarm", "OpsGenie alarm", "alarm paging", "metric alarm fired",
  "composite alarm", "alarm ARN", "got paged for alarm", "alarm notification",
  or any request about diagnosing why a CloudWatch alarm transitioned to ALARM.
metadata:
  version: "0.1.0"
---

# CloudWatch Alarm Response

End-to-end workflow for diagnosing a fired CloudWatch alarm using the CloudWatch,
Application Signals, and CloudTrail MCP servers. The goal is to produce a structured
**Service Health Card** + **Top Suspected Cause** the on-call engineer can act on
without leaving Claude.

## When this activates

Triggers on any of:
- A user pastes an alarm name, alarm ARN, or alarm notification
- A user reports "we got paged" / "an alarm fired"
- A composite or metric alarm transitioned to `ALARM` and the user wants to triage

If the alarm is on a metric that maps to an SLO that is *also* breaching, prefer
`slo-breach-investigation` — it is the strict superset for SLO-driven pages.

## Required MCP servers

- `awslabs.cloudwatch-mcp-server` — alarm metadata, metrics, logs
- `awslabs.cloudwatch-applicationsignals-mcp-server` — service map, traces, operations
- `awslabs.cloudtrail-mcp-server` — recent deploys / IAM / config changes

If any required MCP is not connected, run the `aws-apm-setup` skill before continuing.

## Presentation

How to surface progress while the alarm-response runs:

1. **Show reasoning before each phase.** Before each phase, write a one-line thought
   explaining what you are about to do and why — e.g. "Resolving the alarm to its
   underlying metric and dimensions before deciding whether this is a latency, error,
   or capacity story." Make the response inspectable, not a black box.
2. **Label tool calls in human-readable terms.** When invoking MCP tools, prefix each
   call with a plain-English label ("Resolving alarm config…", "Pulling alarm metric
   vs baseline…", "Searching CloudTrail for changes near the state transition…")
   rather than dumping raw API or tool names. Raw names go in the metadata footer.
3. **Track phases with `TodoWrite`.** At the start of the workflow, create a todo
   per phase (Parse alarm, Pull current values, Correlate traces/logs, Check
   CloudTrail, Rank hypotheses). Mark each `in_progress` when you start it and
   `completed` when its data is in hand. Exactly one phase is `in_progress` at a
   time.

## Investigation workflow

### Phase 1 — Parse alarm details

1. Resolve the alarm by name or ARN and pull its full configuration:
   - **Metric**: namespace, metric name, dimensions
   - **Threshold**: value, comparison operator, evaluation period
   - **Service / resource**: which Application Signals service or AWS resource the alarm
     watches (derive from dimensions if not explicit)
   - **Duration**: how long it has been in `ALARM` (state transition timestamp)
   - **Composite alarms**: if this is a composite, recursively resolve child alarms and
     identify which one(s) actually fired
2. Classify the alarm:
   - **Latency alarm** — metric is `Latency`, `Duration`, `p99`, etc.
   - **Error alarm** — metric is `Errors`, `5XXError`, `FaultRate`, `ThrottledRequests`
   - **Resource alarm** — `CPUUtilization`, `MemoryUtilization`, queue depth, etc.
   - **Custom / business metric** — any user-defined namespace
3. Note the alarm's **Insufficient Data** history — flapping alarms vs. clean transitions
   tell different stories.

The classification drives Phase 3 routing — error alarms pull failed traces, latency
alarms pull slow traces, resource alarms pull capacity-side signals.

### Phase 2 — Pull current metric values and recent trends

1. Fetch the underlying metric for:
   - Last 15 min (current — should still be over threshold)
   - Last 6h (to see when the breach started)
   - Same window 24h ago (yesterday baseline)
   - Same window 7 days ago (week-over-week baseline)
2. Distinguish:
   - **Step change** — clean transition at a specific minute → strong deploy / config signal
   - **Gradual climb** — metric trending up over hours → capacity / load signal
   - **Flapping** — repeatedly crossing threshold → noisy alarm, often a tuning issue
3. If the metric is per-instance / per-task, fan out to per-dimension values to detect
   **single-instance issues** (one bad host vs. fleet-wide).

### Phase 3 — Correlate with traces and logs

For the affected service (resolved in Phase 1):

1. **For latency alarms**: search slow traces (duration > current p99) in the alarm
   window. Pick 3–5 representative traces using the `trace-waterfall-summary` shape.
2. **For error alarms**: search failed traces (status = error) in the alarm window, and
   query Logs Insights for the same window grouping by `errorType` /
   `exception.type` — patterns first, raw second.
3. **For resource alarms**: pull supporting metrics (e.g. for CPU, also pull request
   rate, task count, autoscaling events; for queue depth, also pull producer / consumer
   rate).
4. For each artifact, extract:
   - Top contributor (operation, exception class, or instance)
   - One-line observation tying the trace / log back to the alarm metric

### Phase 4 — Check CloudTrail for recent config / deploy changes

1. Query CloudTrail for the alarm window ± 30 minutes (centered on the state transition):
   - Deploys (`UpdateService`, `UpdateFunctionCode`, `RegisterTaskDefinition`)
   - Config changes (`PutScalingPolicy`, `ModifyDBInstance`, `UpdateAlias`,
     `PutMetricAlarm` itself — sometimes a recent threshold change is the cause)
   - IAM changes (`AttachRolePolicy`, `PutRolePolicy`)
   - Networking (`AuthorizeSecurityGroupIngress`, `ModifyVpcAttribute`)
2. Rank changes by proximity to the alarm transition time and by whether they touched
   the affected service / resource.
3. Highlight any change in a service that appears on the trace path from Phase 3.

Follow the CloudTrail data source priority: Lake event data store → CloudWatch Logs
integration → Lookup Events API. Do not rely solely on Lookup Events for windows >7 days.

### Phase 5 — Rank hypotheses and recommend remediation

Produce 2–4 ranked hypotheses (use `top-suspected-cause` skill for the artifact). Each
hypothesis must include:
- One-line claim
- Evidence (specific metrics, logs, traces, deploys cited)
- Confidence (Low / Medium / High) with stated reason
- Suggested next action (read-only verification step, *not* a write action)

Common alarm-response hypotheses ranked by base rate:
1. **Bad deploy** — `Update*` event in CloudTrail within ±5 min of the alarm transition.
2. **Downstream dependency degradation** — slow / failing span on the trace path points
   to a service or DB that has its own active alarm or breach.
3. **Capacity / autoscaling lag** — request rate up + tasks unchanged → CPU contention.
4. **Threshold drift** — recent `PutMetricAlarm` lowered the threshold; the metric is
   normal but the alarm is now tighter.
5. **Noisy / flapping alarm** — repeated transitions with no underlying issue → recommend
   alarm tuning, not service remediation.

Bias toward hypotheses with multi-source evidence. A hypothesis backed only by metrics
is weaker than one with a matching trace exception or a coincident deploy.

## Final artifact

**Lead with a one-line verdict** before presenting the artifact. The verdict goes
ABOVE the artifact, in plain text, so it's the first thing the user reads. Shape:

> 🟠 **`PaymentLatency-p99` alarm fired at 14:23 UTC** — p99 up 4× from baseline on
> `payment-service`. Top hypothesis: deploy at 14:18 UTC (High confidence).

The verdict must name (1) the alarm and when it fired, (2) the magnitude of the
underlying metric move, (3) the affected service, and (4) the top-ranked hypothesis
with its confidence. If the alarm is flapping or noisy, lead with that instead
("⚠️ Flapping alarm — 6 transitions in 30 min, likely a tuning issue, not a service
problem"). Never hide the verdict inside the artifact.

Then present **Service Health Card** (for the affected service) + **Top Suspected
Cause** (for the ranked hypotheses). Both artifacts must include their metadata footer.

The Service Health Card must include:
- The alarm name + ARN as part of the header
- A "Why this fired" one-liner translating the alarm config into plain English
- RED metrics for the affected service
- Deep links into CloudWatch console (alarm detail, metric graph) via `open-in-cloudwatch`

## Action safety

**Read-only by default.** Never call write actions (PutMetricAlarm, DisableAlarm,
StartIncident, etc.) without an explicit `confirmation gate`. The plugin's PreToolUse
hook fails closed on state-changing MCP calls (Put / Update / Delete / Modify / Create
/ Remove / Disable / Enable / Attach / Detach / Tag / Untag / Set / Batch / Send /
Publish / Invoke / Execute / Run / Associate / Disassociate / Register / Deregister /
Restore / Reboot / Terminate / Start / Stop), but rely on the rule, not the hook.

Before proposing any write, render this **structured approval block** to the user and
wait for the exact confirmation phrase before re-issuing the call:

```
🛑 Write action proposed
- API action: mcp__awslabs.<server>__<ToolName>
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

For destructive or billing-impacting actions (delete log group, change alarm threshold,
modify IAM), prefer **deep linking** the user to the AWS console via `open-in-cloudwatch`
rather than executing through MCP — the approval block is for idempotent reversible
writes only.

## Redaction

**Redact PII, tokens, and customer identifiers from logs and traces before including
them in any output.** Phase 3 pulls failed traces and Logs Insights output that may
include user data, request bodies, or tokens — strip them before they reach the
artifact:

- Email addresses, user IDs, customer IDs, account numbers — replace with `<redacted-user>`
- Auth tokens, API keys, session IDs, JWTs, bearer tokens — replace with `<redacted-token>`
- IP addresses in user contexts (not service-internal IPs) — replace with `<redacted-ip>`
- Request / response bodies that include any of the above

Cite **patterns and exception classes**, not raw lines. If you cannot tell whether a
field is sensitive, redact it.

## Empty states and data unavailability

Surface missing data; do not hide it.

**Empty states (UX11)** — render a short, helpful message with a suggested
next action:

- **Alarm name not found** → "No alarm `<name>` in `<region>`. Confirm
  the alarm name spelling and region. List candidates if a substring
  matches: <list>."
- **Alarm has no underlying metric** (composite-only with all children
  unresolved) → "Composite alarm `<name>` has unresolved children.
  Surface child names and ask the user which to investigate."
- **Alarm dimensions don't map to an Application Signals service** → "No
  Application Signals service derives from this alarm's dimensions. Pull
  the raw metric and continue without service-map data; flag this in the
  artifact."
- **No state transitions in window** (alarm is in `OK`) → "Alarm is in
  `OK` state right now. Investigation runs on the most recent `ALARM`
  transition; if none exists, ask the user whether they intended to
  triage a different alarm."
- **Insufficient Data history** (alarm is flapping) → "Alarm has `<N>`
  transitions in the last 30 min — likely a tuning issue. Render the
  flapping verdict in the hero (`⚠️ Flapping alarm`) and recommend alarm
  config review rather than service remediation."

**Data unavailability (UX8)** — surface failures in the artifact's
data-unavailable banner. Examples:

> **Data unavailable** — CloudTrail Lake unreachable: AccessDenied.
> Change correlation skipped. Confidence capped at Medium.

> **Data unavailable** — Application Signals returned no service for the
> alarm's dimensions. Service-map evidence skipped; relying on raw
> metric + log evidence only.

The rule: a missing source caps confidence at Medium. State the cap in
the confidence justification per `investigation-validator`.

## What this skill does NOT do

- Does not diagnose SLO breaches when an SLO is the source of the page — use
  `slo-breach-investigation` instead.
- Does not handle latency regressions on services without a fired alarm — use
  `latency-regression`.
- Does not handle error spikes on services without a fired alarm — use
  `error-spike-triage`.
- Does not handle synthetics canary failures unless a CloudWatch alarm fired on the
  canary's `SuccessPercent` metric.
