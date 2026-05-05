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

Nine widget types are defined. Seven are implemented in `renderer/widgets/`
and ship today; two are planned. Each has a density cost (how much visual
space it consumes), a Cloudscape component mapping, and rules for when to
use or avoid it.

### Implementation status

| Widget | Status | Source file |
|---|---|---|
| `stat_card` | ✅ available | `renderer/widgets/stat_card.js` |
| `table` | ✅ available | `renderer/widgets/table.js` |
| `sparkline` | ✅ available | `renderer/widgets/sparkline.js` |
| `timeline` | ✅ available | `renderer/widgets/timeline.js` |
| `trace_waterfall` | ✅ available | `renderer/widgets/trace_waterfall.js` |
| `log_viewer` | ✅ available | `renderer/widgets/log_viewer.js` |
| `change_event_list` | ✅ available | `renderer/widgets/change_event_list.js` |
| `chart` | 🚧 planned | not yet implemented — emit a `sparkline` or `stat_card` instead |
| `action_form` | 🚧 planned | not yet implemented — use `open-in-cloudwatch` deep links instead |

Skills MUST NOT emit `chart` or `action_form` widgets in manifests until the
corresponding source files appear in `renderer/widgets/`. Use the listed
fallback widgets in the meantime.

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
| **Component** | `timeline.js` -- renders as a vertical event list with severity-colored dots |
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
| **Component** | `trace_waterfall.js` -- horizontal span bars, nested by depth |
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
| **Component** | `log_viewer.js` -- severity-colored log lines in a monospace container |
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
| **Component** | `change_event_list.js` -- compact event list with kind-colored icons |
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
| **Component** | `sparkline.js` -- standalone mini time-series with current/min/max |
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
    "mcp_tool": "mcp__awslabs_cloudwatch-mcp-server__put_metric_alarm",
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

## 2-5. Templates, placement, MCP-to-widget mapping, color tokens

These sections moved out of SKILL.md to keep this file focused on widget definitions and the manifest contract. They are lookup tables you only need open while authoring a manifest — load on demand:

- `references/template-and-placement.md` — template registry, command-to-template defaults, slot priority, MCP-tool-to-widget transforms, status colour mapping.
- `references/template-query-matrix.md` — 25+ concrete query → template + widget examples.
- `references/widget-schemas.md` — full per-widget JSON Schema.

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
