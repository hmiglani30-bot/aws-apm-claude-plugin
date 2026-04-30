---
name: widget-catalog
description: >
  Master catalog of every UI widget, template, and rendering rule for the
  AWS APM plugin. Loaded whenever the LLM must choose which widgets to
  place in a manifest, which template to select, or how to map MCP tool
  output to visual components. Trigger phrases: "render", "build artifact",
  "produce manifest", "choose template", "pick widgets", "widget catalog",
  "what widget for", "select layout", "render UI", "show results",
  "display investigation", "visualize metrics", "build dashboard",
  or any /cw-* command that produces a visual artifact.
metadata:
  version: "0.1.0"
---

# Widget Catalog

Reference for every widget type, template, and rendering rule in the AWS APM
plugin's UI layer. Use this skill to decide WHICH widgets to emit and HOW to
place them in a manifest. The deterministic renderer (`renderer/render.js`)
handles WHERE widgets go -- you never hand-author HTML.

See `references/widget-schemas.md` for detailed JSON schemas and
`references/template-query-matrix.md` for the full query-to-template mapping
table.

---

## 1. Widget Registry

Nine widget types are defined. Seven are **implemented** in
`renderer/widgets/` and ready to use today: `stat_card`, `table`,
`timeline`, `trace_waterfall`, `log_viewer`, `change_event_list`,
`sparkline`. Two are **planned** (`chart`, `action_form`) — emit them only
if you have a fallback path. Each entry below tags its current
implementation status.

Each widget has a density cost (how much visual space it consumes), a
Cloudscape component mapping, and rules for when to use or avoid it.

### 1.1 `stat_card` -- Single Metric KPI Tile

| Property | Value |
|---|---|
| **Component** | **Implemented** in `renderer/widgets/stat_card.js` -- Cloudscape-styled tile with `StatusIndicator` + optional `Badge` |
| **Density** | 1 (low -- fits many in a grid) |
| **Cloudscape parts** | `Container`, `Header`, `Box`, `SpaceBetween`, `StatusIndicator`, `Badge` |

**Data shape:**

```json
{
  "type": "stat_card",
  "priority": 1,
  "data": {
    "label": "Error rate",
    "value": 4.2,
    "unit": "%",
    "baseline": 0.3,
    "baseline_label": "24h ago",
    "trend": {
      "direction": "up | down | flat",
      "magnitude": "+1300%",
      "good_or_bad": "good | bad"
    },
    "sparkline": [0.3, 0.4, 0.3, 0.5, 1.2, 2.8, 4.2],
    "status": "healthy | degraded | warning | unhealthy | neutral",
    "status_text": "optional override for display label",
    "badge": { "text": "SLO", "color": "blue" }
  },
  "display_hints": { "size_preference": "compact | default | expanded", "emphasis": "primary | secondary | tertiary" }
}
```

**When to use:**
- Single KPI value with optional trend (error rate, p99, request rate, SLO attainment, error budget remaining)
- Output of `get_metric_data` when you need ONE current value vs. a baseline
- Output of `get_slo` for attainment or burn rate as a headline number
- Fleet-level counts (services in breach, alarms firing, healthy count)

**When NOT to use:**
- Time-series data where the shape of the curve matters -- use `chart` or `sparkline` instead
- Tabular data with multiple rows -- use `table`
- More than 6 stat cards in a single manifest -- the grid becomes unreadable; consolidate or use a `table`

**MCP tool sources:** `get_metric_data` (latest value), `get_slo` (attainment, burn_rate, budget_remaining), `describe_alarms` (alarm count by state), `list_services` (service count)

---

### 1.2 `table` -- Sortable Tabular Data

| Property | Value |
|---|---|
| **Component** | **Implemented** in `renderer/widgets/table.js` -- Cloudscape-styled `Table` with `TextFilter` and `Pagination` patterns |
| **Density** | 2 (medium) |
| **Cloudscape parts** | `Table`, `TextFilter`, `Pagination`, `Header`, `Box`, `StatusIndicator` |

**Data shape:**

```json
{
  "type": "table",
  "priority": 3,
  "data": {
    "label": "Top failing operations",
    "columns": [
      { "key": "op", "label": "Operation", "kind": "text | number | status | link | code" },
      { "key": "errors", "label": "Errors/min", "kind": "number", "align": "right" }
    ],
    "rows": [
      { "op": "POST /checkout", "errors": 142 }
    ],
    "searchable": true,
    "sortable": true,
    "page_size": 10,
    "filter_placeholder": "Filter rows",
    "empty_message": "No failing operations in window."
  }
}
```

Column `kind` values and their rendering:
- `text` -- plain string
- `number` -- right-aligned numeric, sortable numerically
- `status` -- renders as `StatusIndicator` (accepts `healthy/ok/warning/warn/error/critical/unhealthy`)
- `link` -- clickable anchor; value can be `string` (URL as label) or `{ href, label }`
- `code` -- monospace `<code>` block with surface-2 background

