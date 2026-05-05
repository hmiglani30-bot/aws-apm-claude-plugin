---
name: hybrid-renderer
description: >
  Decide whether a response is text-only, widget+text, or widget-only, then
  produce the JSON manifest the deterministic renderer turns into HTML. The
  hybrid grammar lets you decide WHICH widgets best answer a user query;
  the renderer decides WHERE they go (shell selection, slotting, density
  budget, overflow). Use this skill any time you would otherwise hand-author
  artifact HTML, pick a fixed Tier-3 template, OR write a free-text response
  to an investigation question — it tells you which path to take and how to
  size the prose. Trigger phrases: "render manifest", "produce hybrid
  artifact", "build a custom artifact for this query", "should this be a
  widget or text", "how long should this response be", or invoked by any
  /cw-* investigation that doesn't have a dedicated Tier-3 template.
metadata:
  version: "0.2.0"
---

# Hybrid Renderer

You produce one of three response shapes. Pick before you write a word.

```
LLM (you)               renderer (deterministic)
  picks WHICH widgets   ────►  picks WHERE they go
  picks the response    ────►  shell, slots, density, overflow
  shape (text/widget)
```

No LLM in the rendering loop. The renderer is a pure function.

## You are the canonical rendering path

You are the only path the agent uses to produce visual artifacts. See top-level `CLAUDE.md` rule 1.

- Investigation skills (`error-spike-triage`, `latency-regression`, `slo-breach-investigation`, `alarm-response`, etc.) hand you their collected data and trust you to choose the shape.
- You output a JSON manifest. The agent runs `render-standalone.mjs` to produce HTML. Do not produce HTML yourself.
- If a question doesn't justify a widget at all (lookup, simple yes/no, refusal), commit to text-only — that is *also* a valid output of this skill, not a fallback.
- Never narrate the gating logic, density budget, or shell selection at the user. Use it silently. Don't write "I'll select the dashboard shell because…"; just emit the manifest.

## Headline-first, details on demand

For any widget+text artifact, the first line the user reads is the verdict — one sentence, severity-tagged. Drawer overflow and supporting tables are progressive disclosure. Don't over-render: a 5-widget answer to a yes/no question wastes screen space and round-trips. Default to 2–3 widgets unless the user explicitly asked for "everything" or you're producing a fleet/portfolio dashboard.

## The three response shapes

| Shape | When | Word budget |
|---|---|---|
| **Text-only** | Lookups, early triage, no widget fits, <80% data completeness | 50–100 (lookup) · 200–400 (investigation) |
| **Widget + text** | Investigation has resolved into a clear finding, ≥5 data points, /cw-* artifact | **50–150 words of text, hard cap** |
| **Widget-only** (rare) | User explicitly asked for the chart/table itself ("show me the trace"), text would just narrate the picture | 0 |

The decision is upstream of manifest authoring. Do not start writing widgets or prose until you have committed to a shape.

## Decision logic — when to render a widget

Run these four gates in order. The first one that returns "text-only" wins; otherwise render the widget.

### Gate 1 — data completeness

For each widget you'd render, count the fields its schema requires (see the catalog below and `references/widget-schemas.md` in the widget-catalog skill).

- If you have **≥80% of the required fields populated from real MCP data**, the widget passes this gate.
- If you have **<80%**, drop the widget. Do not pad with `null`, `"unknown"`, `0`, placeholder strings, or numbers you didn't measure.

> A `stat_card` with `value` but no `baseline`, no `trend`, and no `sparkline` is at ~25% completeness. Render it as a sentence: "Error rate is 4.2% (no 24h baseline available)."

### Gate 2 — data volume signal

Count distinct numeric or temporal data points in the answer.

- **>5 points with spatial or temporal relationships** (a time series, a ranked list, a span tree, a multi-service comparison) → widget adds value.
- **≤5 points, or points with no relationship between them** → text-only. A widget for three numbers wastes the user's screen.

### Gate 3 — investigation stage

- **Early triage**: agent is still gathering, hypotheses are fluid, MCP calls are in flight → text-heavy. Drop in a single `stat_card` only if there's one number that drives everything ("error rate is at 12%, baseline is 0.3%").
- **Deep dive / final artifact**: data is collected, you've reached a conclusion → widget-appropriate.

