---
name: hybrid-renderer
description: >
  Produce a JSON manifest the deterministic renderer turns into HTML. The
  hybrid grammar lets you decide WHICH widgets best answer a user query;
  the renderer decides WHERE they go (shell selection, slotting, density
  budget, overflow). Use this skill any time you would otherwise hand-author
  artifact HTML or pick a fixed Tier-3 template — the manifest path is
  cheaper, more flexible, and stays inside the Cloudscape visual grammar.
  Trigger phrases: "render manifest", "produce hybrid artifact",
  "build a custom artifact for this query", or invoked by any /cw-*
  investigation that doesn't have a dedicated Tier-3 template.
metadata:
  version: "0.1.0"
---

# Hybrid Renderer

You produce a JSON manifest. `renderer/render.js` produces the HTML.

```
LLM (you)               renderer (deterministic)
  picks WHICH widgets   ────►  picks WHERE they go
  fills the data              shell, slots, density, overflow
```

No LLM in the rendering loop. The renderer is a pure function.

## Output contract

Emit a single JSON object validated by `schemas/manifest.schema.json`:

```json
{
  "version": "1.0",
  "metadata": {
    "title": "string (required)",
    "subtitle": "string (optional)",
    "severity": "critical | warning | info  (required)",
    "query_intent": "short tag, used as cache key (required)",
    "generated_at": "ISO 8601 string (optional)",
    "service": "string (optional)",
    "region": "string (optional)",
    "environment": "string (optional)"
  },
  "widgets": [ /* 1..24 widgets, see catalog below */ ]
}
```

The renderer:
1. Validates the manifest. Invalid → falls back to a degraded artifact (raw widget table). Don't author a fallback yourself.
2. Sorts widgets by `priority` ascending (lower number = more important).
3. Infers the shell:
   - **single-focus** if any widget is high-density (`trace_waterfall`) OR there are ≤2 widgets total
   - **dashboard** if all widgets are low-density (density 1) AND there are ≥3 widgets
   - **investigation** otherwise (default mixed-density layout)
4. Places widgets into shell slots by priority, capped by density budget (single-focus 6, investigation 8, dashboard 10).
5. Overflows the rest into a collapsed `<details>` drawer with a "Show N more" toggle.

## Widget catalog

Densities determine how many widgets fit before overflow.

### `stat_card` — density 1
Big-number tile. Use for: KPIs, RED tiles, error budgets remaining, current p99 vs baseline.

`status` values: `healthy | degraded | warning | unhealthy | neutral`. Pick `degraded` for partial impact, `warning` for early-signal anomalies, `unhealthy` for actively failing.

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
    "trend": { "direction": "up", "magnitude": "+1300%", "good_or_bad": "bad" },
    "sparkline": [0.3, 0.4, 0.3, 0.5, 1.2, 2.8, 4.2],
    "status": "unhealthy"
  },
  "display_hints": { "size_preference": "default", "emphasis": "primary" }
}
```

### `sparkline` — density 1
Standalone time-series chart with current/min/max meta.

```json
{ "type": "sparkline", "priority": 5,
  "data": { "label": "p99 latency (1h)", "points": [120, 130, 140, 200, 320, 410], "unit": "ms",
            "current": 410, "color": "orange" } }
```

Colors: `blue | orange | red | green | gray`.

### `timeline` — density 2
Vertical event list with severity dots. Use for: deploy/event sequences, alarm transitions, breach milestones.

```json
{ "type": "timeline", "priority": 3,
  "data": { "label": "Breach milestones",
            "events": [
              { "timestamp": "14:02 UTC", "title": "Burn rate crossed 4× target",
                "severity": "warning", "description": "Fast-burn alarm fired." },
              { "timestamp": "14:08 UTC", "title": "Error budget at 50%",
                "severity": "critical", "link": "https://console.aws.amazon.com/..." }
            ] } }
```

### `table` — density 2
Sortable + searchable rows. Use for: top failing operations, dependency health, ranked hypotheses.

```json
{ "type": "table", "priority": 4,
  "data": {
    "label": "Top failing operations",
    "columns": [
      { "key": "op",     "label": "Operation",  "kind": "code" },
      { "key": "errors", "label": "Errors/min", "kind": "number", "align": "right" },
      { "key": "p99",    "label": "p99 (ms)",   "kind": "number", "align": "right" },
      { "key": "health", "label": "Health",     "kind": "status" }
    ],
    "rows": [
      { "op": "POST /checkout", "errors": 142, "p99": 980, "health": "unhealthy" },
      { "op": "GET /cart",      "errors": 6,   "p99": 220, "health": "warning" }
    ],
    "searchable": true,
    "sortable": true,
    "empty_message": "No failing operations in window."
  } }