**When to use:**
- Operation breakdowns from `list_service_operations` or `get_top_contributors`
- Alarm inventories from `describe_alarms`
- Log query results from `get_query_results` (structured rows)
- Trace summary lists from `get_trace_summaries`
- Any ranked list with 3+ columns

**When NOT to use:**
- Single-value KPIs -- use `stat_card`
- Unstructured log lines -- use `log_viewer`
- Time-ordered event sequences where chronology matters more than sortability -- use `timeline`

**MCP tool sources:** `describe_alarms`, `list_service_operations`, `get_top_contributors`, `get_trace_summaries`, `get_query_results`, `list_services`

---

### 1.3 `chart` -- Time-Series Line/Area Chart

| Property | Value |
|---|---|
| **Component** | **Planned** (not yet in `renderer/widgets/`) -- will render via Cloudscape `LineChart` or `AreaChart`. For now, fall back to `sparkline` for single-series time data. |
| **Density** | 2 (medium) |
| **Cloudscape parts** | `LineChart`, `AreaChart`, `Header`, `Box` |

**Data shape:**

```json
{
  "type": "chart",
  "priority": 2,
  "data": {
    "label": "Error rate over time",
    "x_label": "Time (UTC)",
    "y_label": "Error rate (%)",
    "series": [
      {
        "label": "Current",
        "points": [
          { "x": "2026-04-28T07:00:00Z", "y": 0.3 },
          { "x": "2026-04-28T07:05:00Z", "y": 0.5 }
        ],
        "color": "red"
      },
      {
        "label": "24h baseline",
        "points": [ ... ],
        "color": "gray",
        "style": "dashed"
      }
    ],
    "thresholds": [
      { "value": 1.0, "label": "Alarm threshold", "color": "red", "style": "dashed" }
    ],
    "annotations": [
      { "x": "2026-04-28T07:32:00Z", "label": "Deploy rev-942", "color": "orange" }
    ]
  }
}
```

**When to use:**
- `get_metric_data` output with multiple timestamps -- the shape of the curve matters (spike onset, recovery slope, baseline comparison)
- Before/after comparison across a time window
- Burn rate over time from `get_slo` (not just current value)
- Any metric where trend direction alone (stat_card) is insufficient and the user needs to see the inflection point

**When NOT to use:**
- Single current value with no time dimension -- use `stat_card`
- Inline mini-chart inside a stat card -- use `sparkline` data within `stat_card`
- More than 3 chart widgets per manifest -- each takes significant space; prefer one chart with multiple series

**MCP tool sources:** `get_metric_data` (multi-point), `get_slo` (burn rate over time)

---

### 1.4 `timeline` -- Vertical Event Timeline

| Property | Value |
|---|---|
| **Component** | **Implemented** in `renderer/widgets/timeline.js` -- renders as a vertical event list with severity-colored dots |
| **Density** | 2 (medium) |
| **Cloudscape parts** | `SpaceBetween`, `StatusIndicator`, `Box`, `Link` |

**Data shape:**

```json
{
  "type": "timeline",
  "priority": 3,
  "data": {
    "label": "Incident timeline",
    "events": [
      {
        "timestamp": "14:02 UTC",
        "title": "Error rate exceeded 1%",
        "severity": "info | warning | critical | success",
        "description": "Optional longer description",
        "link": "https://console.aws.amazon.com/..."
      }
    ]
  }
}
```

**When to use:**
- Incident chronology: alarm fires, deployment events, breach milestones
- Ordered sequence of events where time-order tells the causal story
- Mixed sources (CloudTrail events + alarm transitions + SLO breaches) on a single timeline
- Output of `lookup_events` when the user wants "what happened in order"

**When NOT to use:**
- Purely tabular audit data where the user wants to sort/filter by columns -- use `table`
- A single event -- use a `stat_card` or inline text
- Deploy/config changes where the user needs principal + resource detail -- use `change_event_list`

**MCP tool sources:** `lookup_events` (chronological view), `describe_alarms` (state transitions), `get_slo` (breach events)

---

### 1.5 `trace_waterfall` -- Distributed Trace Visualization

| Property | Value |
|---|---|
| **Component** | **Implemented** in `renderer/widgets/trace_waterfall.js` -- horizontal span bars, nested by depth |
| **Density** | 3 (high -- takes the most space) |
| **Cloudscape parts** | Custom SVG/CSS within `Container` |

**Data shape:**

```json
{
  "type": "trace_waterfall",
  "priority": 1,
  "data": {
    "trace_id": "1-66348f12-5a3b...",
    "total_duration_ms": 1840,
    "spans": [
      {
        "name": "POST /checkout",
        "service": "checkout-api",
        "start_ms": 0,
        "duration_ms": 1840,
        "depth": 0,
        "status": "ok | error | throttled | timeout"
      }
    ]
  },
  "display_hints": { "emphasis": "primary" }
}
```

