---
description: Read a CloudWatch dashboard definition, interpret each widget, fetch current metric values, and render a narrative summary + health verdict
argument-hint: <dashboard-name> [time-range]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs_cloudwatch-mcp-server__*"
  - "mcp__awslabs_cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs_aws-documentation-mcp-server__*"
---

# /cw-dashboard

Fetch an existing CloudWatch dashboard, parse its widget JSON, and produce a
narrative health summary by mapping each widget's metric configuration to the
current metric values. Lets users get the plugin's interpretation of a
dashboard they already use, rather than building a parallel view from scratch.

The user invoked this with: `$ARGUMENTS`

## Argument parsing

- **dashboard-name** (required) — the CloudWatch dashboard identifier (case-
  sensitive). Example: `pet-clinic-dashboard`.
- **time-range** (optional) — `15m | 1h | 6h | 24h | 7d` (default `1h`). The
  rendered narrative compares current values to baseline 24h ago regardless of
  this range; the range controls the time window for `get_metric_data` calls.

If `$ARGUMENTS` is empty, list available dashboards (see Empty states) and ask
the user to pick one.

## Instructions

1. Verify the `awslabs_cloudwatch-mcp-server` is connected. If not, run
   `aws-apm-setup`.

2. Resolve the dashboard:
   - Prefer the MCP tool if available:
     `mcp__awslabs_cloudwatch-mcp-server__get_dashboard` with `DashboardName`.
   - **Fallback:** if the MCP server does not expose a `get_dashboard` tool,
     shell out via Bash to `aws cloudwatch get-dashboard --dashboard-name
     <name> --region <region> --output json`. Note the fallback in the
     metadata footer ("Source: AWS CLI fallback — MCP tool unavailable").

3. Parse the `DashboardBody` JSON. It is a string containing a JSON object
   with a `widgets` array. Each widget has:
   - `type` — `metric | log | alarm | text | explorer`
   - `properties.metrics` (for `metric` widgets) — list of metric tuples
     `[Namespace, MetricName, Dimension1, Value1, ..., {options}]`
   - `properties.region`, `properties.period`, `properties.stat`,
     `properties.title`, `properties.view`, `properties.yAxis`

4. For each `metric` widget, extract every metric tuple and call
   `get_metric_data` for the parsed time-range AND the same window 24h ago.
   Cap concurrency at 10. For widgets with metric math expressions, preserve
   the expression and pass it through to the math result.

5. For each `alarm` widget, call `describe_alarms` for the alarm ARNs listed
   and capture state + threshold + actions.

6. For each `log` widget, capture the `query` field but do NOT execute it —
   surface the query as-is and link the user to it. Auto-execution would
   blow the command's time budget for dashboards with many log widgets.

7. Render the canonical layout below.

8. The dashboard narrative is text-heavy by design. For all prose (Verdict
   rationale, per-widget interpretation, next-step recommendations), follow
   `skills/hybrid-renderer/references/text-presentation-guide.md` — lead with
   the answer, the 3am test, no preamble, hard word limits per section.

## Canonical layout

