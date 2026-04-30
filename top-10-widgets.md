# Top 10 Widgets to Add Next

**Date:** 2026-04-30
**Based on:** Comprehensive audit of CloudWatch, Cloudscape, Datadog, and New Relic visualizations.
**Ranking criteria:** User value, query frequency, rendering feasibility, competitive parity.

---

## 1. Line Chart (Time-Series Metric Graph)

**Priority:** P0 — The single most impactful missing widget.

**What it renders:** One or more metric series plotted over time as lines on a shared x/y axis. Supports multiple series with a legend, optional threshold lines, and time-based x-axis with auto-scaling. This is the bread-and-butter of every observability tool.

**Data source (MCP tool):** `get_metric_data` (CloudWatch Metrics API). Also usable with Logs Insights `bin()` queries via `start_logs_insights_query`.

**Example user queries:**
- "Show me CPU utilization for my API servers over the last 6 hours"
- "Graph p99 latency for the order service this week"
- "Compare error rates across my three Lambda functions"
- "What does memory usage look like for this RDS instance?"

**Estimated complexity:** **M** — SVG-based line rendering with axis labels, gridlines, and legend. The sparkline widget already does basic SVG polylines; this extends that pattern with axes, multi-series, labels, and proper scaling.

**Cloudscape equivalent:** Yes — Line Chart component (Highcharts-based)

**Competitive parity:** Both Datadog (Timeseries) and New Relic (Line Chart) have this as their most-used widget.

**Suggested data structure:**
```json
{
  "type": "line_chart",
  "data": {
    "label": "CPU Utilization - API Servers",
    "x_axis": { "type": "time", "label": "Time" },
    "y_axis": { "label": "CPU %", "min": 0, "max": 100, "unit": "%" },
    "series": [
      {
        "name": "api-server-1",
        "color": "blue",
        "points": [
          { "x": "2026-04-30T10:00:00Z", "y": 45.2 },
          { "x": "2026-04-30T10:05:00Z", "y": 52.1 }
        ]
      }
    ],
    "thresholds": [
      { "value": 80, "label": "Warning", "color": "orange" }
    ],
    "time_range": "last 6 hours"
  }
}
```

---

## 2. Topology Map (Application Map (Q4 2025))

**Priority:** P0 — Explicitly called out as broken; "show me my app topology" fails today.

**What it renders:** A directed graph of service nodes connected by edges representing observed calls. Nodes are color-coded by health (green/yellow/red). Edges are labeled with latency, throughput, and error rates. Root/entry-point nodes are visually distinct.

**Data source (MCP tool):** `get_service_graph` (X-Ray API) or Application Signals `list_services` + `list_service_dependencies`.

**Example user queries:**
- "Show me my application topology"
- "What does my service map look like?"
- "Which services is my API Gateway calling?"
- "Show me the dependency graph for the order service"
- "What's the architecture of my application?"

**Estimated complexity:** **L** — Requires a graph layout algorithm (BFS-based layered layout recommended), SVG node/edge rendering, health coloring, edge labels, and AWS service type icons.

**Cloudscape equivalent:** No — CloudWatch builds this custom; no reusable Cloudscape component exists.

**Competitive parity:** Datadog (Topology Map, Service Map), New Relic (Service Map, Dynamic Flow Map) — both treat this as a core feature.

**Rendering approach:** Manual SVG with BFS-layered layout. Zero dependencies. See the audit document Part 6 for the full data structure and algorithm.

**Suggested data structure:**
```json
{
  "type": "topology_map",
  "data": {
    "label": "Application Topology",
    "time_range": "last 6 hours",
    "nodes": [
      {
        "id": "api-gw",
        "name": "API Gateway",
        "service_type": "AWS::ApiGateway::Stage",
        "root": true,
        "status": "healthy",
        "metrics": { "requests": 12500, "errors": 15, "faults": 3, "avg_latency_ms": 52 }
      },
      {
        "id": "order-svc",
        "name": "OrderService",
        "service_type": "AWS::Lambda::Function",
        "root": false,
        "status": "degraded",
        "metrics": { "requests": 11800, "errors": 250, "faults": 0, "avg_latency_ms": 340 }
      }
    ],
    "edges": [
      {
        "source": "api-gw",
        "target": "order-svc",
        "metrics": { "requests": 11800, "error_rate": 0.021, "avg_latency_ms": 45 }
      }
    ]
  }
}
```

