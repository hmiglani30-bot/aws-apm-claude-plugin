---
name: alerting-design
description: >
  Design intelligent CloudWatch alarms — audit existing alarms, identify
  coverage gaps for the AWS services in use, recommend per-service alarm
  configurations with thresholds and evaluation periods, suggest
  composite alarms and anomaly-detection candidates, reduce false
  positives and alarm fatigue, and design notification routing. Produces
  a prioritized Alerting Plan with IaC snippets and console deep links.
  Trigger phrases: "alerting plan", "alert design", "alarm design",
  "design alerts", "set up alarms", "what alarms should I have",
  "audit alarms", "alarm coverage", "alarm gaps", "alarm fatigue",
  "noisy alarms", "false positive alarms", "composite alarms",
  "anomaly detection alarms", "alarm thresholds", "PagerDuty routing for
  alarms", "SNS topics for alarms", "reduce paging volume",
  "production-readiness for alerts", "alert strategy", or any non-
  incident request to plan or improve alerts on an AWS account.
metadata:
  version: "0.1.0"
---

# Alerting Design

End-to-end workflow for **designing the alarm strategy for a service or
account** — what to alert on, what threshold, what evaluation period,
what to compose, what to route where. Produces an **Alerting Plan**
artifact ranked by priority, each item with a copy-paste IaC snippet
and a CloudWatch console deep link.

## When this activates

- Pre-production cutover: "we're about to launch — what alarms do we
  need?"
- Post-incident audit: "we missed this in monitoring — what should
  catch it next time?"
- Alarm fatigue triage: "the on-call channel is too noisy — clean it up"
- Periodic review: "audit our alarm portfolio for coverage and noise"

If the user is responding to an *active* alarm, prefer
`alarm-response` — that's the incident-time workflow, this is the
design-time workflow.

## Context provider

Read these fields from the context provider (ARCHITECTURE.md context shape):

- `context.region` -- AWS region (pass to all MCP calls)
- `context.account` -- AWS account ID (include in report header)
- `context.service` -- target service if scoped to one service (optional; if absent, audit all alarms in region)
- `context.environment` -- prod / staging / dev (affects threshold recommendations)
- `context.data_sources_available.cloudwatch_metrics` -- MUST be true

## MCP tool dependencies

- `awslabs_cloudwatch-mcp-server` -- `describe_alarms`, `get_metric_data`, `list_metrics`
- `awslabs_aws-documentation-mcp-server` -- `search_documentation` (alarm best-practice citations)

The Application Signals and CloudTrail MCP servers are **not required**.
This is a design workflow, not an incident workflow.

## Presentation

