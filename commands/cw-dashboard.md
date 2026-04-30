---
description: Read a CloudWatch dashboard's widget definitions, fetch live values for each metric widget, and render an interpreted summary as a hybrid-renderer manifest
argument-hint: <dashboard-name> [time-range]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs.cloudwatch-mcp-server__*"
  - "mcp__awslabs.cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-dashboard

Read a CloudWatch dashboard the user already has configured, parse its widget
definitions, fetch live metric values for each metric/alarm/log widget, and
render an interpreted summary that explains what the dashboard is showing
right now — instead of just deep-linking the user to the console.

The user invoked this with: `$ARGUMENTS`

## Argument parsing

`$ARGUMENTS` is space-separated:

- **dashboard-name** (required) — exact dashboard name. If omitted, list all
  dashboards in the region first and ask the user to pick one.
- **time-range** (optional, default `1h`) — one of `15m | 1h | 6h | 24h | 7d`,
  or an ISO 8601 range. Each metric widget is queried over this window.

## Instructions

1. Verify prerequisites. If the `awslabs.cloudwatch-mcp-server` is not
   connected, run the `aws-apm-setup` skill first.

2. Resolve the dashboard:
   - If `$ARGUMENTS` is empty, call `list_dashboards` (or fall back to the
     CLI: ask the user to run `aws cloudwatch list-dashboards`) and present
     the names. Stop and wait for selection.
   - If a name is supplied, call `get_dashboard --dashboard-name <name>`.

3. **MCP tool fallback:** if `get_dashboard` is not available in the
   connected MCP server (some versions don't expose it), instruct the user
   to run:
   ```
   aws cloudwatch get-dashboard --dashboard-name <name> --query DashboardBody --output text
   ```
   and paste the resulting JSON back. Parse the pasted JSON identically to
   an MCP response. Do **not** fabricate widget data.

4. Parse `dashboard_body` (a JSON string per the [CloudWatch dashboard body
   schema](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/CloudWatch-Dashboard-Body-Structure.html)).
   For each top-level entry in `widgets[]`, classify by `type`:

   | Widget `type` | Interpretation | Live data fetched |
   |---|---|---|
   | `metric` | One or more metric series, possibly with math | `get_metric_data` for each metric, period=`properties.period` (default 60s) |
   | `text` | Markdown narrative — read it for context, do NOT re-render verbatim if >200 chars | None |
   | `log` | Logs Insights query result | `start_query` + poll `get_query_results` (cap 30s) |
   | `alarm` | Alarm widget — single or composite | `describe_alarms` for current state |
   | other / unknown | Surface the type and skip data fetch | None |

5. For each `metric` widget, extract:
   - The metric name(s), namespace(s), dimensions, and statistic from
     `properties.metrics[]`.
   - Any metric math expressions (rows where index 0 is `{ "expression": ... }`).
   - The widget title (from `properties.title`) and Y-axis label.

   Then fetch live values via `get_metric_data` for the requested time range
   and compute:
   - Latest value
   - Min / max in the window
   - Trend direction (rising / falling / flat) — last quarter vs first quarter
   - Whether any associated alarm threshold is currently breached

6. For each `alarm` widget, list the alarm names, fetch state via
   `describe_alarms`, and surface `OK | INSUFFICIENT_DATA | ALARM` plus the
   reason text from the alarm history.

7. Activate the `hybrid-renderer` skill and emit a manifest. Pick the
   layout intent based on widget mix:

   | Widget mix | `query_intent` | Renderer shell |
   |---|---|---|
   | Mostly `metric` widgets, ≤6 total | `dashboard-summary` | `dashboard` |
   | Mix of `metric` + `alarm` + `log`, 7–15 widgets | `dashboard-overview` | `investigation` |
   | Single big-picture `metric` widget plus narrative text | `dashboard-focus` | `single-focus` |

## Manifest widget mapping

For each parsed dashboard widget, emit a corresponding renderer widget:

- `metric` widget → `stat_card` (latest value + sparkline of the series) when
  ≤4 series; `chart`-style `sparkline` widget when more.
- `alarm` widget → `stat_card` with `status` derived from state (`OK` →
  `healthy`, `ALARM` → `unhealthy`, `INSUFFICIENT_DATA` → `warning`).
- `log` widget → `log_viewer` if rows returned, else `stat_card` with the
  query string and a "no rows" empty message.
- `text` widget → include in manifest `metadata.subtitle` if short, or as a
  prefix paragraph in the first widget's description.

The renderer applies its own density budget; do NOT pre-compute widget
counts beyond emitting them in priority order.

## Manifest metadata

```json
"metadata": {
  "title": "<dashboard name>",
  "subtitle": "<region> · <N widgets> · <time range>",
  "severity": "info | warning | critical",
  "query_intent": "<one of dashboard-summary | dashboard-overview | dashboard-focus>",
  "generated_at": "<ISO 8601 UTC>",
  "region": "<resolved region>"
}
```

`severity` rule: `critical` if any alarm is in `ALARM` or any metric exceeds
its associated alarm threshold; `warning` if any metric is trending toward
threshold (>80%); otherwise `info`.

## Verdict line

End the manifest with a one-line verdict in the metadata footer:

- "🟢 Dashboard healthy — all metrics within bounds"
- "🟡 Dashboard shows N metric(s) trending warm — see <widget titles>"
- "🔴 Dashboard shows N alarm(s) in ALARM state — see <alarm names>"

## Action safety

This command is **read-only**. It calls only `list_dashboards`,
`get_dashboard`, `get_metric_data`, `describe_alarms`, `start_query`,
`get_query_results`, and `describe_log_groups`. It never modifies the
dashboard.

If the user asks to "fix" or "edit" a widget, respond with the IaC snippet
shape (CloudFormation `AWS::CloudWatch::Dashboard` or Terraform
`aws_cloudwatch_dashboard`) and direct them to apply via their normal
deploy pipeline. Do not call `put_dashboard`.

## Empty states

- **No dashboards in region** → "No CloudWatch dashboards found in
  `<region>`. Either the region is empty or you lack `cloudwatch:ListDashboards`
  permission."
- **Dashboard not found** → surface the AWS error verbatim. Do not guess at
  the closest match — ask the user to confirm the name.
- **Widget references a metric that no longer exists** → render the widget
  card with `status: warning` and inline note "Metric returned no data —
  the resource may have been deleted."
- **Dashboard JSON malformed** → surface the parse error and the offending
  fragment. Do not fabricate widget data to fill the gap.

## Pagination and limits

- Cap at **20 widgets** rendered. If the dashboard has more, render the top
  20 by `properties.position` (top-left first) and note "<N> more widgets
  not shown — view the dashboard directly in CloudWatch."
- Per-`get_metric_data` call: 10s timeout. Total command budget: 60s.
- On `ThrottlingException`, retry once with 2s backoff.

## Examples

```
/cw-dashboard pet-clinic-dashboard
/cw-dashboard pet-clinic-dashboard 6h
/cw-dashboard production-overview 24h
/cw-dashboard         # lists dashboards and asks user to pick
```

## Why this command exists

CloudWatch dashboards are the system-of-record for what teams already chose
to monitor. The plugin's other commands (`/cw-health-check`, `/cw-investigate-*`)
build their own views from Application Signals — but most teams have years
of effort baked into their custom dashboards. This command reads that
existing configuration and produces a narrative interpretation, so users
get value without having to re-encode their dashboards as commands.
