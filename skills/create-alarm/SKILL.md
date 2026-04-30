---
name: create-alarm
description: >
  Generate a prefilled CloudWatch alarm configuration as an `action_form`
  widget plus a copy-paste `aws cloudwatch put-metric-alarm` CLI
  command. Picks recommended thresholds from the configured baseline
  window (2× baseline for counts, p99 + 20% for latency, etc.), names
  alarms with the canonical convention, and applies the
  treat-missing-data defaults that match the metric class. Does not
  execute the alarm creation — the artifact deep-links to the console
  or hands the user a CLI to paste. Trigger phrases: "create alarm",
  "create cloudwatch alarm", "put-metric-alarm", "set up alarm for",
  "make an alarm for", "alarm for this metric", "prefill alarm",
  "alarm config", "alarm threshold for", "I want an alarm on",
  invoked by `/cw-create-alarm`, or as the next-step action in any
  `alerting-design`, `alarm-response`, or `error-spike-triage` artifact.
metadata:
  version: "0.1.0"
---

# Create Alarm

Skill that turns "I want an alarm on this metric" into a renderable
`action_form` widget the user can review, copy, and apply themselves —
either via the AWS console deep link or by pasting the generated
`aws cloudwatch put-metric-alarm` command.

This is a **design-and-prefill** skill, not an apply skill. See
[ACTION-SAFETY-MODEL.md](../../ACTION-SAFETY-MODEL.md): alarm creation is
Tier 3 (console deep link) by default; Tier 4 (MCP-executed) only with
explicit chat confirmation.

## When this activates

- After an `alerting-design` Phase 4 recommendation: the user picks one
  recommended row and asks "create that alarm now" — render the form so
  they can apply it themselves.
- After an `alarm-response` or `error-spike-triage` produces a
  recommendation that "you should also have an alarm on X" — emit the
  prefilled form rather than just describing the alarm in prose.
- Direct invocation: the user asks for an alarm on a specific metric
  outside any incident workflow.

## Context provider

Read the following from the plugin's context:

- `context.region` — pass to all MCP calls and embed in the CLI command.
- `context.account` — embed in SNS topic ARN suggestions; surface in the
  form's safety footer for cross-check.
- `context.service` — used as the dimensions value for service-level
  metrics and as the prefix for the alarm name.
- `context.environment` — affects threshold strictness (prod tighter,
  dev looser); embedded in the alarm name suffix.

## MCP tool dependencies

- `awslabs.cloudwatch-mcp-server` — `get_metric_data`,
  `get_metric_metadata`, `list_metrics` (read-only — confirm metric
  exists and pull baseline).
- `awslabs.cloudwatch-applicationsignals-mcp-server` (optional) — for
  SLO-derived alarm recommendations.
- `awslabs.aws-documentation-mcp-server` (optional) — cite the AWS docs
  page that recommends the threshold style.

**Never call `Put*`, `Update*`, `Create*`, `Modify*`, or `Delete*`.**
The PreToolUse hook will gate them but the rule is the rule.

## Workflow

### Phase 1 — Resolve metric and dimensions

1. Confirm the user-provided metric name exists in the configured
   region. If only `Metric` is given, infer the namespace from the
   service kind (Lambda → `AWS/Lambda`, ECS → `AWS/ECS`, ALB →
   `AWS/ApplicationELB`, custom → ask).
2. Pick the right dimensions for the resource:

   | Service | Dimension | Source |
   |---|---|---|
   | Lambda    | `FunctionName=<service>` | `context.service` |
   | API GW    | `ApiName=<service>`      | `context.service` |
   | ALB       | `LoadBalancer=<arn-suffix>` | resolve from ALB ARN |
   | ECS       | `ClusterName=<cluster>,ServiceName=<service>` | `context.service` |
   | RDS       | `DBInstanceIdentifier=<instance>` | resource lookup |
   | DynamoDB  | `TableName=<table>` | resource lookup |
   | SQS       | `QueueName=<queue>` | resource lookup |
   | App Signals SLO | `SloName=<slo>,OperationName=<op>` | SLO ARN |

3. If the metric does not appear in the region's `list_metrics` results
   for the inferred dimensions, **stop and ask the user** — do not
   fabricate dimensions. Common cause: wrong region, or metric is
   custom-emitted under a different namespace.