1. **Show reasoning before each phase.** Before each phase, write a
   one-line thought ("Pulling 7d of alarm-state transitions first to
   detect noisy alarms — high churn means low signal, and those are
   higher priority to fix than missing alarms.").
2. **Label tool calls in human-readable terms.** Prefix MCP calls with
   plain-English labels ("Listing active alarms in `us-east-1`…",
   "Fetching alarm history for the last 7 days…", "Pulling recommended
   alarms for `AWS/Lambda`…").
3. **Track phases with `TodoWrite`.** One todo per phase (Inventory,
   Noise audit, Coverage matrix, Recommend, Route, Render plan). Exactly
   one phase `in_progress` at a time.

## Workflow

### Phase 1 — Inventory existing alarms

1. List all metric alarms and composite alarms in the configured region.
   Capture per alarm:
   - Name, ARN, namespace, metric name, statistic
   - Threshold, comparison operator, evaluation periods, datapoints to
     alarm, treat-missing-data behavior
   - Actions (ALARM, OK, INSUFFICIENT_DATA — SNS topics, Lambda,
     EC2 / EKS Auto Scaling, Systems Manager)
   - Current state, state reason, last state-transition timestamp
2. Group alarms by:
   - Service / namespace (Lambda, ECS, ALB, RDS, DynamoDB, SQS, SNS,
     API Gateway, Application Signals, custom)
   - Severity inferred from action target (paging topic vs. ticketing
     topic vs. logging-only topic)
3. If the configured account has **no alarms at all**, lead with that
   finding — the rest of the workflow becomes greenfield design rather
   than audit.

### Phase 2 — Noise and fatigue audit

For each existing alarm, pull its 7-day state history. Flag any of:

| Symptom | Threshold | What it means | Recommendation |
|---|---|---|---|
| Fired ≥10× in 7d | High churn | Threshold too tight, or metric too noisy | Widen threshold OR move to anomaly detection OR add `M-of-N` |
| `INSUFFICIENT_DATA` >50% of time | Permanent | Metric publisher is gone or filtered out | Delete alarm OR fix metric pipeline |
| Always in `OK` for 30+ days | Possibly dead | Metric never crosses threshold, or service decommissioned | Verify metric is still emitted; raise threshold to be meaningful, or delete |
| ALARM duration <5 min average | Flapping | Single-datapoint alarm, no debounce | Increase `evaluation_periods` and `datapoints_to_alarm` |
| Threshold = 0 on a count metric | Trivially fires | "ErrorCount > 0" pages on every error | Switch to a rate or compare to baseline |
| No `OKActions` | Recovery silent | On-call doesn't know when the page resolved | Add `OKActions` to the same SNS topic |
| Action targets a generic catch-all SNS | Routing collapse | Everything pages everyone | Re-route per severity (see Phase 5) |
| Last state edit <24h ago | Recently retuned | The bar may have just moved — context for any current breach | Note in the audit |

Surface every noisy alarm in a "Noise to fix first" subsection of the
final report — these are higher leverage than missing alarms because
they actively erode trust in the system.

### Phase 3 — Coverage matrix

Build a matrix of *what services are in use* × *what alarms each one
should have*. For each service the account uses, check whether the
recommended alarms exist and meet the recommended shape.

The canonical recommendations (cite AWS docs MCP for specifics; these
are the defaults):

#### Lambda
- **Errors** — `Errors` metric, sum, threshold `>0` over 1 min for
  paging; or rate-based `Errors / Invocations > 1%` over 5 min
- **Throttles** — `Throttles > 0` over 1 min — almost always actionable
- **Duration p99** — `Duration` p99 above target (per-function, derived
  from histogram baseline)
- **Concurrent executions vs. account quota** — composite or math alarm
  on `ConcurrentExecutions / AccountConcurrencyLimit > 80%`
- **Iterator age (event-source mappings)** — `IteratorAge` on Kinesis
  / DynamoDB Streams sources

#### ECS / Fargate
- **Service `RunningTaskCount` < `DesiredCount`** for >5 min
- **CPUUtilization / MemoryUtilization** above target with baseline
- **TaskExits** with non-zero exit codes (via Container Insights)
- For **ALB-fronted services**, see ALB below

#### ALB / NLB
- **HTTPCode_Target_5XX_Count** with rate-based threshold
- **HTTPCode_ELB_5XX_Count** — distinguish from target 5xx (LB-side
  failure)
- **TargetResponseTime** p99 with baseline
- **UnHealthyHostCount > 0** for >2 min
- **RejectedConnectionCount** — surge → capacity issue

#### RDS / Aurora
- **CPUUtilization** > 80% sustained
- **DatabaseConnections** above warning threshold (≈80% of `max_connections`)
- **FreeableMemory** below floor
- **ReadLatency / WriteLatency** with baseline
- **DBLoad** (Performance Insights) above vCPU count
- **ReplicaLag** for read replicas
- **FreeStorageSpace** below floor
- For Aurora: **AuroraVolumeBytesUsed** trending toward limit

#### DynamoDB
- **ReadThrottleEvents / WriteThrottleEvents > 0** for on-demand
  surprise; for provisioned, alarm on `ConsumedReadCapacityUnits /
  ProvisionedReadCapacityUnits > 80%`
- **SystemErrors** — service-side failure
- **UserErrors** at high rate — bad client
- **SuccessfulRequestLatency** with baseline

#### SQS
- **ApproximateAgeOfOldestMessage** above SLA
- **ApproximateNumberOfMessagesVisible** trending up beyond drain rate
- **NumberOfMessagesSent / NumberOfMessagesDeleted** divergence (DLQ
  growth)
- For DLQs: **ApproximateNumberOfMessagesVisible > 0** for >5 min —
  almost always actionable

#### SNS
- **NumberOfNotificationsFailed** rate
- **NumberOfNotificationsFilteredOut-NoMessageAttributes** — filter
  policy bug

#### API Gateway
- **5XXError** rate
- **4XXError** rate (only if a steady client base; volatile in public
  APIs)
- **Latency** p99
- **Count** for traffic anomalies (anomaly detection)

#### Application Signals SLO
- **BurnRate** alarms — fast burn (1h window, >14× burn) and slow burn
  (6h window, >6× burn) — see AWS docs for canonical values
- **AttainmentBelowTarget** for the rolling window

#### Custom / EMF metrics
- One alarm per RED metric per service (rate, errors, duration) with
  baseline-derived thresholds
- Business metrics — at most one alarm per business-critical KPI, with
  generous threshold (these are sanity checks, not pagers)

For each row in the matrix, mark **Covered**, **Partial** (alarm exists
but off-target), or **Missing**. Cite the AWS docs MCP for the
recommendation (best-practice URL) so the user can drill in.

### Phase 4 — Recommend new or replacement alarms

For every Missing or Partial row, propose a concrete alarm. Each
recommendation must include:

- **Name** — convention: `<service>-<resource>-<metric>-<statistic>-<severity>`,
  e.g. `checkout-api-Lambda-Errors-Sum-Critical`
- **Metric, namespace, dimensions** — fully qualified
- **Statistic, period, evaluation_periods, datapoints_to_alarm,
  comparison, threshold** — all six dials filled in
- **Treat-missing-data** — explicit, never default. Default to
  `notBreaching` for noisy / sparse metrics, `breaching` for security-
  critical signals
- **OK / ALARM / INSUFFICIENT_DATA actions** — SNS topic ARNs (from
  Phase 5 routing)
- **Justification** — 1–2 lines on why this threshold, citing baseline
  data from the configured time window
- **IaC snippet** — render in the user's IaC of choice if detectable
  (CloudFormation, CDK TS, Terraform), otherwise default to
  CloudFormation YAML
- **Console deep link** — to the "Create alarm" page pre-filled with
  the metric

#### When to use anomaly detection

Recommend `ANOMALY_DETECTION_BAND` instead of static thresholds when
the metric is **seasonal** (daily / weekly traffic patterns), the
absolute value varies more than 3× across the cycle, AND the metric
has at least 2 weeks of history. Examples: API request count,
end-of-month batch volume, retail traffic, login-rate.

Avoid anomaly detection for **safety floors / ceilings** that are
absolute regardless of time-of-day (e.g. `FreeStorageSpace`, DLQ
depth, security signals). Static thresholds are simpler and
defensible.

#### When to use a composite alarm

Compose two or more child alarms when:

- **Reducing false positives via M-of-N** — e.g. ALARM only if
  *p99 latency* AND *error rate* both breach. Latency alone can be a
  GC pause; combined with errors, it's a real incident.
- **AND of independent signals** — `target 5xx high` AND `dependency
  health failing` — distinguishes "we have a real outage" from "the
  dependency reports OK so it's our bug."
- **OR for a single page surface** — a "Service Critical" composite
  that fires if any of N child critical alarms fire — gives the
  on-call channel one named target rather than 12.
- **Suppression** — silence one alarm while another (e.g. deploy
  alarm) is active. Use the `ActionsSuppressor` field.

For each composite, render the rule expression
(`ALARM(child-A) AND ALARM(child-B)`) and the action set. Note that
composite alarm actions should usually NOT also fire on the children —
otherwise the operator gets paged twice.

### Phase 5 — Notification routing

Group recommended alarms by severity tier and route accordingly:

| Tier | Behavior | Example targets |
|---|---|---|
| **Critical / paging** | Wakes someone up. Reserve for customer-impacting outages and runaway burn rates. | SNS → PagerDuty / OpsGenie / Slack with paging integration |
| **High / urgent** | Same-day response, but not 3 a.m. | SNS → Slack channel + ticket creation |
| **Warning / ticket** | Eventually-fix. Triage during business hours. | SNS → ticketing system only |
| **Info / log** | Telemetry only. No human action. | SNS → log Lambda or no action |

Surface routing as a **per-tier SNS topic plan** plus a per-alarm
target. Recommendations:

- One SNS topic per tier, not per service. Service routing belongs to
  the receiving system (PagerDuty service, Slack channel router), not
  to the topic count.
- **OK actions** on every paging alarm — the on-call needs the recovery
  signal as much as the alarm. Skip OK actions on warning / info to
  reduce volume.
- **Suppression windows** for known-noisy windows (deploys, scheduled
  maintenance) using `AlarmRule` actions or EventBridge rules — surface
  this as an option, not a default.
- **Per-environment isolation** — never route a `dev` alarm to the
  paging topic. Audit any alarm action whose ARN contains `dev` /
  `staging` / `test` if it shares a topic with prod.

If the user has a clear deviation from this model (e.g. one mega-topic
for everything), surface as a noise risk in the report rather than
silently re-routing.

### Phase 6 — Render the Alerting Plan

1. Lead with a **scorecard**:
   ```
   Existing alarms:    47
   Noisy alarms:       9 (flagged)
   Coverage gaps:      14 services × N alarm types missing
   Composite candidates: 3
   Anomaly detection candidates: 2
   ```
2. **Top 3 priorities** — the three highest-leverage actions, each one
   line plus the linked plan row.
3. Render the **per-area sections**:
   - Noise to fix first (existing alarms with high churn / dead state /
     missing OK action)
   - Missing alarms by service (Lambda, ECS, ALB, RDS, …)
   - Composite alarm proposals
   - Anomaly detection proposals
   - Routing changes
4. For each row: name, metric, threshold, justification, IaC snippet,
   console deep link, severity tier.
5. **Do not propose write actions automatically.** The user applies the
   IaC snippet via their pipeline or clicks the console link.

## Final artifact

Render the **Alerting Plan** using the template at
`artifacts/alerting-plan.html`. Populate every `{{PLACEHOLDER}}`. If a
placeholder cannot be filled, write `Not applicable` rather than
fabricating.

The plan must include:
- Scorecard (existing alarms, noise count, coverage gaps, composite /
  anomaly candidate counts)
- Top 3 priorities
- Noise-fix section with per-row diagnosis + recommendation
- Coverage matrix per service in use
- Recommended new alarms with IaC snippets and console links
- Composite and anomaly proposals
- Notification routing plan with per-tier SNS topics
- Citations to AWS docs for each recommendation
- Metadata footer (region, account, time window scanned, MCP tools called)

**Lead with a one-line verdict** before the artifact:

> 🟡 **9 noisy alarms + 14 coverage gaps in `us-east-1`** — top fix:
> retire 3 always-INSUFFICIENT_DATA alarms and replace `Errors > 0` on
> `checkout-api` Lambda with a 5-min rate-based composite.

The verdict must name (1) the worst symptom (noise OR missing OR routing),
(2) the scope (region / account / service), and (3) the top fix.

## Action safety

**Read-only.** This skill never proposes a `PutMetricAlarm`,
`DeleteAlarms`, `EnableAlarmActions`, or `DisableAlarmActions` call
through MCP. The plugin's PreToolUse hook fails closed on these names,
but rely on the rule, not the hook.

For each recommended change, the artifact surfaces an IaC snippet
(CloudFormation / CDK / Terraform) plus a CloudWatch console deep link
to the alarm-create page. The user applies the change through their
deployment pipeline or the console — never via this skill.

If the user explicitly asks to "create the alarm now," refuse and
re-explain: alarm changes are a deployment event, they should ride
through the same review and IaC pipeline as any other infra change. If
the user insists, surface the standard structured approval block
(see `error-spike-triage` for the canonical block) and require the
exact `CONFIRM PutMetricAlarm` phrase before acting — but strongly
prefer the IaC path.

## Degraded data handling

| Gap | Detect | Behavior | Confidence cap |
|---|---|---|---|
| `get_active_alarms` AccessDenied | Tool errors | Refuse to run; surface remediation from `aws-apm-setup` | N/A |
| Alarm history limited (<7d available) | `get_alarm_history` returns truncated | Run noise audit on available window; cap noise findings at Medium | Medium |
| AWS docs MCP unavailable | Tool errors | Continue with built-in best practices; note "AWS doc citations unavailable" in footer | None |
| `get_recommended_metric_alarms` returns nothing | Service not supported by recommendations API | Fall back to the per-service tables in this skill; cite skill section instead of AWS doc | None |
| No metrics in account | `get_metric_data` returns empty for every probe | Likely wrong region — surface `/cw-set-context` recommendation | N/A |

## Empty states

- **No alarms at all** → "Greenfield — no alarms configured. Lead with
  Phase 3+ (coverage design); skip Phase 2 noise audit."
- **All alarms healthy and well-tuned** → render the 🟢 verdict with a
  "What good looks like" recap. Do not invent gaps.
- **Account has only Application Signals SLOs and no resource alarms**
  → flag as a partial — SLOs are great for customer-experience
  signals, but resource saturation (DB connections, queue depth, Lambda
  throttles) needs its own alarm tier.

## What this skill does NOT do

- Does not analyze application source code for instrumentation gaps —
  that's `observability-gap-analysis`.
- Does not investigate why a specific alarm fired — that's
  `alarm-response`.
- Does not modify alarms, SNS topics, or routing in the account.
- Does not provision SNS topics, PagerDuty services, or Slack
  integrations — only recommends shapes.
- Does not replace the on-call playbook; it designs the *gates* that
  trigger the playbook.
