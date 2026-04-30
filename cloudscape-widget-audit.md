# Cloudscape & CloudWatch Widget Audit for AWS Observability Plugin

**Date:** 2026-04-30
**Purpose:** Comprehensive gap analysis between CloudWatch console visualizations, Cloudscape design system components, and our plugin's current renderer.

---

## Part 1: Current Plugin Widget Inventory

Our renderer (`renderer/widgets/`) currently supports 8 widget types:

| # | Widget Type | Density | What It Renders | Status |
|---|---|---|---|---|
| 1 | `stat_card` | 1 (light) | Single-value metric with trend arrow, baseline, optional sparkline | Production |
| 2 | `sparkline` | 1 (light) | Inline SVG polyline time-series | Production |
| 3 | `table` | 2 (medium) | Sortable/searchable data table with typed cells (text, number, code, link, status) | Production |
| 4 | `timeline` | 2 (medium) | Ordered timestamped events with severity coloring | Production |
| 5 | `log_viewer` | 2 (medium) | Scrollable log lines with timestamp/severity/message | Production |
| 6 | `change_event_list` | 1 (light) | Infrastructure change events (deploy, config, IAM, infra) | Production |
| 7 | `trace_waterfall` | 3 (heavy) | Distributed trace spans with timing bars and depth | Production |
| 8 | `action_form` | 3 (heavy) | Prefilled form for Tier-4 write actions (alarm creation, etc.) | In worktree (pending merge) |

**Architecture notes:**
- Pure-function HTML generation (string templates, no DOM)
- 3 shell layouts: `single-focus`, `investigation`, `dashboard` (auto-selected by widget density)
- Density-based slot filling with budget constraints (6/8/10 density points)
- All user data escaped via `esc()`, never throws

---

## Part 2: Cloudscape Design System — Observability-Relevant Components

### 2A: Chart Components (Highcharts-based)

| Component | Description | Observability Relevance | Maps to Our Widget? |
|---|---|---|---|
| **Line Chart** | Time-series line graphs with multiple series, tooltips, thresholds, zoom | HIGH | Partially via `sparkline` (very limited) |
| **Area Chart** | Stacked/filled area charts for part-to-whole over time | HIGH | No |
| **Bar Chart** | Vertical bar/column charts for categorical comparison | HIGH | No |
| **Mixed Line and Bar** | Combines line + bar on shared x-axis, dual y-axes | HIGH | No |
| **Scatter Chart** | Two-dimensional point data for correlation analysis | MEDIUM | No |
| **Bubble Chart** | Scatter + size dimension (3D data encoding) | MEDIUM | No |
| **Pie/Donut Chart** | Proportional segments of a whole | MEDIUM | No |
| **Cartesian Chart** | Base component powering all cartesian types | HIGH | No |

### 2B: Data Display Components

| Component | Description | Observability Relevance | Maps to Our Widget? |
|---|---|---|---|
| **Table** | Sortable, filterable, paginated data table with row selection, inline editing, expandable rows | HIGH | Yes — `table` |
| **Cards** | Collection of resource cards with selection and filtering | MEDIUM | Partially via `stat_card` |
| **Key-Value Pairs** | Label-value list for resource metadata | HIGH | No (we inline this in other widgets) |
| **Status Indicator** | Compact status with icon (success/error/warning/info/pending/in-progress) | HIGH | Partially via `stat_card` status field |
| **Badge** | Small color-coded label with count or text | MEDIUM | No |
| **Copy to Clipboard** | One-click copy for IDs, ARNs, etc. | MEDIUM | No |

### 2C: Dashboard & Layout Components

| Component | Description | Observability Relevance | Maps to Our Widget? |
|---|---|---|---|
| **Board** | Drag-and-drop dashboard grid (12-column, responsive) | HIGH | Our shell layouts are simpler analogs |
| **Board Item** | Individual dashboard widget container | HIGH | Our widget wrapper divs |
| **App Layout** | Page shell with sidebar, drawers, split panel | HIGH | Out of scope (we render artifacts, not apps) |
| **Split Panel** | Collapsible secondary panel for details | HIGH | No |
| **Tabs** | Switch between metric/log/trace views | HIGH | No |
| **Expandable Section** | Collapse/expand content sections | MEDIUM | Our drawer slot is similar |