### Phase 2 — Pull baseline

Fetch the last 7 days of the metric (configurable). Compute:

- `median`, `p95`, `p99`, `max` for the period
- `avg_per_min` for count-style metrics
- `count_breaching_zero` if the metric is naturally zero
- The baseline window's start / end ISO timestamps — for the form footer

If the metric has fewer than 24 hours of data, **cap the recommendation
confidence at Medium** and document this in the form's safety note.

### Phase 3 — Recommend threshold

Apply per-metric-class rules. The defaults below are starting points,
not gospel — surface the rule used so the user can override knowingly.

#### Count metrics (Errors, Throttles, Faults, DLQ depth)

| Metric class | Default threshold | Statistic | Period | Eval periods | Datapoints to alarm | Treat missing |
|---|---|---|---|---|---|---|
| `Errors` (Lambda, ECS), `5XXError` (API GW, ALB) | `max(2× baseline_p95, 5)` over 5 min, OR rate-based `errors / invocations > 1%` | `Sum` | 60 | 5 | 5 | `notBreaching` |
| `Throttles` | `> 0` over 1 min, single datapoint | `Sum` | 60 | 1 | 1 | `notBreaching` |
| `4XXError` | `2× baseline_p95` (only if you have a steady client base) | `Sum` | 300 | 2 | 2 | `notBreaching` |
| DLQ depth (`ApproximateNumberOfMessagesVisible`) | `> 0` for 5 min | `Maximum` | 60 | 5 | 5 | `breaching` |
| `WriteThrottleEvents`, `ReadThrottleEvents` (DynamoDB) | `> 0` over 1 min | `Sum` | 60 | 1 | 1 | `notBreaching` |

#### Latency metrics

| Metric class | Default threshold | Statistic | Period | Eval / datapoints | Treat missing |
|---|---|---|---|---|---|
| `Duration` (Lambda) — p99 | `baseline_p99 × 1.20` (capped at function timeout × 0.8) | `p99` | 60 | 5 / 5 | `notBreaching` |
| `TargetResponseTime` (ALB) — p99 | `baseline_p99 × 1.20` | `p99` | 60 | 5 / 5 | `notBreaching` |
| `Latency` (API GW) — p99 | `baseline_p99 × 1.20` | `p99` | 60 | 5 / 5 | `notBreaching` |
| Custom service p99 | `baseline_p99 × 1.20` | `p99` | 60 | 5 / 5 | `notBreaching` |

#### Saturation metrics

| Metric class | Default threshold | Statistic | Period | Eval / datapoints | Treat missing |
|---|---|---|---|---|---|
| `CPUUtilization` | `80%` sustained 5 min | `Average` | 60 | 5 / 5 | `notBreaching` |
| `MemoryUtilization` | `85%` sustained 5 min | `Average` | 60 | 5 / 5 | `notBreaching` |
| `DatabaseConnections` (RDS) | `0.8 × max_connections` | `Maximum` | 60 | 5 / 5 | `notBreaching` |
| `FreeStorageSpace` (RDS) | absolute floor (per instance class) | `Minimum` | 300 | 2 / 2 | `breaching` |
| `IteratorAge` | `60_000` ms (1 min behind) | `Maximum` | 60 | 5 / 5 | `notBreaching` |

#### Availability / SLO metrics

| Metric class | Default threshold | Statistic | Period | Eval / datapoints | Treat missing |
|---|---|---|---|---|---|
| App Signals SLO `BurnRate` (fast burn) | `> 14` over 1 hour window | `Average` | 60 | 60 / 5 | `notBreaching` |
| App Signals SLO `BurnRate` (slow burn) | `> 6` over 6 hour window | `Average` | 300 | 72 / 5 | `notBreaching` |
| App Signals `Availability` | below SLO target by `0.5%` | `Average` | 300 | 3 / 3 | `breaching` |

#### Anomaly detection candidates

If the metric is **seasonal** (daily / weekly variance > 3×) and has at
least 14 days of history, recommend `ANOMALY_DETECTION_BAND` instead of
a static threshold and surface that as a separate field set in the form
(`anomaly_detector_metric_math` + `threshold_metric_id`). Common
candidates: API request count, end-of-month batch volume.

### Phase 4 — Render the artifact