**When to use:**
- Output of `batch_get_traces` -- the user asked about a specific trace or wants to see span-level breakdown
- Latency regression investigations where identifying the slow span is the goal
- At most ONE per manifest -- it dominates the layout

**When NOT to use:**
- Trace summaries (list of traces without span detail) -- use `table`
- The user did not ask about a specific trace -- prefer `stat_card` + `table` for aggregate metrics
- More than one trace in the same artifact -- render one waterfall for the worst trace and link to the console for others

**MCP tool sources:** `batch_get_traces` (full span detail)

---

### 1.6 `log_viewer` -- Log Entries with Severity Coloring

| Property | Value |
|---|---|
| **Component** | **Implemented** in `renderer/widgets/log_viewer.js` -- severity-colored log lines in a monospace container |
| **Density** | 2 (medium) |
| **Cloudscape parts** | `Container`, `Box`, custom CSS for severity coloring |

**Data shape:**

```json
{
  "type": "log_viewer",
  "priority": 6,
  "data": {
    "label": "Error log sample",
    "log_group": "/aws/ecs/checkout-api",
    "lines": [
      {
        "timestamp": "14:08:02.123",
        "severity": "error | warn | info | debug",
        "message": "DynamoDB ProvisionedThroughputExceededException on table=carts"
      }
    ]
  }
}
```

**When to use:**
- Raw log lines from `get_query_results` where the output is unstructured text, not tabular columns
- Error message samples to support a hypothesis (show the actual exception text)
- Use sparingly -- prefer `table` for structured log query results

**When NOT to use:**
- Structured query results with defined columns (fields like `@timestamp`, `@message`, `statusCode`) -- use `table`
- Large volumes (>20 lines) -- link to CloudWatch Logs console instead
- Primary investigation widget -- `log_viewer` is supplementary evidence, not the main finding

**MCP tool sources:** `get_query_results` (unstructured log lines)

---

### 1.7 `change_event_list` -- Deployment/Config Change Events

| Property | Value |
|---|---|
| **Component** | **Implemented** in `renderer/widgets/change_event_list.js` -- compact event list with kind-colored icons |
| **Density** | 1 (low) |
| **Cloudscape parts** | `SpaceBetween`, `Box`, `Badge`, `Link` |

**Data shape:**

```json
{
  "type": "change_event_list",
  "priority": 7,
  "data": {
    "label": "Recent changes (24h)",
    "events": [
      {
        "timestamp": "13:50 UTC",
        "title": "ECS service updated",
        "principal": "deploy-bot",
        "resource": "checkout-api:rev-942",
        "kind": "deploy | config | iam | infra | other",
        "link": "https://console.aws.amazon.com/cloudtrail/..."
      }
    ]
  }
}
```

`kind` classification rules (from `/cw-trail-view`):
- `deploy` -- `UpdateFunctionCode`, `CreateDeployment`, ECS `UpdateService`, CloudFormation `UpdateStack`, CodeDeploy events
- `config` -- `Put*`, `Update*`, `Modify*` on configuration resources (parameter store, app config, feature flags)
- `iam` -- anything in `iam.amazonaws.com`, `AssumeRole`, `CreateAccessKey`, `AttachRolePolicy`, `PutBucketPolicy`
- `infra` -- VPC / EC2 / RDS / EKS resource lifecycle (`Create*`, `Delete*`, `Modify*`, `Reboot*`)
- `other` -- everything else

**When to use:**
- CloudTrail events correlated with an incident -- "what changed in the alarm window"
- Sidebar context alongside investigation widgets
- Compact summary of changes (5-10 events max)

**When NOT to use:**
- Full audit investigation where the user wants to sort/filter by principal/resource -- use `table`
- Events that need chronological narrative flow -- use `timeline`
- More than 10 events -- use `table` for paginated, sortable output

**MCP tool sources:** `lookup_events`

---

### 1.8 `sparkline` -- Inline Mini Chart

| Property | Value |
|---|---|
| **Component** | **Implemented** in `renderer/widgets/sparkline.js` -- standalone mini time-series with current/min/max |
| **Density** | 1 (low) |
| **Cloudscape parts** | Custom SVG within `Container`, `Box` |

**Data shape:**

```json
{
  "type": "sparkline",
  "priority": 5,
  "data": {
    "label": "p99 latency (1h)",
    "points": [120, 130, 140, 200, 320, 410],
    "unit": "ms",
    "current": 410,
    "color": "blue | orange | red | green | gray"
  }
}
```

**When to use:**
- Standalone trend visualization when a full `chart` is too heavy
- Dashboard-shell manifests where you want many small metrics in a grid
- When the shape of the trend matters but you don't need axis labels, thresholds, or multi-series

**When NOT to use:**
- When the value needs a status indicator + trend arrow -- use `stat_card` (which has its own inline `sparkline` field)
- When the user needs to read exact values at specific timestamps -- use `chart`
- When you need threshold lines or annotations -- use `chart`