### 2D: Filtering & Search Components

| Component | Description | Observability Relevance | Maps to Our Widget? |
|---|---|---|---|
| **Property Filter** | Token-based filter queries (service=X AND latency>500ms) | HIGH | No |
| **Date Range Picker** | Absolute and relative time range selection | HIGH | No |
| **Text Filter** | Simple text search | MEDIUM | Yes — `table` search |
| **Segmented Control** | Toggle between views/modes | MEDIUM | No |

### 2E: Feedback Components

| Component | Description | Observability Relevance | Maps to Our Widget? |
|---|---|---|---|
| **Flashbar** | Stackable status notifications (error/success/warning/info) | HIGH | No |
| **Alert** | Inline status message with action | HIGH | No |
| **Status Indicator** | Compact health badge | HIGH | Partial (in stat_card) |
| **Progress Bar** | Operation progress | MEDIUM | No |

---

## Part 3: CloudWatch Console — Complete Visualization Inventory

### 3A: CloudWatch Dashboard Widgets

| # | Widget Type | Data Source | Interactive? | In Our Plugin? |
|---|---|---|---|---|
| 1 | **Line Chart** | CloudWatch Metrics API | Yes (zoom, tooltips) | No (only sparkline) |
| 2 | **Stacked Area Chart** | CloudWatch Metrics API | Yes | No |
| 3 | **Bar Chart** | CloudWatch Metrics API | Yes | No |
| 4 | **Pie Chart** | CloudWatch Metrics API | Yes | No |
| 5 | **Number (Single Value)** | CloudWatch Metrics API | Minimal (sparkline) | Yes — `stat_card` |
| 6 | **Gauge** | CloudWatch Metrics API | Static with color zones | No |
| 7 | **Text (Markdown)** | User-authored | Static | No |
| 8 | **Alarm Status Grid** | DescribeAlarms API | Yes (click-through) | No |
| 9 | **Data Table** | CloudWatch Metrics API | Yes (sortable) | Yes — `table` |
| 10 | **Logs Table** | Logs Insights API | Yes (clickable entries) | Yes — `log_viewer` |
| 11 | **Metrics Explorer** | Metrics API + tag-based filtering | Yes (auto-updates) | No |
| 12 | **Custom Widget (Lambda)** | Lambda function | Fully custom | No |
| 13 | **Contributor Insights** | Contributor Insights rules | Yes (top-N) | No |

### 3B: Logs Insights Visualizations

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 14 | **Bar Chart** | Logs Insights (stats query) | No |
| 15 | **Line Chart** | Logs Insights (bin() function) | No |
| 16 | **Stacked Area Chart** | Logs Insights (bin() function) | No |
| 17 | **Pie Chart** | Logs Insights (field grouping) | No |

### 3C: Application Signals & Topology

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 18 | **Application Map (Topology)** | Application Signals + OTel | No |
| 19 | **SLO Attainment Dashboard** | Application Signals SLO API | No |
| 20 | **SLO Burn Rate Chart** | Burn rate metrics | No |

### 3D: X-Ray / Trace Visualizations

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 21 | **Application Map (Q4 2025)** | GetServiceGraph API | No |
| 22 | **Trace Waterfall** | BatchGetTraces API | Yes — `trace_waterfall` |
| 23 | **Response Time Distribution** | X-Ray trace data | No |

### 3E: ServiceLens

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 24 | **ServiceLens Service Map** | X-Ray + Metrics + Logs (unified) | No |

### 3F: Container Insights

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 25 | **Container Map View** | Container Insights perf logs | No |
| 26 | **Container Performance Dashboard** | Container Insights metrics | No |