Emit a `hybrid-renderer` manifest with **one** `action_form` widget. The
form's `data` object MUST contain:

```json
{
  "action_id": "create_metric_alarm",
  "label": "Create CloudWatch Alarm — <Service> <Metric>",
  "description": "<one-line summary including the recommended threshold and why>",
  "mcp_tool": "mcp__awslabs__cloudwatch_mcp_server__PutMetricAlarm",
  "tier": 4,
  "blast_radius": "single alarm; no impact on metric data",
  "reversible": true,
  "rollback_plan": "DeleteAlarms with the alarm name — console deep link in this artifact",
  "side_effect_detection": "Watch the alarm's state-history page after applying",
  "fields": [
    { "key": "AlarmName", "label": "Alarm name", "type": "text",
      "value": "<service>-<resource>-<metric>-<stat>-<sev>",
      "source": "naming convention", "required": true,
      "validation": { "pattern": "^[A-Za-z0-9_\\-\\.]+$", "max_length": 255 } },
    { "key": "Namespace", "label": "Namespace", "type": "text",
      "value": "AWS/Lambda", "source": "metric metadata", "required": true },
    { "key": "MetricName", "label": "Metric name", "type": "text",
      "value": "Errors", "source": "metric metadata", "required": true },
    { "key": "Statistic", "label": "Statistic", "type": "select",
      "value": "Sum", "source": "metric class default",
      "options": [
        { "value": "Sum",     "label": "Sum" },
        { "value": "Average", "label": "Average" },
        { "value": "Minimum", "label": "Minimum" },
        { "value": "Maximum", "label": "Maximum" },
        { "value": "p90",     "label": "p90" },
        { "value": "p95",     "label": "p95" },
        { "value": "p99",     "label": "p99" }
      ] },
    { "key": "Period", "label": "Period", "type": "number",
      "value": 60, "unit": "seconds",
      "source": "metric class default",
      "validation": { "min": 10, "step": 10 } },
    { "key": "EvaluationPeriods", "label": "Evaluation periods", "type": "number",
      "value": 5, "source": "metric class default",
      "validation": { "min": 1, "max": 1440 } },
    { "key": "DatapointsToAlarm", "label": "Datapoints to alarm", "type": "number",
      "value": 5, "source": "metric class default",
      "validation": { "min": 1, "max": 1440 } },
    { "key": "ComparisonOperator", "label": "Comparison operator", "type": "select",
      "value": "GreaterThanThreshold",
      "source": "metric class default",
      "options": [
        { "value": "GreaterThanThreshold",          "label": "> (Greater than)" },
        { "value": "GreaterThanOrEqualToThreshold", "label": "≥ (Greater than or equal)" },
        { "value": "LessThanThreshold",             "label": "< (Less than)" },
        { "value": "LessThanOrEqualToThreshold",    "label": "≤ (Less than or equal)" }
      ] },
    { "key": "Threshold", "label": "Threshold", "type": "number",
      "value": 5, "unit": "<metric unit>",
      "source": "<rule used> on <baseline window>",
      "help": "<one-liner showing the math: baseline_p95=2.4 → 2× → 5>" },
    { "key": "TreatMissingData", "label": "Treat missing data as", "type": "select",
      "value": "notBreaching",
      "source": "metric class default",
      "options": [
        { "value": "notBreaching", "label": "notBreaching" },
        { "value": "breaching",    "label": "breaching" },
        { "value": "ignore",       "label": "ignore" },
        { "value": "missing",      "label": "missing" }
      ] },
    { "key": "Dimensions", "label": "Dimensions", "type": "textarea",
      "value": "Name=FunctionName,Value=<service>",
      "source": "service binding",
      "help": "One Name=…,Value=… per line." },
    { "key": "AlarmActions", "label": "ALARM action (SNS topic ARN)", "type": "text",
      "value": "arn:aws:sns:<region>:<account>:critical-alerts",
      "source": "tier routing",
      "help": "Pick the topic that matches the severity tier (paging vs ticket vs log)." },
    { "key": "OKActions", "label": "OK action (SNS topic ARN)", "type": "text",
      "value": "arn:aws:sns:<region>:<account>:critical-alerts",
      "source": "recommended for paging tier" }
  ],
  "context": {
    "region": "<region>",
    "account": "<account>",
    "service": "<service>",
    "environment": "<environment>"
  },
  "deep_link": "<https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#alarmsV2:create?...>",
  "deep_link_label": "Open Create Alarm in CloudWatch console",
  "cli_command": "aws cloudwatch put-metric-alarm \\\n  --alarm-name \"<name>\" \\\n  --namespace \"<ns>\" \\\n  --metric-name \"<metric>\" \\\n  --statistic \"<stat>\" \\\n  --period <period> \\\n  --evaluation-periods <eval> \\\n  --datapoints-to-alarm <dp> \\\n  --threshold <thr> \\\n  --comparison-operator \"<op>\" \\\n  --treat-missing-data \"<tmd>\" \\\n  --dimensions \"<dims>\" \\\n  --alarm-actions \"<sns-arn>\" \\\n  --ok-actions \"<sns-arn>\" \\\n  --region <region>",
  "cli_label": "Copy CLI command",
  "safety_note": "Tier 4 write — reviewed, but not yet applied. Click the console button or paste the CLI to apply."
}
```

