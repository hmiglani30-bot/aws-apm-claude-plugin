# Widget JSON Schemas

Detailed data shapes for each widget type in the AWS APM plugin UI layer.
Every widget node in a manifest MUST conform to the schema below for its
type. The renderer validates these shapes; invalid data triggers a degraded
fallback render.

---

## Common Envelope

Every widget shares this outer structure:

```json
{
  "type": "<widget_type>",
  "priority": "<integer 1-100>",
  "data": { /* type-specific, see below */ },
  "display_hints": {
    "size_preference": "compact | default | expanded",
    "emphasis": "primary | secondary | tertiary"
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string enum | Yes | One of: `stat_card`, `table`, `chart`, `timeline`, `trace_waterfall`, `log_viewer`, `change_event_list`, `sparkline`, `action_form` |
| `priority` | integer | Yes | 1-100. Lower = more important. Determines placement order in slots and overflow priority. |
| `data` | object | Yes | Shape depends on `type`. See per-widget schemas below. |
| `display_hints` | object | No | Renderer hints. `emphasis: "tertiary"` widgets are first to be hidden on narrow panels. |

---

## `stat_card` Data Schema

```json
{
  "label": "string (required) -- metric name displayed as uppercase label",
  "value": "string | number (required) -- the headline value",
  "unit": "string (optional) -- unit suffix (%, ms, /s, req/s, of 14)",
  "baseline": "number (optional) -- comparison value from baseline window",
  "baseline_label": "string (optional) -- e.g. '24h ago', '7d ago', 'last week'",
  "trend": {
    "direction": "up | down | flat (required if trend present)",
    "magnitude": "string (optional) -- e.g. '+1300%', '-8 pts', '+2.1x'",
    "good_or_bad": "good | bad (required if trend present)"
  },
  "sparkline": "[number] (optional) -- array of 5-20 values for inline mini chart",
  "status": "healthy | degraded | warning | unhealthy | neutral (optional)",
  "status_text": "string (optional) -- custom display text for status indicator",
  "badge": {
    "text": "string (required if badge present) -- e.g. 'SLO', 'P0', 'New'",
    "color": "blue | red | green | grey (optional, default blue)"
  }
}
```

### Required fields
- `label` -- always required
- `value` -- always required

### Conditional requirements
- If `trend` is present, both `trend.direction` and `trend.good_or_bad` are required
- If `badge` is present, `badge.text` is required

### Validation rules
- `sparkline` array should have 5-20 numeric values
- `status` must be one of the five canonical values
- `value` can be a number or a formatted string (e.g., "62")

---

## `table` Data Schema

```json
{
  "label": "string (required) -- table header text",
  "columns": [
    {
      "key": "string (required) -- field name in row objects",
      "label": "string (required) -- column header display text",
      "kind": "text | number | status | link | code (required)",
      "align": "left | right (optional, default left; right recommended for numbers)"
    }
  ],
  "rows": [
    {
      "<key>": "<value matching column kind>"
    }
  ],
  "searchable": "boolean (optional, default false) -- enables text filter input",
  "sortable": "boolean (optional, default false) -- enables column sort headers",
  "page_size": "number (optional, default 10) -- rows per page",
  "filter_placeholder": "string (optional) -- placeholder text for filter input",
  "empty_message": "string (optional) -- shown when rows array is empty"
}
```

### Required fields
- `label` -- always required
- `columns` -- at least 1 column
- `rows` -- can be empty array (renders empty_message)

### Column kind rendering
- `text` -- renders as plain string
- `number` -- right-aligned, sorted numerically
- `status` -- renders as Cloudscape `StatusIndicator`; accepted values: `healthy`, `ok`, `success`, `warning`, `warn`, `error`, `critical`, `unhealthy`
- `link` -- renders as clickable anchor; row value can be a URL string or `{ "href": "...", "label": "..." }`
- `code` -- monospace font, surface-2 background

### Row value types by column kind
- `text` -> `string`
- `number` -> `number` or numeric `string`
- `status` -> `string` (one of the status values above)
- `link` -> `string` (URL) or `{ "href": "string", "label": "string" }`
- `code` -> `string`
- Any kind -> `null` renders as em-dash (`--`)

---

## `chart` Data Schema

```json
{
  "label": "string (required) -- chart title",
  "x_label": "string (optional) -- x-axis label",
  "y_label": "string (optional) -- y-axis label",
  "series": [
    {
      "label": "string (required) -- series legend label",
      "points": [
        {
          "x": "string (ISO 8601 timestamp) or number",
          "y": "number (required)"
        }
      ],
      "color": "string (optional) -- CSS color or named color",
      "style": "solid | dashed | dotted (optional, default solid)"
    }
  ],
  "thresholds": [
    {
      "value": "number (required) -- y-axis value for horizontal line",
      "label": "string (optional) -- threshold label",
      "color": "string (optional) -- defaults to red",
      "style": "solid | dashed | dotted (optional, default dashed)"
    }
  ],
  "annotations": [
    {
      "x": "string (ISO 8601) or number -- x-axis position for vertical marker",
      "label": "string (required) -- annotation label",
      "color": "string (optional)"
    }
  ]
}
```

### Required fields
- `label` -- always required
- `series` -- at least 1 series with at least 2 points

### Guidelines
- Max 5 series per chart for readability
- Use `style: "dashed"` for baseline/comparison series
- Threshold lines are horizontal reference lines (alarm thresholds, SLO targets)
- Annotations are vertical markers (deploy times, incident start)

---

## `timeline` Data Schema

```json
{
  "label": "string (required) -- timeline section header",
  "events": [
    {
      "timestamp": "string (required) -- display timestamp (e.g., '14:02 UTC', '2026-04-28T14:02Z')",
      "title": "string (required) -- event headline",
      "severity": "info | warning | critical | success (required)",
      "description": "string (optional) -- additional detail",
      "link": "string (optional) -- URL to source (console deep-link)"
    }
  ]
}
```

### Required fields
- `label` -- always required
- `events` -- at least 1 event
- Each event requires `timestamp`, `title`, `severity`

### Guidelines
- Cap at 12-15 events per timeline widget
- Events should be in chronological order (earliest first)
- Use `severity` to color the timeline dots: info=blue, warning=amber, critical=red, success=green

---

## `trace_waterfall` Data Schema

```json
{
  "trace_id": "string (required) -- X-Ray trace ID",
  "total_duration_ms": "number (required) -- total trace duration in milliseconds",
  "spans": [
    {
      "name": "string (required) -- span/segment name (e.g., 'POST /checkout', 'db.query')",
      "service": "string (required) -- service name that owns this span",
      "start_ms": "number (required) -- start time relative to trace start, in ms",
      "duration_ms": "number (required) -- span duration in ms",
      "depth": "number (required) -- nesting depth (0 = root, 1 = direct child, etc.)",
      "status": "ok | error | throttled | timeout (required)"
    }
  ]
}
```

### Required fields
- `trace_id` -- always required
- `total_duration_ms` -- always required
- `spans` -- at least 1 span
- Every span field is required

### Guidelines
- Sort spans by `start_ms` ascending
- Depth 0 = the root segment (only one)
- Max one `trace_waterfall` per manifest
- Spans should be derived by walking segments depth-first from `batch_get_traces` output

---

## `log_viewer` Data Schema

```json
{
  "label": "string (required) -- viewer header",
  "log_group": "string (optional) -- CloudWatch Log Group name for context",
  "lines": [
    {
      "timestamp": "string (required) -- formatted timestamp",
      "severity": "error | warn | info | debug (required)",
      "message": "string (required) -- log line text"
    }
  ]
}
```

### Required fields
- `label` -- always required
- `lines` -- at least 1 line
- Each line requires `timestamp`, `severity`, `message`

### Guidelines
- Cap at 20 lines; for more, link to CloudWatch Logs console
- Parse severity from message content if the source does not provide it
- Use for unstructured log output only; structured results should use `table`

---

## `change_event_list` Data Schema

```json
{
  "label": "string (required) -- section header",
  "events": [
    {
      "timestamp": "string (required) -- event time",
      "title": "string (required) -- event description",
      "principal": "string (optional) -- who/what made the change",
      "resource": "string (optional) -- what was changed",
      "kind": "deploy | config | iam | infra | other (required)",
      "link": "string (optional) -- URL to CloudTrail event or console"
    }
  ]
}
```

### Required fields
- `label` -- always required
- `events` -- at least 1 event
- Each event requires `timestamp`, `title`, `kind`

### Guidelines
- Cap at 10 events; use `table` for larger sets
- Classify `kind` using the rules defined in the main SKILL.md (deploy, config, iam, infra, other)
- Include `link` when available for drill-down to CloudTrail console

---

## `sparkline` Data Schema

```json
{
  "label": "string (required) -- sparkline title",
  "points": "[number] (required) -- array of numeric values",
  "unit": "string (optional) -- unit for the current value",
  "current": "number (optional) -- highlighted current/latest value",
  "color": "blue | orange | red | green | gray (optional, default blue)"
}
```

### Required fields
- `label` -- always required
- `points` -- at least 3 numeric values

### Guidelines
- 5-30 points is the sweet spot
- The sparkline is a shape indicator, not a precise chart; use `chart` for axis labels and exact values
- If `current` is provided, it is displayed prominently next to the sparkline

---

## `action_form` Data Schema

```json
{
  "action_id": "string (required) -- unique action identifier (e.g., 'create_metric_alarm', 'tag_resource')",
  "label": "string (required) -- form header text",
  "description": "string (optional) -- what this action does",
  "mcp_tool": "string (required) -- full MCP tool name to call on submit",
  "tier": "4 (required, must be exactly 4 -- only Tier 4 actions are form-eligible)",
  "blast_radius": "string (required) -- scope of impact (e.g., 'single resource', 'all alarms in namespace')",
  "reversible": "boolean (required) -- whether the action can be undone",
  "rollback_plan": "string (required) -- how to undo if needed",
  "side_effect_detection": "string (required) -- how to verify the action took effect",
  "fields": [
    {
      "key": "string (required) -- parameter name in the MCP tool input",
      "label": "string (required) -- form field label",
      "type": "text | textarea | number | select | key-value (required)",
      "value": "any (optional) -- pre-filled value",
      "source": "string (optional) -- provenance of pre-filled value",
      "required": "boolean (optional, default false)",
      "validation": {
        "pattern": "string (optional) -- regex pattern",
        "max_length": "number (optional)",
        "min": "number (optional) -- for number type",
        "max": "number (optional) -- for number type",
        "options": "[{value, label}] (optional) -- for select type"
      }
    }
  ],
  "context": {
    "region": "string (required)",
    "account": "string (required)",
    "service": "string (optional)",
    "time_window": { "start": "string", "end": "string" }
  },
  "deep_link": "string (required) -- console URL fallback"
}
```

### Required fields
- `action_id`, `label`, `mcp_tool`, `tier`, `blast_radius`, `reversible`, `rollback_plan`, `side_effect_detection`, `fields`, `context`, `deep_link`
- `tier` MUST be `4`. The widget refuses to render for tier 5 or missing tier.

### Validation rules
- `deep_link` must be a valid AWS Console URL
- `context.region` and `context.account` are always required
- Each field in `fields[]` must have `key`, `label`, and `type`
- For `type: "select"`, `validation.options` should be provided

### Safety invariants
- The form does NOT execute the MCP call. It assembles parameters and surfaces the structured approval block.
- User confirms via `CONFIRM <ToolName>` in chat, not in the form.
- Every form must include the `deep_link` as a "do it in the console" fallback.

---

## Manifest Envelope Schema

The complete manifest wrapping widgets:

```json
{
  "version": "1.0",
  "metadata": {
    "title": "string (required)",
    "subtitle": "string (optional)",
    "severity": "critical | warning | info (required)",
    "query_intent": "string (required) -- short tag, used as cache key",
    "generated_at": "string (optional) -- ISO 8601 UTC",
    "service": "string (optional)",
    "region": "string (optional)",
    "environment": "string (optional)"
  },
  "widgets": [
    { "type": "...", "priority": 1, "data": { ... } }
  ]
}
```

### OR the template-based manifest:

```json
{
  "template": "single | stacked | grid | investigation_with_actions",
  "title": "string (optional)",
  "subtitle": "string (optional)",
  "slots": {
    "<slot_name>": [
      { "type": "...", "data": { ... } }
    ]
  }
}
```

### When to use which format
- **Hybrid-renderer manifest** (with `version`, `metadata`, `widgets[]`): For commands that use the `hybrid-renderer` skill. The renderer auto-selects the shell.
- **Template-based manifest** (with `template`, `slots`): For direct rendering via `runtime.jsx` where you explicitly choose the template layout.