**MCP tool sources:** `get_metric_data` (values array used directly as points)

---

### 1.9 `action_form` -- Interactive Write Workflow Form (Tier 4)

| Property | Value |
|---|---|
| **Component** | **Planned** (not yet in `renderer/widgets/`) -- will render via Cloudscape `Form` + `FormField` + safety badge. Until shipped, use the `confirm-write.sh` text-based confirmation block instead. |
| **Density** | 3 (high -- interactive, takes significant space) |
| **Cloudscape parts** | `Form`, `FormField`, `Input`, `Select`, `Button`, `Badge`, `StatusIndicator`, `Header`, `Container`, `Link`, `Divider` |

**Data shape:**

```json
{
  "type": "action_form",
  "data": {
    "action_id": "create_metric_alarm",
    "label": "Create Metric Alarm",
    "description": "Create a CloudWatch metric alarm for checkout-api Lambda errors",
    "mcp_tool": "mcp__awslabs__cloudwatch_mcp_server__PutMetricAlarm",
    "tier": 4,
    "blast_radius": "single resource",
    "reversible": true,
    "rollback_plan": "DeleteAlarms with alarm name (console deep-link provided)",
    "side_effect_detection": "Watch alarm state transitions in CloudWatch console",
    "fields": [
      {
        "key": "alarm_name",
        "label": "Alarm Name",
        "type": "text | textarea | number | select | key-value",
        "value": "checkout-api-Lambda-Errors-Sum-Critical",
        "source": "alerting-design recommendation",
        "required": true,
        "validation": { "pattern": "^[a-zA-Z0-9_\\-\\.]+$", "max_length": 255 }
      }
    ],
    "context": {
      "region": "us-east-2",
      "account": "123456789012",
      "service": "checkout",
      "time_window": { "start": "...", "end": "..." }
    },
    "deep_link": "https://us-east-2.console.aws.amazon.com/cloudwatch/..."
  }
}
```

**When to use:**
- ONLY when the user explicitly requests to create/apply a write action (create alarm, tag resource)
- ONLY for Tier 4 actions (MCP-executable with explicit approval)
- ONLY after a diagnostic workflow has produced the recommendation (e.g., `alerting-design` Phase 4 output)
- Place in the `actions` slot of the `investigation_with_actions` template or the `primary` slot of `focus`

**When NOT to use:**
- NEVER for Tier 5 actions -- use console deep-links via `open-in-cloudwatch` instead
- NEVER as the primary content of an investigation -- diagnostics come first, action forms come after
- NEVER without a `deep_link` fallback -- the user must always have the option to do it in the console
- NEVER pre-submit -- the form collects inputs; confirmation happens in chat via `CONFIRM <ToolName>`

**MCP tool sources:** N/A (the form triggers MCP tool calls; it does not consume their output directly). Pre-fill data comes from skill output (`alerting-design`, `alarm-response`).

---

## 2. Template Selection Matrix

Seven templates are available. The renderer picks a shell (single-focus, investigation, dashboard) from the widget mix, but YOU choose the template that structures the slot layout.

### 2.1 Template Registry

| Template | Layout | Slots | Max Widgets | Best For |
|---|---|---|---|---|
| `focus` | `Container` | `primary` (1, any type) | 1 | Focused single-widget answers: one trace waterfall, one table, one form |
| `investigate` | `SpaceBetween` | `components` (3, any type) | 3 | Two-to-three related widgets stacked vertically: metric + table, chart + timeline |
| `overview` | `Grid + Container` | `cards` (6, stat_card only) + `primary` (1, table/timeline/chart) | 7 | Dashboard-style: KPI row above a primary data view |
| `status` | `ColumnLayout` | `left` (2, stat_card/table/chart) + `right` (2, stat_card/table/chart) | 4 | Side-by-side status panels: current vs target, healthy vs unhealthy |
| `compare` | `ColumnLayout + Header` | `before` (3, stat_card/chart/table) + `after` (3, stat_card/chart/table) | 6 | Before/after or A/B comparison: deployment impact, config changes, time-range diffs |
| `dashboard` | `Grid + SpaceBetween` | `cards` (6, stat_card) + `charts` (2, chart/timeline) + `detail` (1, table/log_viewer) | 9 | Full dashboard with metric cards, charts, and detail table |
| `investigation_with_actions` | `SpaceBetween + Divider` | `diagnostic` (4, read-only types) + `actions` (2, action_form only) | 6 | Post-investigation remediation: diagnostics above, action forms below a divider |
| Focus (renderer-inferred) | Single-focus shell | Auto-slotted | 2 | Any manifest with a high-density widget (trace_waterfall) or 1-2 widgets total |
| Investigate (renderer-inferred) | Investigation shell | Auto-slotted by priority | 8 (density budget) | Mixed-density manifests -- the default for most investigation outputs |
| Dashboard (renderer-inferred) | Dashboard shell | Auto-slotted by priority | 10 (density budget) | All-low-density manifests with 3+ widgets (stat_card grids, sparklines) |