The manifest envelope:

```json
{
  "version": "1.0",
  "metadata": {
    "title": "Create Alarm — <service> <metric>",
    "subtitle": "Recommended threshold: <thr> <unit> (rule: <rule>, baseline window <window>)",
    "severity": "info",
    "query_intent": "create-alarm"
  },
  "widgets": [
    { "type": "action_form", "priority": 1, "data": { ... } }
  ]
}
```

Single high-density widget → renderer infers `single-focus` shell.
That's the right shape: the form is the artifact.

## Naming convention

Use:

```
<service>-<resource>-<Metric>-<Statistic>-<Severity>
```

Examples:

- `checkout-api-Lambda-Errors-Sum-Critical`
- `checkout-api-Lambda-Duration-p99-Warning`
- `payments-API-5XXError-Sum-Critical`
- `cart-table-WriteThrottleEvents-Sum-Critical`

Severity tier mapping in the suffix (`Critical`, `Warning`, `Info`)
mirrors the Phase 5 routing in `alerting-design`.

## Action safety

This skill **never** calls `PutMetricAlarm` via MCP. The artifact is
the deliverable. If the user explicitly asks the model to apply the
alarm via MCP, refuse and re-explain: alarm creation is a deployment
event and should ride through the normal IaC pipeline. If the user
insists, defer to the standard Tier-4 confirmation block (see
`error-spike-triage` for the canonical structured-approval shape) and
require the exact `CONFIRM PutMetricAlarm` phrase before acting — but
strongly prefer the deep-link / CLI path.

The form's `tier: 4` field surfaces this in the rendered widget so the
user sees the disposition before touching any control.

## Degraded data handling

| Gap | Detect | Behavior | Confidence cap |
|---|---|---|---|
| Metric not in `list_metrics` | empty result | Stop, ask user to confirm namespace and dimensions; do not fabricate | N/A |
| Baseline window <24h | `get_metric_data` returns < 1440 datapoints at 60s period | Render the form with `safety_note` warning that the threshold is provisional; cap confidence at Medium | Medium |
| `get_metric_data` AccessDenied | tool error | Refuse to render; surface remediation from `aws-apm-setup` | N/A |
| User did not supply a service / resource | parse | Ask before rendering; the dimensions field cannot be filled defensively | N/A |
| AWS docs MCP unavailable | tool error | Render the form without a citation link; note "AWS doc citations unavailable" in `safety_note` | unaffected |

## Empty states

- **No metric data in the window** → render the form with `Threshold`
  blank, the `source` set to "no baseline available — pick manually",
  and a `safety_note` explaining the user must set the threshold by
  hand. Do not invent a value.
- **Metric exists but is always zero** → recommend `> 0` with a single
  datapoint over 1 min. Document the rationale in the `Threshold`
  field's `help`.

## What this skill does NOT do

- Does not actually create alarms — see `alerting-design` Phase 4 for
  the broader audit and recommendation workflow; this skill is the
  apply-prep step that follows from a single recommendation.
- Does not modify or delete existing alarms.
- Does not propose composite alarms — that requires a multi-form
  artifact pattern not yet in the renderer.
- Does not provision SNS topics or PagerDuty services. The form asks
  for the existing topic ARN; if the user doesn't have one, point them
  at the SNS console deep link.