---

## 3. Alarm Status Grid

**Priority:** P1 — High-frequency query; users constantly ask "are any alarms firing?"

**What it renders:** A grid of alarm tiles, each showing alarm name, state (OK/ALARM/INSUFFICIENT_DATA), and the metric it monitors. Color-coded: green for OK, red for ALARM, gray for INSUFFICIENT_DATA. Optionally shows a mini metric graph per alarm.

**Data source (MCP tool):** `describe_alarms` (CloudWatch Alarms API).

**Example user queries:**
- "Are any alarms firing right now?"
- "Show me all my alarms and their status"
- "What's the state of alarms in us-east-1?"
- "Which alarms are in ALARM state?"

**Estimated complexity:** **S** — Grid of colored tiles with text labels. Very similar to a simplified stat_card grid. No charting needed.

**Cloudscape equivalent:** Yes — Status Indicator component + Cards/Board layout.

**Competitive parity:** Datadog (Alert Graph/Value widget), New Relic (Alert status).

**Suggested data structure:**
```json
{
  "type": "alarm_status",
  "data": {
    "label": "Alarm Status Overview",
    "alarms": [
      {
        "name": "HighCPU-ProdAPI",
        "state": "ALARM",
        "metric": "CPUUtilization",
        "namespace": "AWS/EC2",
        "threshold": "80%",
        "last_updated": "2026-04-30T14:30:00Z",
        "reason": "Threshold crossed: 87.3 > 80.0"
      }
    ]
  }
}
```

---

## 4. Stacked Area Chart

**Priority:** P1 — Essential for resource breakdown queries.

**What it renders:** Multiple metric series stacked as filled areas, showing both individual contributions and the total. Time on x-axis, stacked values on y-axis. Useful for showing composition (e.g., memory by process, errors by type, traffic by endpoint).

**Data source (MCP tool):** `get_metric_data` with multiple queries, or Logs Insights with `bin()` + `stats by`.

**Example user queries:**
- "Break down error types for my API over the last day"
- "Show me memory usage by container in this ECS cluster"
- "What's the traffic distribution across my endpoints?"
- "Show me 5xx vs 4xx errors over time"

**Estimated complexity:** **M** — Extension of line chart with filled areas and stacking logic. SVG `<path>` elements with `fill`.

**Cloudscape equivalent:** Yes — Area Chart component.

**Competitive parity:** Standard in Datadog, New Relic, Grafana.

**Suggested data structure:** Same as `line_chart` with an added `stacking: "normal"` field and `fill: true` per series.

---

## 5. Bar Chart

**Priority:** P1 — Needed for categorical comparisons and Logs Insights results.

**What it renders:** Vertical bars comparing metric values across categories (services, endpoints, time buckets). Supports grouped and stacked variants.

**Data source (MCP tool):** `get_metric_data` (aggregated), `start_logs_insights_query` (stats queries), `get_metric_statistics`.

**Example user queries:**
- "Which Lambda function has the most invocations?"
- "Compare average latency across all my services"
- "What are the top error-producing endpoints?"
- "Show me request counts by region"

**Estimated complexity:** **M** — SVG rectangles with labels, axes, and optional grouping/stacking. Shares axis/grid logic with line chart.

**Cloudscape equivalent:** Yes — Bar Chart component.

**Competitive parity:** Standard in all observability platforms.

**Suggested data structure:**
```json
{
  "type": "bar_chart",
  "data": {
    "label": "Invocations by Lambda Function",
    "x_axis": { "type": "category", "label": "Function" },
    "y_axis": { "label": "Invocations", "unit": "count" },
    "stacking": "none",
    "categories": ["OrderProcessor", "PaymentHandler", "NotificationSender"],
    "series": [
      {
        "name": "Invocations",
        "color": "blue",
        "values": [15200, 8900, 4300]
      }
    ]
  }
}
```

---

## 6. Key-Value Detail Panel

**Priority:** P1 — Currently missing a clean way to show resource/trace/alarm metadata.

**What it renders:** A structured list of label-value pairs organized in columns, with optional status indicators, copy-to-clipboard for IDs, and links. Used for trace details, alarm configuration, resource metadata, and service properties.

**Data source (MCP tool):** Any — this is a generic display widget fed by `describe_alarms`, `batch_get_traces`, `describe_instances`, `list_services`, etc.