### 3G: Internet Monitor

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 27 | **Internet Health Events Map** | Internet Monitor measurements | No |
| 28 | **Global Internet Weather Map** | AWS infrastructure measurements | No |
| 29 | **Internet Monitor Dashboard** | Internet Monitor APIs | No |

### 3H: Network Monitor

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 30 | **Network Latency/Packet Loss Charts** | Network Synthetic Monitor probes | No |
| 31 | **Network Flow Topology** | Network Flow Monitor (agent) | No |

### 3I: Synthetics

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 32 | **Synthetics Canary Dashboard** | Synthetics API | No |
| 33 | **Synthetics Monitoring Dashboard** | Canary run data + baselines | No |

### 3J: RUM (Real User Monitoring)

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 34 | **RUM Performance Dashboard** | RUM web client data | No |
| 35 | **RUM Session Waterfall** | RUM session data | No |
| 36 | **RUM User Journey Map** | RUM page navigation data | No |

### 3K: Other Specialized Visualizations

| # | Widget Type | Data Source | In Our Plugin? |
|---|---|---|---|
| 37 | **Resource Health Grid** | EC2/EBS metrics | No |
| 38 | **Anomaly Detection Band** | ML model overlay | No |
| 39 | **Application Insights Dashboard** | SageMaker anomaly detection | No |
| 40 | **Evidently A/B Test Results** | Evidently experiment events | No |
| 41 | **Metrics Insights Query Results** | Metrics Insights SQL engine | No |
| 42 | **Cross-Account Dashboard** | Observability Access Manager | No |

---

## Part 4: Comprehensive Gap Analysis

| Widget/Visualization | In CloudWatch? | In Cloudscape? | In Our Plugin? | Priority | Effort | Notes |
|---|---|---|---|---|---|---|
| **Line Chart (time-series)** | Yes (dashboard + Logs Insights) | Yes (Line Chart) | No (only sparkline) | P0 | M | Most fundamental metric visualization |
| **Stacked Area Chart** | Yes (dashboard + Logs Insights) | Yes (Area Chart) | No | P1 | M | Resource breakdown, traffic composition |
| **Bar Chart** | Yes (dashboard + Logs Insights) | Yes (Bar Chart) | No | P1 | M | Categorical comparisons |
| **Service Map / Topology** | Yes (X-Ray, App Signals, ServiceLens) | No (custom) | No | P0 | L | "Show me my app topology" fails |
| **Gauge** | Yes (dashboard) | No | No | P2 | S | CPU/memory utilization display |
| **Alarm Status Grid** | Yes (dashboard) | Yes (Status Indicator) | No | P1 | S | Multi-alarm health overview |
| **Pie/Donut Chart** | Yes (dashboard + Logs Insights) | Yes (Pie Chart) | No | P2 | S | Distribution breakdowns |
| **SLO Burn Rate Chart** | Yes (App Signals) | No | No | P2 | M | SLO monitoring |
| **SLO Attainment** | Yes (App Signals) | No | No | P2 | S | SLO summary display |
| **Response Time Distribution** | Yes (X-Ray) | No | No | P2 | M | Histogram/percentile viz |
| **Heatmap** | No (Datadog/NR have it) | No | No | P3 | L | Distribution over time |
| **Container Map** | Yes (Container Insights) | No | No | P3 | L | EKS/ECS resource hierarchy |
| **Internet Health Map** | Yes (Internet Monitor) | No | No | P3 | L | Geographic health display |
| **Synthetics Dashboard** | Yes (Synthetics) | No | No | P3 | M | Canary pass/fail overview |
| **RUM Performance** | Yes (RUM) | No | No | P3 | M | Web vitals display |
| **RUM User Journey** | Yes (RUM) | No | No | P3 | L | Navigation flow map |
| **Resource Health Grid** | Yes (Resource Health) | No | No | P2 | M | Dense multi-host health |
| **Anomaly Detection Band** | Yes (overlay) | No | No | P1 | M | ML-powered normal range overlay |
| **Contributor Insights** | Yes (dashboard) | No | No | P2 | M | Top-N contributor analysis |
| **Mixed Line/Bar** | Yes (implicit) | Yes (Mixed Chart) | No | P2 | M | Correlating different metric types |
| **Key-Value Detail Panel** | Yes (everywhere) | Yes (Key-Value Pairs) | No (inlined) | P1 | S | Resource/trace/alarm details |
| **Scatter Plot** | No (Datadog/NR have it) | Yes (Scatter Chart) | No | P3 | M | Correlation analysis |
| **Markdown/Text** | Yes (dashboard text widget) | No | No | P3 | S | Freeform notes/context |
| **Number (Single Value)** | Yes (dashboard) | Yes (implicit) | Yes — `stat_card` | -- | -- | Already covered |
| **Data Table** | Yes (dashboard) | Yes (Table) | Yes — `table` | -- | -- | Already covered |
| **Log Viewer** | Yes (Logs Table) | Yes (Table variant) | Yes — `log_viewer` | -- | -- | Already covered |
| **Trace Waterfall** | Yes (X-Ray) | No | Yes — `trace_waterfall` | -- | -- | Already covered |
| **Event Timeline** | No (Datadog has it) | No | Yes — `timeline` | -- | -- | Already covered |
| **Change Event List** | No (custom) | No | Yes — `change_event_list` | -- | -- | Already covered |
| **Action Form** | No (custom) | No | Yes — `action_form` | -- | -- | Already covered (pending merge) |

