---
description: Audit existing CloudWatch alarms, identify alerting gaps for the AWS services in use, and produce a prioritized alerting plan with thresholds, composite-alarm patterns, and routing recommendations
argument-hint: [service-or-namespace] [time-window]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs_cloudwatch-mcp-server__*"
  - "mcp__awslabs_aws-documentation-mcp-server__*"
---

# /cw-alert-design

Run the **alerting design** workflow for the configured account / region.
Produces an **Alerting Plan** artifact: existing alarms inventoried,
gaps identified, recommended alarm configurations (with thresholds and
evaluation periods), composite-alarm patterns, anomaly-detection
candidates, false-positive risks, and a prioritized implementation list.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - First arg = service name OR CloudWatch namespace OR `all` (default:
     `all` — design alerts for every Application Signals service plus
     supporting AWS resources used by them)
   - Second arg = baseline window for threshold recommendations
     (default: `7d`, accepts `1d`, `7d`, `14d`, `30d`)
2. If the user supplies a service name, scope the audit to that service
   plus its named dependencies. If `all`, enumerate Application Signals
   services in the configured region.
3. Activate the `alerting-design` skill and follow its full 6-phase
   workflow:
   1. Inventory existing alarms (state, threshold, evaluation period,
      actions, last fired, ALARM-state churn)
   2. Detect noise and fatigue (alarms that fired >10× in last 7d, alarms
      always in INSUFFICIENT_DATA, missing OK actions)
   3. Map services in use to a recommended alarm coverage matrix per AWS
      service type (Lambda, ECS, ALB, RDS, DynamoDB, SQS, SNS, API
      Gateway, Application Signals SLO)
   4. Recommend new or replacement alarms — static thresholds with
      math, anomaly-detection where the metric is seasonal, composite
      alarms where two-of-N reduces false positives
   5. Routing — which alarms page, which alarms ticket, which alarms
      log only; OK actions; suppression windows; SNS topic structure
   6. Produce the **Alerting Plan** artifact with priorities and
      proposed CloudWatch console deep links to create / edit each alarm
4. The plan is **advisory only**. Never propose a `PutMetricAlarm` or
   `DeleteAlarms` call directly — surface the JSON / CloudFormation /
   CDK / Terraform snippet plus a console deep link, and let the user
   apply it themselves.

## Action safety

This command is **read-only** against the AWS account. Use only the
listed read MCP tools (`get_active_alarms`, `get_alarm_history`,
`get_recommended_metric_alarms`, `describe_log_groups`,
`get_metric_data`, `get_metric_metadata`,
`list_resource_telemetry`, `list_telemetry_rules`, plus AWS docs MCP).
Never call any `Put*`, `Update*`, `Delete*`, or `Disable*` tool. Surface
all proposed changes as JSON / IaC snippets the user applies.

## Examples

```
/cw-alert-design
/cw-alert-design checkout-service
/cw-alert-design checkout-service 14d
/cw-alert-design AWS/Lambda
/cw-alert-design all 30d
```