If you find yourself writing "I'll need to check X next" alongside a widget, you're at the wrong stage. Either finish gathering or drop the widget.

### Gate 4 — user intent

- User ran a **`/cw-*` slash command** → they expect a rich artifact. Default to widget+text unless gates 1–3 disqualify every widget you'd pick.
- User asked a **freeform question** ("is checkout healthy?", "what's the p99 on auth-svc?") → default to text-only. Only escalate to a widget if gates 1–3 all clearly favor it.
- User explicitly said **"show me the chart" / "render the trace" / "table this"** → widget-only or widget-dominant, with text reduced to a one-line caption.

## Word limits

### Widget + text — 50 to 150 words, hard cap

The widget IS the content. Text is metadata and navigation. If your prose exceeds 150 words next to a widget, you are either hedging or restating what the picture already shows. Cut.

The 150-word ceiling is derived: at ~15 words per sentence, that's 10 sentences. A reader paged at 3am scans the widget first and reads the text only to confirm what they're looking at — they will not absorb more than 10 sentences before acting.

**Required structure — three sentences, in order:**

1. **Context (1 sentence)** — what the widget is showing and the time window. *"Below: 5xx rate on `checkout-api` over the last 30 minutes vs the prior 24h baseline."*
2. **Key finding (1 sentence)** — the one number or pattern the on-call needs to leave with. *"Error rate climbed from 0.3% to 4.2% at 14:02 UTC, coincident with `rev-942`."*
3. **Recommended action (1 sentence)** — the next read-only verification step or the proposed mitigation. *"Roll back `rev-942` or check the deploy diff at the link in the change list."*

You may add up to two short evidence sentences between (2) and (3) when one piece of context the widget can't show is load-bearing (blast radius, business impact, a hidden dependency). Cut everything else.

### Text-only — depends on the question

| Question type | Word budget | Use |
|---|---|---|
| Simple lookup ("what's the p99?", "is X healthy?") | 50–100 | Direct answer, one supporting number, no preamble. |
| Investigation response | 200–400 | Summary line → 2–4 findings → evidence → next steps. |
| Rejection / can't answer | 30–80 | Say what's missing and what would unblock you. |

A text-only investigation response is not "we couldn't render a widget so we wrote prose instead." It is the right shape when the data isn't there yet, when the answer is causal rather than visual, or when the user asked a yes/no question.

## Text-only response structure (no widget)

For a 200–400 word investigation response, follow this skeleton. Do not skip sections; if a section would be empty, the response shouldn't exist yet.

```
[Summary line — 1 sentence, the answer first]

Key findings
- [Finding 1 — specific number with timestamp]
- [Finding 2 — ...]
- [Finding 3 — optional]
- [Finding 4 — optional, max]

Evidence
[2–4 sentences citing MCP data: metric values, log patterns, trace IDs,
 deploy events. Each claim must be traceable to a tool call.]

Next steps
- [Read-only verification, or]
- [Proposed mitigation with a link to the runbook]
```

For a 50–100 word lookup, drop everything except the summary line and one supporting fact.

### Anti-patterns to avoid in text-only responses

- **Restating the question.** ("You asked about checkout-api error rate. The error rate on checkout-api…")
- **Hedging without evidence.** ("It could be a deploy or a database issue.") If you don't have evidence to rank them, say "I haven't ruled out X yet — to confirm, I'd run Y."
- **Listing raw data without interpretation.** A wall of metric values is not an answer.
- **Same finding in three different words.** One sentence per finding.
- **Methodology before conclusion.** Don't open with "I queried CloudWatch logs for…". Open with what you found.

## Text presentation best practices

The full guide lives in `references/text-presentation-guide.md`. The non-negotiables:

1. **Lead with the answer.** First sentence = the conclusion. Methodology, if needed, comes later.
2. **Specific numbers, not vague language.** "p99 latency rose from 180ms to 410ms (+128%) at 14:02 UTC" — not "latency went up significantly".
3. **Human-readable timestamps with timezone.** `14:02 UTC`, `2026-04-30 09:15 PT`. Never bare epoch seconds.
4. **Service names match the user's convention.** Pull from `service-ownership` skill output; do not invent canonical names.
5. **Units are consistent.** Error rates as percentages, latencies in ms (or s if >1000ms), counts as absolute integers, money in the source currency.
6. **Acknowledge the widget when one is rendered.** "The trace waterfall above shows…", "In the table, rows highlighted red…" — never write text that ignores its companion picture.
7. **Scan-first formatting for text-only.** Bold the key number. Use bullets for ≥3 findings. Keep paragraphs to ≤4 lines on a typical terminal.
8. **3am test.** Read your response as if you were just paged. Can you act in 10 seconds? If not, cut.