---

## Part 5: Competitive Comparison

### Visualizations Datadog Has That We Don't

| Datadog Widget | CloudWatch Equivalent | Our Plugin? | Priority |
|---|---|---|---|
| Timeseries (line/area/bar) | Line/Area/Bar charts | No | P0-P1 |
| Query Value | Number widget | Yes (stat_card) | -- |
| Top List | Contributor Insights | No | P2 |
| Heatmap | None | No | P3 |
| Distribution | None | No | P3 |
| Scatter Plot | None | No | P3 |
| Treemap | None | No | P3 |
| Geomap | Internet Monitor map | No | P3 |
| Change/Delta | None | No | P2 |
| Hostmap | Resource Health grid | No | P2 |
| Topology Map | X-Ray/App Signals map | No | P0 |
| SLO Widget | SLO Attainment | No | P2 |
| Profiling Flame Graph | None | No | P3 |
| Funnel | RUM User Journey (partial) | No | P3 |
| Event Stream/Timeline | None | Yes (timeline) | -- |

### Visualizations New Relic Has That We Don't

| New Relic Chart | CloudWatch Equivalent | Our Plugin? | Priority |
|---|---|---|---|
| Billboard | Number widget | Yes (stat_card) | -- |
| Navigator (honeycomb) | None | No | P3 |
| Lookout (anomaly circles) | None | No | P3 |
| Dynamic Flow Map | Application Map (Q4 2025) | No | P0 |
| Histogram | X-Ray response time (partial) | No | P2 |
| Funnel | None | No | P3 |

---

## Part 6: Application Map / Topology — Deep Dive

### What the Application Map (Q4 2025) Looks Like

The service map is a **directed acyclic graph** where:
- **Nodes** = services (Lambda, API Gateway, DynamoDB, EC2, SQS, SNS, external HTTP, client pseudo-nodes)
- **Edges** = observed calls between services (with latency, error rate, request count)
- **Node overlays**: health coloring (green = OK, yellow = errors, red = faults), request counts, response time histogram
- **Edge overlays**: throughput, latency, error/fault rates
- **Root nodes** marked with `Root: true` (entry points)

### X-Ray GetServiceGraph API Response Structure