**Example user queries:**
- "Show me the details of this alarm"
- "What are the properties of my RDS instance?"
- "Give me the full trace details"
- "What's the configuration of this Lambda function?"

**Estimated complexity:** **S** — Simple HTML key-value layout. Two-column or multi-column grid.

**Cloudscape equivalent:** Yes — Key-Value Pairs component.

**Competitive parity:** Universal in all observability tools as a detail view.

**Suggested data structure:**
```json
{
  "type": "key_value",
  "data": {
    "label": "Lambda Function Details",
    "columns": 2,
    "pairs": [
      { "key": "Function Name", "value": "OrderProcessor" },
      { "key": "Runtime", "value": "python3.12" },
      { "key": "Memory", "value": "512 MB" },
      { "key": "Timeout", "value": "30s" },
      { "key": "Status", "value": "healthy", "kind": "status" },
      { "key": "ARN", "value": "arn:aws:lambda:us-east-1:...", "kind": "code" }
    ]
  }
}
```

---

## 7. Anomaly Detection Band

**Priority:** P1 — Differentiator; makes metric charts vastly more useful by showing "is this normal?"

**What it renders:** An overlay on a line chart showing the expected normal range as a shaded band. The actual metric line is plotted on top. When the line exits the band, it signals an anomaly. Rendered as a filled SVG area between upper and lower bounds.

**Data source (MCP tool):** `get_metric_data` with anomaly detection model metrics (`ANOMALY_DETECTION_BAND` function).

**Example user queries:**
- "Is this CPU spike abnormal?"
- "Show me latency with anomaly detection"
- "Are these error rates outside the normal range?"
- "When did this metric start behaving unusually?"

**Estimated complexity:** **M** — Extension of line chart. Adds a shaded band (SVG path fill between upper/lower bounds). Requires the line chart widget as a prerequisite.

**Cloudscape equivalent:** No — CloudWatch renders this custom.

**Competitive parity:** Datadog (Anomaly monitor overlay), New Relic (baseline alerts, less visual).

**Suggested data structure:** Extension of `line_chart` with an additional `anomaly_band` field:
```json
{
  "anomaly_band": {
    "upper": [{ "x": "2026-04-30T10:00:00Z", "y": 65 }, ...],
    "lower": [{ "x": "2026-04-30T10:00:00Z", "y": 30 }, ...],
    "label": "Expected range"
  }
}
```

---

## 8. Gauge

**Priority:** P2 — Simple but high-impact for utilization metrics.

**What it renders:** A semicircular or arc gauge showing a single metric value within a defined range (0-100 typically). Color zones indicate thresholds: green (OK), yellow (warning), red (critical). Looks like a speedometer.

**Data source (MCP tool):** `get_metric_data` (single latest datapoint for CPU, memory, disk, etc.).

**Example user queries:**
- "What's the current CPU utilization?"
- "How full is my disk?"
- "Show me memory usage as a gauge"
- "What percentage of my DynamoDB capacity is consumed?"

**Estimated complexity:** **S** — SVG arc with color segments. Simple math for arc angles. Similar in complexity to a stat_card but with visual arc rendering.

**Cloudscape equivalent:** No — CloudWatch dashboard has it but Cloudscape has no gauge component.

**Competitive parity:** Datadog (Query Value with gauge display), New Relic (Billboard with threshold coloring). Grafana has a dedicated gauge panel.

**Suggested data structure:**
```json
{
  "type": "gauge",
  "data": {
    "label": "CPU Utilization",
    "value": 73.5,
    "unit": "%",
    "min": 0,
    "max": 100,
    "thresholds": [
      { "value": 70, "color": "yellow", "label": "Warning" },
      { "value": 90, "color": "red", "label": "Critical" }
    ]
  }
}
```

---

## 9. SLO Status Card

**Priority:** P2 — Growing importance as teams adopt SLOs; Application Signals makes this a first-class concept.

**What it renders:** A card showing SLO attainment percentage, error budget remaining (as percentage and time), burn rate indicator, and status (on track / at risk / breached). Can show a small trend chart of attainment over the SLO period.

**Data source (MCP tool):** Application Signals `get_service_level_objective` API, or computed from `get_metric_data` if SLOs are metric-math-based.