**Important distinction:** Templates `focus`, `investigate`, `overview`, `status`, `compare`, `dashboard`, and `investigation_with_actions` are explicit choices you make via the manifest's `template` field. The Focus/Investigate/Dashboard shells are inferred by the renderer from the `hybrid-renderer` manifest's widget mix when no explicit template is set.

### 2.2 Command-to-Template Default Mapping

| Command | Default Template | Rationale |
|---|---|---|
| `/cw-health-check` | `overview` (per service) or renderer Dashboard shell (fleet) | KPI cards per service + summary table for healthy services |
| `/cw-investigate-errors` | Renderer Investigation shell (hybrid manifest) | stat_cards + table + timeline + change_event_list |
| `/cw-investigate-latency` | Renderer Focus shell (if single trace) or Investigation shell | trace_waterfall dominates focus; multi-op uses investigation |
| `/cw-investigate-slo` | Renderer Investigation shell | stat_cards (burn rate, budget) + table (contributors) + timeline (breach events) |
| `/cw-slo-report` | Renderer Dashboard shell | All stat_cards + change_event_list (low-density, 3+ widgets) |
| `/cw-alarm-response` | Renderer Investigation shell | stat_cards + table (alarm detail) + timeline (state transitions) + change_event_list |
| `/cw-alert-design` | `investigate` | Coverage matrix table + gap analysis table + recommendation list |
| `/cw-verify-recovery` | `overview` | 5 check result stat_cards + primary results table |
| `/cw-trail-view` | Renderer-inferred (varies by intent) | `trail-activity-timeline` -> Investigation, `trail-summary-dashboard` -> Dashboard, `trail-audit-investigation` -> Investigation |
| `/cw-obs-gaps` | `investigate` | Gap report table + code-level recommendations |
| `/cw-doctor` | `overview` | 9 check stat_cards + results table |
| `/cw-set-context` | `investigate` | Profile table + region table |

### 2.3 Query Pattern Decision Tree

```
User query
  |
  +-- Mentions specific trace ID or "show me the trace"?
  |     YES --> Focus shell + trace_waterfall + stat_card
  |
  +-- Asks "what's wrong with X" / "why is X failing" / "triage" / "investigate"?
  |     YES --> Investigation shell
  |     |
  |     +-- Error-focused (5xx, errors, exceptions)?
  |     |     YES --> stat_cards (error rate, p99) + table (top ops) + timeline + change_event_list
  |     |
  |     +-- Latency-focused (slow, p99, regression)?
  |     |     YES --> stat_cards (p99, p50) + chart (latency over time) + table (slow ops) + trace_waterfall (worst)
  |     |
  |     +-- SLO-focused (breach, budget, burn rate)?
  |           YES --> stat_cards (attainment, burn, budget) + table (contributors) + timeline (breach milestones)
  |
  +-- Asks "compare" / "before and after" / "diff"?
  |     YES --> compare or overview
  |     +-- Two time windows --> chart (multi-series with baseline) + stat_cards (delta)
  |     +-- Two services    --> overview with stat_cards per service + table (side-by-side)
  |
  +-- Asks "overview" / "dashboard" / "summary" / "report" / "fleet"?
  |     YES --> Dashboard shell
  |     +-- SLO report    --> stat_cards (in breach, burning fast, healthy, avg budget) + change_event_list
  |     +-- Health check  --> stat_cards per service (grid) + healthy services table
  |     +-- Trail summary --> stat_cards (total, writes, principals, errors) + sparkline
  |
  +-- Asks "create alarm" / "apply" / "tag" / "execute"?
  |     YES --> investigation_with_actions
  |     +-- With prior investigation --> diagnostic widgets in diagnostic slot + action_form in actions slot
  |     +-- Standalone action        --> focus template with action_form in primary slot
  |
  +-- Asks "verify recovery" / "is it fixed" / "did the rollback work"?
  |     YES --> overview
  |     +-- 5 check stat_cards in cards slot + results table in primary slot
  |
  +-- Default / unclassified
        --> Investigation shell (safest default for operational queries)
```

See `references/template-query-matrix.md` for 25+ concrete example queries with template + widget selections.

---

## 3. Widget Placement Rules

### 3.1 Slot Priority

Widgets are assigned to template slots based on their type and the template structure:

**`overview` template:**
- `cards` slot: ONLY `stat_card` widgets. Place the highest-priority (lowest number) stat_cards here, up to 6.
- `primary` slot: ONE non-stat_card widget. The `table`, `timeline`, or `chart` with the lowest priority number.

**`investigate` template:**
- `components` slot: Up to 3 widgets of any type, in priority order. Place the most important widget first (it renders at the top).

**`focus` template:**
- `primary` slot: Exactly 1 widget. Use for focused answers (single trace, single table, single form).