```

Column `kind` values: `text | number | status | link | code`.
`status` accepts: `healthy/ok/warning/warn/error/critical/unhealthy`.

### `trace_waterfall` — density 3
Horizontal span bars. The renderer reserves the most space for this widget — present at most one per artifact, and only when the user asked about a specific trace.

```json
{ "type": "trace_waterfall", "priority": 1,
  "data": {
    "trace_id": "1-66348f12-5a3b...",
    "total_duration_ms": 1840,
    "spans": [
      { "name": "POST /checkout", "service": "checkout-api", "start_ms": 0,    "duration_ms": 1840, "depth": 0, "status": "error" },
      { "name": "auth.verify",     "service": "auth-svc",     "start_ms": 12,   "duration_ms": 38,   "depth": 1, "status": "ok" },
      { "name": "db.cart.read",    "service": "cart-db",      "start_ms": 60,   "duration_ms": 1620, "depth": 1, "status": "throttled" }
    ]
  },
  "display_hints": { "emphasis": "primary" } }
```

### `log_viewer` — density 2
Severity-coloured log lines. Use sparingly — prefer `table` for structured findings.

```json
{ "type": "log_viewer", "priority": 6,
  "data": {
    "label": "Error log sample",
    "log_group": "/aws/ecs/checkout-api",
    "lines": [
      { "timestamp": "14:08:02.123", "severity": "error", "message": "DynamoDB ProvisionedThroughputExceededException on table=carts" },
      { "timestamp": "14:08:02.350", "severity": "warn",  "message": "Retrying after 200ms" }
    ]
  } }
```

### `change_event_list` — density 1
Compact CloudTrail / deploy event list. Use for the "what changed recently" context column.

```json
{ "type": "change_event_list", "priority": 7,
  "data": {
    "label": "Recent changes (24h)",
    "events": [
      { "timestamp": "13:50 UTC", "title": "ECS service updated",
        "principal": "deploy-bot", "resource": "checkout-api:rev-942", "kind": "deploy",
        "link": "https://console.aws.amazon.com/cloudtrail/..." }
    ]
  } }