## Coherence rules — text and widget must tell the same story

These violations are bugs, not stylistic preferences. The renderer cannot catch them; you have to.

- **Same scope.** If the widget shows 5 services, the text must reference all 5 (or call out which it's narrowing to and why). Don't talk about 3.
- **Same numbers.** If the widget says `p99 = 410ms`, the text says `410ms`, not `~400ms` or `over 400ms`. Round in one place or in neither.
- **Same time window.** Widget legend and text framing must agree on the window. "Over the last 30 minutes" in text + a 1-hour sparkline in the widget is incoherent.
- **Same severity.** If the manifest's `metadata.severity` is `critical`, the text is not "things are looking a bit elevated."
- **Text adds, doesn't repeat.** The widget shows *what*; the text adds *why it matters*: causality, blast radius, business impact, the named owner who needs paging. If the text is a prose dump of the table, delete it.
- **No phantom widgets.** Don't reference a chart you didn't render. Don't reference a row that's been overflowed into the drawer without flagging it ("see the 'Show 3 more' drawer").

## Context provider

The manifest metadata fields map to context provider fields:

- `context.service` — mapped to `metadata.service`
- `context.region` — mapped to `metadata.region`
- `context.environment` — mapped to `metadata.environment`

## MCP tool dependencies

None — this skill produces a JSON manifest from data already collected by investigation skills. The renderer is a deterministic pure function.

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

### `app_map` — density 3
Service-topology graph. Use for: blast-radius views, dependency-failure stories, "which downstream is the slow one". Mark the critical path so the renderer can highlight it.

```json
{ "type": "app_map", "priority": 2,
  "data": {
    "label": "checkout-api dependency map",
    "services": [
      { "id": "checkout-api", "name": "checkout-api", "status": "unhealthy", "error_rate": 4.2, "error_rate_unit": "%", "latency_ms": 410, "on_critical_path": true },
      { "id": "carts-ddb",    "name": "carts (DynamoDB)", "status": "degraded", "on_critical_path": true },
      { "id": "auth-svc",     "name": "auth-svc", "status": "healthy" }
    ],
    "edges": [
      { "from": "checkout-api", "to": "carts-ddb", "on_critical_path": true },
      { "from": "checkout-api", "to": "auth-svc" }
    ],
    "critical_path": ["checkout-api", "carts-ddb"]
  } }
```

`status` values match `stat_card`: `healthy | degraded | warning | unhealthy | neutral`. Pick this widget when the answer is "where in the topology is the failure" — not for a single service's RED metrics.

### `diff_view` — density 3
Before/after content with `unified` or `side-by-side` rendering. Use for: deploy-config diffs, IAM policy changes, alarm threshold edits picked up from CloudTrail. Carries an optional `metadata` block (`what`, `who`, `when`) so the diff is self-explanatory.

```json
{ "type": "diff_view", "priority": 4,
  "data": {
    "label": "ECS task definition — checkout-api rev-941 → rev-942",
    "mode": "side-by-side",
    "before": { "label": "rev-941", "language": "json", "content": "\"memory\": 2048" },
    "after":  { "label": "rev-942", "language": "json", "content": "\"memory\": 1024" },
    "metadata": { "what": "task-def memory halved", "who": "deploy-bot", "when": "2026-04-30 13:50 UTC" }
  } }
```

Diffs over ~200 lines should be summarised in companion text — the widget shows the change, the text explains why it matters.

### `heatmap` — density 2
Two-dimensional value grid (rows × columns) with a min/max colour scale. Use for: hour-of-day × day-of-week error density, operation × region latency, retry counts by host. `data` is a 2-D array sized `rows.length × columns.length`; missing cells are `null`.

```json
{ "type": "heatmap", "priority": 5,
  "data": {
    "label": "5xx rate by hour × day (last 7d)", "unit": "%",
    "rows": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    "columns": ["00","04","08","12","16","20"],
    "data": [
      [0.1, 0.1, 0.2, 0.3, 0.4, 0.2],
      [0.1, 0.1, 0.2, 4.2, 0.4, 0.3],
      [0.1, 0.1, 0.2, 0.3, 0.4, 0.2],
      [0.1, 0.1, 0.2, 0.3, 0.4, 0.2],
      [0.1, 0.1, 0.2, 0.3, 0.4, 0.2],
      [0.1, 0.1, 0.2, 0.3, 0.4, 0.2],
      [0.1, 0.1, 0.2, 0.3, 0.4, 0.2]
    ],
    "scale": { "min": 0, "max": 5 }
  } }
```

Prefer `sparkline` when the second axis would be redundant (single time series). `heatmap` shines when both axes carry signal.

### `comparison_table` — density 2
Peer / variant comparison across columns (services, regions, deploy revisions). Use for: "this service vs its 3 nearest peers", "us-east-1 vs us-west-2 on the same metrics", "before vs after deploy". Each row carries a metric label, per-column `values`, and optional `delta` annotations with direction and good/bad coloring.

```json
{ "type": "comparison_table", "priority": 3,
  "data": {
    "label": "checkout-api vs peers (last 1h)",
    "columns": [
      { "key": "checkout", "label": "checkout-api", "sublabel": "incident" },
      { "key": "carts",    "label": "carts-svc" },
      { "key": "auth",     "label": "auth-svc" }
    ],
    "rows": [
      { "metric": "Error rate", "unit": "%",
        "values": { "checkout": 4.2, "carts": 0.4, "auth": 0.1 },
        "delta":  { "checkout": { "magnitude": "+1300%", "direction": "up", "good_or_bad": "bad", "highlight": true } } },
      { "metric": "p99 latency", "unit": "ms",
        "values": { "checkout": 410, "carts": 180, "auth": 90 } }
    ]
  } }
```

Pick this when the answer is comparative ("X is doing Y, peers aren't"). Use plain `table` when there is no peer dimension — just rows of findings.

### `progress_tracker` — density 2
Linear or stepwise progress over a known list of steps. Use for: recovery / rollback playbook progress, multi-step verification (alarm OK → SLO burn stopped → p99 recovered), incident-response timelines.

```json
{ "type": "progress_tracker", "priority": 6,
  "data": {
    "label": "Rollback verification",
    "steps": [
      { "label": "Roll back rev-942",          "status": "completed", "detail": "Triggered by deploy-bot at 14:14 UTC" },
      { "label": "5xx rate < 1%",               "status": "completed", "detail": "Now at 0.4% (target 1%)" },
      { "label": "p99 < 250ms",                 "status": "in_progress", "detail": "Currently 280ms, trending down" },
      { "label": "Fast-burn alarm cleared",     "status": "pending" },
      { "label": "Postmortem doc opened",       "status": "skipped" }
    ]
  } }
```

`status` values: `pending | in_progress | completed | failed | skipped`. Don't reach for this widget for free-form narratives — pick `timeline` when there's no fixed step list.

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

Companion text (132 words — under the 150-word cap):

> Below: RED metrics on `checkout-api` for the last 30 min, the top failing operations, and the deploy timeline.
>
> Error rate climbed from 0.3% to 4.2% (+1300%) starting 14:02 UTC, four minutes after `rev-942` rolled out. `POST /checkout` is the only operation seeing the spike — 142 errors/min, p99 at 980ms. `GET /cart` is borderline but unrelated.
>
> Roll back `rev-942` or pull the deploy diff at the change-list link. While that's in flight, page the checkout-api owner in `#oncall-checkout`.

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

Companion text (62 words):

> Below: full waterfall for trace `1-66348f12-5a3b…` (1.84s end-to-end, p99 baseline 220ms).
>
> 88% of the wall time is `db.cart.read` → `ddb.query` returning `throttled`. Auth and payment spans are normal.
>
> Check DynamoDB throttling on the `carts` table; if confirmed, raise WCU or fix the hot partition before retrying.

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

### Example D — Text-only lookup

User: "what's the p99 on auth-svc right now?"

A single number with no relationship to anything else. Gates 2 and 4 both push to text-only.

> p99 on `auth-svc` is **48ms** as of 14:11 UTC, in line with the 24h baseline of 45ms. No alarms firing. (No widget — single number, no trend signal worth charting.)

77 words including the parenthetical. Under the 100-word lookup cap.

### Example E — Text-only investigation response

User: "is there anything weird with checkout-api in the last hour?"

Investigation question, but at this stage the agent has only RED metrics — no traces sampled yet, no log patterns clustered, no deploy correlation. Gate 1 fails for `table` (no per-operation breakdown), gate 1 fails for `timeline` (no events with severity). One stat_card alone for "error rate is normal" would be slot-padding. Text-only.

> Checkout-api looks normal in the last hour. Error rate held at 0.28% (24h baseline 0.3%) and p99 at 175ms (baseline 180ms). No alarms in `ALARM`, no deploys via CloudTrail since `rev-941` at 09:14 UTC.
>
> Two minor signals worth a closer look if you want one:
> - `GET /cart` p95 ticked from 60ms to 95ms around 13:45 UTC, then settled — could be a cache warm event.
> - One spike of 4 throttled DynamoDB reads at 13:52 UTC on the `sessions` table; under the alarm threshold so nothing paged.
>
> Next steps if you want to dig: run `/cw-investigate-latency checkout-api GET /cart 30m` for the cart blip, or `/cw-investigate-errors` for a wider window.

172 words, in the 200–400 investigation band's lower half — appropriate because the answer is "nothing's wrong."

## How to invoke

There are two invocation paths. Pick the one that matches your runtime.

### Claude Code / Cowork (CLI path — the canonical one for this plugin)

The model writes the manifest JSON to disk, then runs the standalone renderer
via `Bash`. The renderer is a Node.js CLI bundled with the plugin.

```bash
# 1. Pick a stable, writable artifact path. Use the plugin-relative output
#    directory so files are easy to find and don't pollute the user's repo.
mkdir -p "${CLAUDE_PROJECT_DIR:-.}/.aws-apm/artifacts"
artifact_dir="${CLAUDE_PROJECT_DIR:-.}/.aws-apm/artifacts"

# 2. Write the manifest you produced. Replace <intent> with metadata.query_intent.
cat > "$artifact_dir/<intent>-$(date +%Y%m%dT%H%M%SZ).manifest.json" <<'EOF'
{ ...your manifest JSON... }
EOF
manifest_path="$(ls -t "$artifact_dir"/<intent>-*.manifest.json | head -1)"
output_path="${manifest_path%.manifest.json}.html"

# 3. Render. CLAUDE_PLUGIN_ROOT is set by the plugin host (Claude Code and
#    Cowork both populate it) and resolves to the plugin install directory.
node "$CLAUDE_PLUGIN_ROOT/render-standalone.mjs" "$manifest_path" "$output_path"
```

After the render succeeds, **surface both paths to the user**: the manifest
(for re-rendering / sharing / debugging) and the HTML (for viewing). Cowork's
inline display picks up `*.html` artifacts placed under
`${CLAUDE_PROJECT_DIR}/.aws-apm/artifacts/`; Claude Code shows the path so the
user can open it manually.

If `node` is not available, do NOT fall back to hand-authoring HTML — emit the
manifest JSON to disk anyway and tell the user: "Manifest written to
`<path>`. To render, install Node.js 18+ then run `/cw-doctor` to verify, or
run `node ${CLAUDE_PLUGIN_ROOT}/render-standalone.mjs <manifest> <out.html>`
manually." The manifest is the artifact-of-record; the HTML is a presentation
view.

### Browser / programmatic host

```js
import { initRenderer, renderManifest } from "./renderer/render.js";

await initRenderer();                                  // once at host startup
const html = renderManifest(manifest, { prompt: rawUserPrompt });
// inject `html` into the panel's content container
```

Pass the raw user prompt as `opts.prompt` to enable the manifest cache (30 min TTL, in-memory). Identical (prompt, query_intent) pairs return cached HTML. The CLI path above wraps this same `renderManifest` function — both paths produce byte-identical output for the same manifest.

## When NOT to use this skill

- A dedicated Tier-3 template already exists for the artifact (e.g. `service-health-card`, `slo-breach-explainer`). Use those — they have hand-tuned visuals.
- The user wants a Markdown-only summary in Claude Code (this skill produces HTML).
- The data is non-tabular, non-temporal, non-event content where none of the seven widgets fit. Describe in plain text instead — and apply the text-only structure rules above.