**`status` template:**
- `left` slot: Up to 2 widgets (stat_card, table, chart). Current state or healthy services.
- `right` slot: Up to 2 widgets (stat_card, table, chart). Target state or unhealthy services.

**`compare` template:**
- `before` slot: Up to 3 widgets (stat_card, chart, table). Baseline or pre-change state.
- `after` slot: Up to 3 widgets (stat_card, chart, table). Current or post-change state.

**`dashboard` template:**
- `cards` slot: Up to 6 `stat_card` widgets. Headline KPIs across the top.
- `charts` slot: Up to 2 chart/timeline widgets. Side-by-side visual trends.
- `detail` slot: ONE table or log_viewer widget. Drill-down detail at the bottom.

**`investigation_with_actions` template:**
- `diagnostic` slot: Up to 4 read-only widgets (`stat_card`, `table`, `chart`, `timeline`). These render above the divider.
- `actions` slot: Up to 2 `action_form` widgets. These render below the divider with a "Recommended Actions" header and safety warning.

**Hybrid-renderer manifests (no explicit template):**
- Widgets are placed by priority number. The renderer picks the shell and slots automatically.
- Density budget caps total widgets: single-focus = 6, investigation = 8, dashboard = 10.
- Overflow widgets go into a collapsed "Show N more" drawer.

### 3.2 Data-to-Widget Mapping Rules

Given raw MCP tool output, choose widgets as follows:

| Data shape | Primary widget | Fallback widget |
|---|---|---|
| Single numeric value + optional baseline | `stat_card` | -- |
| Array of `{timestamp, value}` pairs (time-series) | `chart` | `sparkline` (if <10 points and no annotations needed) |
| Single latest value from time-series | `stat_card` (extract last value, compute trend from series) | -- |
| Array of objects with 3+ fields per object | `table` | -- |
| Array of `{timestamp, title, severity}` objects | `timeline` | `table` (if user wants to sort/filter) |
| Array of `{event_time, event_name, principal}` objects (CloudTrail) | `change_event_list` (if <10) | `table` (if >10 or user wants full audit) |
| Full trace with segments and subsegments | `trace_waterfall` | -- |
| Unstructured log text lines | `log_viewer` | `table` (if any structure exists) |
| SLO state (attainment + burn + budget) | `stat_card` (headline) + `chart` (burn over time) | -- |
| Alarm details (threshold, state, dimensions) | `table` (multi-alarm) | `stat_card` (single alarm state) |

### 3.3 Ranking Heuristic -- When Multiple Widgets Could Work

When a data shape could map to multiple widget types, rank by:

1. **User intent first.** If the query is "show me the trace," use `trace_waterfall` even though a `table` of spans would also work. If the query is "list all failing operations," use `table` even though a `timeline` could show them chronologically.

2. **Specificity over generality.** `change_event_list` is more specific than `table` for CloudTrail events; `log_viewer` is more specific than `table` for raw log lines. Prefer the specific widget when the data fits its exact shape.

3. **Density budget.** If you are already at 7 widgets in an investigation manifest and considering adding another density-2 widget, consider whether a density-1 alternative exists (`stat_card` summary instead of a full `table`).

4. **Readability at a glance.** For 3am triage, prefer `stat_card` (2-second read) over `chart` (10-second read) for headline metrics. Use `chart` only when the time-series shape is the finding.

### 3.4 Max Widgets Per Template

| Template | Hard max | Recommended max | Notes |
|---|---|---|---|
| `focus` | 1 | 1 | By definition |
| `investigate` | 3 | 2-3 | More than 3 requires scrolling; use `overview` or hybrid instead |
| `overview` | 7 | 4-5 (3 cards + 1 primary) | 6 cards + 1 primary is the ceiling; 4 cards + 1 table is the sweet spot |
| `status` | 4 | 2-3 (1-2 per side) | Side-by-side comparison; keep each column focused |
| `compare` | 6 | 4 (2 per side) | Before/after panels; symmetry helps readability |
| `dashboard` | 9 | 6-7 (4 cards + 2 charts + 1 table) | Full dashboard; detail slot anchors the bottom |
| `investigation_with_actions` | 6 | 3 diagnostic + 1 action | Keep diagnostics focused; one action form per remediation |
| Hybrid (renderer) | 24 (schema max) | 5-8 | Density budget overflows the rest into a drawer |

---

## 4. MCP Tool to Widget Mapping

Direct mappings from each MCP tool's output shape to the widget(s) that render it.

### 4.1 `get_metric_data` --> `chart` or `stat_card`

| Output shape | Widget | How to transform |
|---|---|---|
| Multiple timestamps + values (>3 points) | `chart` | Map `timestamps[]` to x-axis, `values[]` to y-axis. One series per metric query. |
| Multiple timestamps + values (>3 points) where you also need a headline | `stat_card` + `chart` | Extract last value for stat_card; use full series for chart. Compute trend from first vs. last value. |
| 1-3 data points (e.g., current only) | `stat_card` | Use the single value. If a 24h-ago query is also present, compute baseline + trend. |