```json
{
  "Services": [
    {
      "ReferenceId": 1,
      "Name": "my-api",
      "Type": "AWS::ApiGateway::Stage",
      "Root": true,
      "SummaryStatistics": {
        "OkCount": 950,
        "TotalCount": 1000,
        "TotalResponseTime": 5.2,
        "ErrorStatistics": { "ThrottleCount": 5, "OtherCount": 10, "TotalCount": 15 },
        "FaultStatistics": { "OtherCount": 35, "TotalCount": 35 }
      },
      "ResponseTimeHistogram": [{ "Value": 0.005, "Count": 150 }],
      "Edges": [
        {
          "ReferenceId": 2,
          "SummaryStatistics": { "OkCount": 900, "TotalCount": 950, ... },
          "ResponseTimeHistogram": [...]
        }
      ]
    }
  ]
}
```

The graph is an **adjacency list**: each Service has `Edges[]` pointing to downstream services via `ReferenceId`.

### Rendering Approaches Comparison

| Approach | Dependencies | Layout Quality | Deterministic? | Bundle Size | Best For |
|---|---|---|---|---|---|
| **Manual SVG** | None | Basic (must implement layout) | Yes | ~0 KB | Simple graphs (3-8 nodes), zero-dep requirement |
| **D3.js Force-Directed** | D3 (~90KB) | Good (physics-based) | No (force simulation) | ~90 KB | Interactive exploration, medium graphs |
| **Mermaid.js** | Mermaid (~1.5MB) | Good (dagre layout) | Yes | ~1.5 MB | Quick prototyping, DAG structures |
| **dagre-d3 / d3-dag** | dagre + D3 | Excellent (hierarchical) | Yes | ~120 KB | Production DAG layouts (service maps) |

### Recommendation for Topology Widget

**Primary: Manual SVG with BFS-based layered layout.** Reasons:
- Zero external dependencies (consistent with plugin's current approach)
- Deterministic layout (same data = same picture every time)
- Full control over health coloring, AWS service icons, edge labels
- Smallest payload
- Service maps are typically 3-15 nodes — a simple layered layout handles this well

**Layout algorithm:**
1. BFS from root nodes to assign layer depth
2. Space nodes vertically within each layer
3. Draw directed edges with arrowheads
4. Color nodes by health: green (fault rate < 1%), yellow (error rate > 0), red (fault rate > 5%)
5. Label edges with key metrics (latency, req/s)

**Minimum viable widget data structure:**
```json
{
  "type": "topology_map",
  "data": {
    "label": "Application Topology",
    "time_range": "last 6 hours",
    "nodes": [
      {
        "id": "api-gateway",
        "name": "API Gateway",
        "service_type": "AWS::ApiGateway::Stage",
        "root": true,
        "status": "healthy",
        "metrics": { "requests": 1000, "errors": 15, "faults": 35, "avg_latency_ms": 52 }
      }
    ],
    "edges": [
      {
        "source": "api-gateway",
        "target": "order-service",
        "metrics": { "requests": 950, "error_rate": 0.02, "avg_latency_ms": 45 }
      }
    ]
  }
}
```

---

## Part 7: Summary Statistics

| Category | Total Identified | In Our Plugin | Gap |
|---|---|---|---|
| CloudWatch Dashboard Widgets | 13 types | 3 (stat_card, table, log_viewer) | 10 missing |
| Logs Insights Visualizations | 4 types | 0 | 4 missing |
| Application Signals / Topology | 3 types | 0 | 3 missing |
| X-Ray Visualizations | 3 types | 1 (trace_waterfall) | 2 missing |
| Container Insights | 2 types | 0 | 2 missing |
| Internet Monitor | 3 types | 0 | 3 missing |
| Synthetics | 2 types | 0 | 2 missing |
| RUM | 3 types | 0 | 3 missing |
| Other (anomaly, evidently, etc.) | 6 types | 0 | 6 missing |
| Datadog-exclusive | ~8 types | 0 | 8 missing |
| New Relic-exclusive | ~4 types | 0 | 4 missing |
| **TOTAL** | **~51 visualization types** | **4 matched** | **~47 gaps** |

Our plugin covers roughly **8% of the CloudWatch visualization surface**. The biggest gaps are in time-series charting (line/area/bar), topology/service maps, and alarm status displays.