```

`kind` values: `deploy | config | iam | infra | other`.

## Display hints

```json
"display_hints": {
  "size_preference": "compact | default | expanded",
  "emphasis":        "primary | secondary | tertiary"
}
```

`emphasis` is a hint, not a guarantee. `tertiary` widgets are first to be hidden on narrow panels.

## Validation rules

The schema enforces:
- `version` must be `"1.0"`.
- `metadata.severity` must be one of `critical | warning | info`.
- `metadata.query_intent` must be a non-empty short tag (used as cache key).
- Each widget needs `type`, `priority`, and `data`.
- `priority` is an integer in `[1, 100]`.
- Per-widget `data` shape must match the catalog above.
- 1 ≤ widget count ≤ 24.

If you can't express the answer in the catalog, **emit a manifest anyway** with whatever widgets fit best — the renderer will degrade gracefully. Don't fall back to hand-authoring HTML.

## Example manifests

### Example A — Error spike triage (investigation shell)

User: "checkout-api 5xx rate jumped, what's going on?"

```json
{
  "version": "1.0",
  "metadata": {
    "title": "Error spike — checkout-api",
    "severity": "critical",
    "query_intent": "error-spike-triage",
    "service": "checkout-api",
    "region": "us-east-1",
    "environment": "prod"
  },
  "widgets": [
    { "type": "stat_card", "priority": 1, "data": {
        "label": "Error rate", "value": 4.2, "unit": "%",
        "baseline": 0.3, "baseline_label": "24h ago",
        "trend": { "direction": "up", "magnitude": "+1300%", "good_or_bad": "bad" },
        "sparkline": [0.3, 0.4, 0.3, 0.5, 1.2, 2.8, 4.2], "status": "unhealthy" } },
    { "type": "stat_card", "priority": 2, "data": {
        "label": "p99 latency", "value": 410, "unit": "ms",
        "baseline": 180, "baseline_label": "24h ago",
        "trend": { "direction": "up", "magnitude": "+128%", "good_or_bad": "bad" },
        "status": "degraded" } },
    { "type": "table", "priority": 3, "data": {
        "label": "Top failing operations",
        "columns": [
          { "key": "op", "label": "Operation", "kind": "code" },
          { "key": "errors", "label": "Errors/min", "kind": "number", "align": "right" },
          { "key": "p99",    "label": "p99 (ms)",   "kind": "number", "align": "right" },
          { "key": "health", "label": "Health", "kind": "status" }
        ],
        "rows": [
          { "op": "POST /checkout", "errors": 142, "p99": 980, "health": "unhealthy" },
          { "op": "GET /cart",      "errors": 6,   "p99": 220, "health": "warning" }
        ] } },
    { "type": "timeline", "priority": 4, "data": {
        "label": "Incident timeline",
        "events": [
          { "timestamp": "13:58 UTC", "title": "Deploy rev-942 began",   "severity": "info" },
          { "timestamp": "14:02 UTC", "title": "Error rate exceeded 1%", "severity": "warning" },
          { "timestamp": "14:08 UTC", "title": "Burn rate crossed 4× target", "severity": "critical" }
        ] } },
    { "type": "change_event_list", "priority": 5, "data": {
        "label": "Recent changes",
        "events": [
          { "timestamp": "13:50 UTC", "title": "ECS service updated", "kind": "deploy",
            "principal": "deploy-bot", "resource": "checkout-api:rev-942" }
        ] } }
  ]
}
```

### Example B — Latency regression with trace (single-focus shell)

User: "open trace 1-66348f12 — why was this slow?"

```json
{
  "version": "1.0",
  "metadata": {
    "title": "Trace 1-66348f12-5a3b… (1.84s)",
    "severity": "warning",
    "query_intent": "latency-regression-trace"
  },
  "widgets": [
    { "type": "stat_card", "priority": 1, "data": {
        "label": "Total duration", "value": 1840, "unit": "ms",
        "baseline": 220, "baseline_label": "p99 baseline", "status": "unhealthy",
        "trend": { "direction": "up", "magnitude": "+736%", "good_or_bad": "bad" } } },
    { "type": "trace_waterfall", "priority": 2, "data": {
        "trace_id": "1-66348f12-5a3b9c0e",
        "total_duration_ms": 1840,
        "spans": [
          { "name": "POST /checkout", "service": "checkout-api", "start_ms": 0,    "duration_ms": 1840, "depth": 0, "status": "error" },
          { "name": "auth.verify",     "service": "auth-svc",     "start_ms": 12,   "duration_ms": 38,   "depth": 1, "status": "ok" },
          { "name": "db.cart.read",    "service": "cart-db",      "start_ms": 60,   "duration_ms": 1620, "depth": 1, "status": "throttled" },
          { "name": "ddb.query",       "service": "cart-db",      "start_ms": 80,   "duration_ms": 1590, "depth": 2, "status": "throttled" },
          { "name": "payment.charge",  "service": "payment-svc",  "start_ms": 1700, "duration_ms": 130,  "depth": 1, "status": "ok" }
        ] }, "display_hints": { "emphasis": "primary" } }
  ]
}
```

### Example C — Portfolio SLO compliance (dashboard shell)

User: "weekly SLO compliance report"

```json
{
  "version": "1.0",
  "metadata": {
    "title": "Portfolio SLO compliance",
    "severity": "warning",
    "query_intent": "slo-compliance-report",
    "subtitle": "8 services · 14 SLOs · last 7 days"
  },
  "widgets": [
    { "type": "stat_card", "priority": 1, "data": {
        "label": "SLOs in breach", "value": 3, "unit": "of 14",
        "status": "unhealthy",
        "trend": { "direction": "up", "magnitude": "+1 vs last week", "good_or_bad": "bad" } } },
    { "type": "stat_card", "priority": 2, "data": {
        "label": "Burning fast", "value": 2, "unit": "services", "status": "degraded" } },
    { "type": "stat_card", "priority": 3, "data": {
        "label": "Healthy", "value": 11, "unit": "of 14", "status": "healthy",
        "sparkline": [10, 11, 11, 12, 11, 11, 11] } },
    { "type": "stat_card", "priority": 4, "data": {
        "label": "Avg budget remaining", "value": "62", "unit": "%",
        "status": "neutral",
        "trend": { "direction": "down", "magnitude": "-8 pts", "good_or_bad": "bad" } } },
    { "type": "change_event_list", "priority": 5, "data": {
        "label": "Largest budget burns this week",
        "events": [
          { "timestamp": "Mon", "title": "checkout-api availability — 22% burn", "kind": "other" },
          { "timestamp": "Wed", "title": "auth-svc latency — 14% burn", "kind": "other" }
        ] } },
    { "type": "change_event_list", "priority": 6, "data": {
        "label": "Recent SLO config changes",
        "events": [
          { "timestamp": "Tue", "title": "p99 target tightened on cart-svc", "kind": "config",
            "principal": "platform-team" }
        ] } }
  ]
}
```

## How to invoke

```js
import { initRenderer, renderManifest } from "./renderer/render.js";

await initRenderer();                                  // once at host startup
const html = renderManifest(manifest, { prompt: rawUserPrompt });
// inject `html` into the panel's content container
```

Pass the raw user prompt as `opts.prompt` to enable the manifest cache (30 min TTL, in-memory). Identical (prompt, query_intent) pairs return cached HTML.

## When NOT to use this skill

- A dedicated Tier-3 template already exists for the artifact (e.g. `service-health-card`, `slo-breach-explainer`). Use those — they have hand-tuned visuals.
- The user wants a Markdown-only summary in Claude Code (this skill produces HTML).
- The data is non-tabular, non-temporal, non-event content where none of the seven widgets fit. Describe in plain text instead.