**Baseline pattern:** Always issue TWO `get_metric_data` calls -- current window and same window 24h ago. Use the 24h values as `baseline` and `baseline_label` in the `stat_card`.

### 4.2 `describe_alarms` --> `table`

Transform each alarm object into a table row:

```
columns: [alarm_name (code), state (status), metric (text), threshold (number), last_updated (text)]
rows: one per alarm
```

For a single alarm, consider `stat_card` instead (state as status, threshold as value).

### 4.3 `get_trace_summaries` --> `table` or `timeline`

- **Default: `table`** -- columns: `trace_id (code)`, `duration_ms (number)`, `http_status (number)`, `has_error (status)`, `root_cause (text)`. Sortable by duration.
- **Alternative: `timeline`** -- if the user wants chronological ordering, map each trace to a timeline event with `timestamp`, `title` (trace_id + duration), `severity` (error/ok).

### 4.4 `batch_get_traces` --> `trace_waterfall`

Transform the full trace response into the waterfall data shape:
- `trace_id` from the trace object
- `total_duration_ms` from the root segment
- `spans[]` by walking segments and subsegments depth-first, computing `start_ms` relative to root, `duration_ms`, `depth` level, and `status` from fault/error/throttle flags

One waterfall per trace. If multiple traces were fetched, pick the most interesting (highest duration or has error) for the waterfall and list the rest in a `table`.

### 4.5 `start_query` / `get_query_results` --> `table` or `log_viewer`

| Result shape | Widget |
|---|---|
| Structured columns (aggregation query with `stats`, `count`, `avg`) | `table` -- map `[{field, value}]` pairs to column definitions |
| Raw log lines (`fields @timestamp, @message` only) | `log_viewer` -- map to `lines[]` with timestamp + severity (parse from message) + message |
| Mixed (some structured fields + `@message`) | `table` -- treat all fields as columns, including message |

### 4.6 `list_services` --> `table`

Map to a table with columns: `service_name (code)`, `namespace (text)`, `type (text)`.

For health-check contexts, enrich each row with RED metrics from `get_metric_data` and SLO state from `get_slo`, adding columns: `error_rate (number)`, `p99 (number)`, `slo_status (status)`, `verdict (status)`.

### 4.7 `get_slo` --> `stat_card` + `chart`

| Field | Widget mapping |
|---|---|
| `attainment` | `stat_card` -- value = attainment %, status from target comparison |
| `error_budget_remaining_seconds` | `stat_card` -- value = remaining %, trend from burn rate |
| `burn_rate` | `stat_card` -- value = burn rate (1.0 = normal), status: >4x = unhealthy, >1x = warning, <=1x = healthy |
| Burn rate over time (if available) | `chart` -- time-series with threshold line at 1.0 and fast-burn threshold |

### 4.8 `get_top_contributors` --> `table`

```
columns: [operation (code), contribution_pct (number), error_count (number), p99_ms (number)]
rows: sorted by contribution_pct descending
```

Add `sample_trace_ids` as a hidden detail or link column if trace drill-down is available.

### 4.9 `lookup_events` --> `change_event_list` or `timeline`

| Event count | Primary widget | Rationale |
|---|---|---|
| 1-10 events | `change_event_list` | Compact, scannable, shows kind/principal |
| 11-50 events | `table` | Needs pagination and filtering |
| >50 events | `table` with note to narrow filter | Too many for any compact widget |
| User wants chronological narrative | `timeline` | Time-ordered with severity dots |
| User wants audit (who did what) | `table` | Sortable by principal, filterable |

---

## 5. Color and Severity Mapping

### 5.1 Status Colors (from `tokens.js`)

| Semantic | CSS Variable | Hex | Use for |
|---|---|---|---|
| Critical / Error / Unhealthy | `--aws-apm-error` | `#FF375D` | Error rate breaches, SLO in breach, alarm in ALARM, unhealthy verdict |
| Warning / Degraded | `--aws-apm-amber` | `#FFA552` | SLO in warning, metric outside baseline +-20%, degraded verdict, Tier 4 safety badge |
| Healthy / Success / OK | `--aws-apm-success` | `#1FCE80` | All clear, SLO meeting target, alarm in OK, healthy verdict |
| Info / Neutral | `--aws-apm-info` | `#2196F7` | Informational events, links, neutral state, no comparison available |
| Primary / Accent | `--aws-apm-primary` | `#7B2CF5` | Links, interactive elements, selected items |

### 5.2 StatusIndicator Mapping

The `StatCard` and `Table` components map status strings to Cloudscape `StatusIndicator` types:

| Input status string | StatusIndicator type | Color |
|---|---|---|
| `healthy`, `ok`, `success` | `success` | Green |
| `warning`, `warn`, `amber` | `warning` | Amber |
| `error`, `critical`, `unhealthy` | `error` | Red |
| `info` (or unrecognized) | `info` | Blue |