```markdown
## 📊 CloudWatch Dashboard: `<dashboard-name>`
**Region:** <region> · **Account:** <account> · **As of:** <ISO ts UTC>
**Time window:** <range> · **Widgets:** <N> (`<M>` metric · `<L>` log · `<A>` alarm · `<T>` text)

---

### 🩺 Verdict: <🟢 Healthy | 🟡 Degraded | 🔴 Unhealthy>

<one-line dashboard-level summary — e.g. "p99 latency widget shows 920ms vs
260ms baseline (3.5×). All other widgets within ±20%.">

---

### Widget breakdown

#### 1. <widget title> — `metric` · <namespace>
| Metric | Stat | Now (<period>) | 24h ago | Δ | Status |
|---|---|---|---|---|---|
| <MetricName> | <Avg \| Sum \| p99> | <value> | <value> | <±%> | 🟢 / 🟡 / 🔴 |

**Interpretation:** <one-line explanation — e.g. "Error count is 14× baseline,
likely correlated with the deploy at 14:18 UTC. See `/cw-investigate-errors`.">

[Open widget in CloudWatch](<deep-link>)

#### 2. <widget title> — `alarm`
| Alarm | State | Threshold | Last transition |
|---|---|---|---|
| <alarm-name> | ALARM / OK / INSUFFICIENT_DATA | <threshold> | <ts> |

#### 3. <widget title> — `log`
**Log group:** `<group>`
**Query (not auto-run):**
```
<the Logs Insights query verbatim>
```
[Run query in console](<deep-link>)

---

### 🔗 Suggested next steps

- `/cw-investigate-errors <service>` — for any metric widget showing >2×
  baseline error rate
- `/cw-investigate-latency <service>` — for any p99 widget >2× baseline
- `/cw-alarm-response <alarm-name>` — for any alarm widget in ALARM state

---

**Source:** `awslabs_cloudwatch-mcp-server` (dashboard + metrics)
**MCP tools called:** `get_dashboard`, `get_metric_data`, `describe_alarms`
**Time window queried:** <start> .. <end>
**Confidence:** High (live data, no derivation)
```

## Verdict rules

The dashboard verdict is the **worst** of any individual widget verdict:

- **🔴 Unhealthy** — any widget metric is >2× baseline OR any alarm is in
  ALARM state.
- **🟡 Degraded** — any widget metric is outside ±20% of baseline OR any
  alarm is `INSUFFICIENT_DATA`.
- **🟢 Healthy** — all widget metrics within ±20% of baseline AND all
  alarms in OK.

Text-only widgets, log widgets without auto-run, and explorer widgets do not
contribute to the verdict — only metric and alarm widgets do.

## Service inference

If the dashboard's metric tuples include `AWS/Lambda` with a `FunctionName`
dimension, infer that the service maps to the Lambda function for cross-
references in the suggested next steps. Same for `AWS/ApiGateway`
(`ApiName`), `AWS/ECS` (`ClusterName` / `ServiceName`), and
`AWS/ApplicationSignals` (`Service` / `Operation`). Surface inferred services
in the metadata footer so the user can confirm.

## Action safety

This command is **read-only**. Tools called:
`get_dashboard`, `get_metric_data`, `describe_alarms`. Never modify or delete
a dashboard. If the user asks to "fix" or "update" the dashboard, propose the
JSON diff and link them to the AWS console — do not call `PutDashboard`.

## Examples

```
/cw-dashboard pet-clinic-dashboard
/cw-dashboard pet-clinic-dashboard 6h
/cw-dashboard plugin1989-dashboard 24h
```

## Empty states and data unavailability

- **Empty `$ARGUMENTS`** → call `aws cloudwatch list-dashboards` (or the MCP
  equivalent) and present the available dashboards as a numbered list. Ask
  the user to pick.
- **Dashboard not found** → surface the AWS error verbatim ("Dashboard
  `<name>` not found in `<region>`. Use `aws cloudwatch list-dashboards` to
  see available dashboards."). Do not fabricate.
- **Dashboard body is empty** → render the metadata footer + a single
  "Dashboard has no widgets" line. Do not guess content.
- **Widget references metrics with no datapoints** → set the Now / 24h-ago
  cells to `—` and note "No datapoints in window."
- **Cross-account dashboard or unreadable widget config** → surface the
  raw widget JSON in a code block with a "could not interpret" note rather
  than dropping it.

## Performance

- Cap `get_metric_data` calls at 10 concurrent.
- Per-call timeout 10s. Total command budget 60s for dashboards up to ~30
  widgets.
- For dashboards >30 widgets, render the first 30 by display order and add a
  footer line: "<N> more widgets not shown — open in console for the full
  view."