**Example user queries:**
- "How are my SLOs doing?"
- "What's the error budget for the checkout service?"
- "Is our availability SLO at risk?"
- "Show me SLO attainment for the last 30 days"

**Estimated complexity:** **S** — Mostly text/numbers with a progress bar or small chart. Similar to an enhanced stat_card with additional fields.

**Cloudscape equivalent:** No — CloudWatch Application Signals has a custom UI.

**Competitive parity:** Datadog (SLO Widget, SLO List Widget), New Relic (SLI dashboards).

**Suggested data structure:**
```json
{
  "type": "slo_status",
  "data": {
    "label": "Checkout Service Availability",
    "slo_name": "99.9% Availability",
    "attainment": 99.82,
    "goal": 99.9,
    "error_budget_remaining": 42.3,
    "burn_rate": 1.8,
    "period": "30 days",
    "status": "at_risk",
    "trend": [99.95, 99.92, 99.88, 99.85, 99.82]
  }
}
```

---

## 10. Pie/Donut Chart

**Priority:** P2 — Useful for distribution breakdowns, common user question pattern.

**What it renders:** Circular chart divided into proportional segments. Donut variant has a center hole (can display a total). Each segment labeled with category name and percentage/value. Supports up to ~8 segments before readability degrades.

**Data source (MCP tool):** `get_metric_data` (aggregated across dimensions), `start_logs_insights_query` (stats with GROUP BY).

**Example user queries:**
- "What's the breakdown of errors by type?"
- "Show me traffic distribution across regions"
- "What percentage of requests go to each endpoint?"
- "Break down my Lambda invocations by function"

**Estimated complexity:** **S** — SVG arcs calculated from percentages. Standard math for arc paths. Simpler than line charts.

**Cloudscape equivalent:** Yes — Pie Chart component.

**Competitive parity:** Standard in all platforms (Datadog, New Relic, Grafana).

**Suggested data structure:**
```json
{
  "type": "pie_chart",
  "data": {
    "label": "Error Distribution by Type",
    "variant": "donut",
    "center_label": "1,247 total",
    "segments": [
      { "name": "Timeout", "value": 523, "color": "red" },
      { "name": "Throttled", "value": 312, "color": "orange" },
      { "name": "Auth Failure", "value": 245, "color": "yellow" },
      { "name": "Bad Request", "value": 167, "color": "blue" }
    ]
  }
}
```

---

## Summary: Implementation Roadmap

| # | Widget | Priority | Effort | Depends On | Unlocks |
|---|---|---|---|---|---|
| 1 | **Line Chart** | P0 | M | None | Time-series queries (most common user need) |
| 2 | **Topology Map** | P0 | L | None | "Show me my app topology" and service map queries |
| 3 | **Alarm Status Grid** | P1 | S | None | "Are any alarms firing?" queries |
| 4 | **Stacked Area Chart** | P1 | M | Line Chart (shared axis logic) | Resource breakdown queries |
| 5 | **Bar Chart** | P1 | M | Line Chart (shared axis logic) | Categorical comparison queries |
| 6 | **Key-Value Detail Panel** | P1 | S | None | Resource/trace/alarm detail queries |
| 7 | **Anomaly Detection Band** | P1 | M | Line Chart (overlay) | "Is this normal?" queries |
| 8 | **Gauge** | P2 | S | None | Utilization display queries |
| 9 | **SLO Status Card** | P2 | S | None | SLO monitoring queries |
| 10 | **Pie/Donut Chart** | P2 | S | None | Distribution breakdown queries |

### Suggested Build Order

**Phase 1 (Highest Impact):**
1. Line Chart — unlocks all time-series visualization
2. Topology Map — fixes the explicit user-reported gap
3. Alarm Status Grid — quick win, high frequency

**Phase 2 (Chart Family):**
4. Bar Chart — shares axis/grid logic with line chart
5. Stacked Area Chart — shares axis/grid logic with line chart
6. Key-Value Detail Panel — quick win, complements every other widget

**Phase 3 (Differentiation):**
7. Anomaly Detection Band — overlay on line chart, major value-add
8. Gauge — simple standalone, polished feel
9. SLO Status Card — growing user demand
10. Pie/Donut Chart — simple standalone, rounds out the chart library

After these 10, the plugin would cover **~35% of CloudWatch's visualization surface** (up from ~8%) and match the core widget sets of Datadog and New Relic for the most common observability queries.