Always use these exact strings in widget data. Do not invent new status values.

### 5.3 Trend Colors

| Trend | Color | CSS Variable |
|---|---|---|
| Up + good (e.g., throughput increasing) | Green | `--aws-apm-success` |
| Down + good (e.g., error rate decreasing) | Green | `--aws-apm-success` |
| Up + bad (e.g., error rate increasing) | Red | `--aws-apm-error` |
| Down + bad (e.g., throughput dropping) | Red | `--aws-apm-error` |
| Flat / no change | Muted gray | `--aws-apm-text-muted` |

### 5.4 Chart Series Colors

For `chart` widgets with multiple series, assign colors in this order from the viz palette:

1. `#2196F7` (blue) -- primary current series
2. `#FF375D` (red) -- error or anomaly series
3. `#1FCE80` (green) -- healthy/baseline series
4. `#FFA552` (amber) -- warning threshold or secondary series
5. `#7B2CF5` (purple) -- tertiary series
6. `#95a5b8` (gray) -- baseline / historical comparison (also use `style: "dashed"`)

For threshold lines, use semantic colors:
- Alarm threshold: red dashed (`#FF375D`)
- SLO target: amber dashed (`#FFA552`)
- Baseline reference: gray dashed (`#95a5b8`)

### 5.5 Surface Colors

| Surface | CSS Variable | Hex |
|---|---|---|
| Page background | `--aws-apm-bg-page` | `#0f1b2a` |
| Card/container background | `--aws-apm-bg-surface` | `#192534` |
| Nested surface (code blocks) | `--aws-apm-bg-surface-2` | `#1f2d3d` |
| Borders | `--aws-apm-border` | `#2a3a4f` |
| Primary text | `--aws-apm-text-primary` | `#e9ebed` |
| Secondary text (labels) | `--aws-apm-text-secondary` | `#95a5b8` |
| Muted text (timestamps, units) | `--aws-apm-text-muted` | `#6c7c91` |

### 5.6 Severity Assignment Rules

When setting `metadata.severity` in a manifest:

- **`critical`** -- any SLO in breach, error rate >2x baseline, alarm in ALARM state, any unauthorized/failed write event in CloudTrail
- **`warning`** -- any metric outside +-20% baseline, SLO in warning, IAM changes detected, burn rate >1x normal
- **`info`** -- all metrics within baseline, healthy fleet, informational reports (SLO compliance when no breaches), CloudTrail summaries with no anomalies

---

## 6. Manifest Construction Checklist

Before emitting a manifest, verify:

1. **Every widget has `type`, `priority`, and `data`.** Priority is an integer 1-100; lower = more important.
2. **`metadata` is complete.** Required: `title`, `severity`, `query_intent`. Optional but recommended: `subtitle`, `service`, `region`, `environment`, `generated_at`.
3. **Widget count is 1-24.** Schema rejects 0 or >24.
4. **`stat_card` status values use the canonical set.** Only: `healthy`, `degraded`, `warning`, `unhealthy`, `neutral`.
5. **`table` columns have valid `kind` values.** Only: `text`, `number`, `status`, `link`, `code`.
6. **At most ONE `trace_waterfall` per manifest.** It dominates the layout.
7. **`action_form` has `tier: 4` and `deep_link`.** Never emit an action form without a console fallback.
8. **Empty states are handled.** Every `table` needs an `empty_message`. Every section that might have no data should surface that explicitly.
9. **Trend `good_or_bad` matches the metric semantics.** Error rate going up is `bad`. Throughput going up is `good`. p99 going down is `good`.
10. **`query_intent` is a short, unique tag.** Used as cache key. Examples: `error-spike-triage`, `slo-compliance-report`, `latency-regression-trace`, `trail-audit-investigation`.

---

## 7. Anti-Patterns

Do NOT:

- **Hand-author HTML.** Always emit a manifest. The renderer handles layout, density, and overflow.
- **Put action_form widgets above diagnostic widgets.** Diagnostics justify the action; the user must see the evidence before seeing the form.
- **Use `chart` for a single current value.** That is what `stat_card` is for.
- **Use `table` for 1-2 rows.** Use `stat_card` or inline text. Tables shine at 3+ rows.
- **Use `log_viewer` as the primary investigation widget.** It is supplementary evidence. Lead with `stat_card` and `table`.
- **Exceed the density budget without purpose.** 10 stat_cards of marginal metrics dilute the signal. Focus on the 3-4 metrics that tell the story.
- **Omit the metadata footer.** Every investigation artifact needs source, time range, MCP tools called, and confidence.
- **Mix renderer-inferred shells with explicit template fields.** Either set `template` (for `focus`, `investigate`, `overview`, `status`, `compare`, `dashboard`, `investigation_with_actions`) OR emit a flat `widgets[]` array for the hybrid renderer. Do not mix both.
