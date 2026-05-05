# Widget catalog — template, placement, color reference

Lookup tables that the `widget-catalog` SKILL.md points at. Loaded only when
the model needs the full mapping; the SKILL.md itself keeps the high-level
decision logic and is what the runtime loads first.

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

