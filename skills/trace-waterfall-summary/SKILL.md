---
name: trace-waterfall-summary
description: >
  Render the canonical "Trace Waterfall Summary" artifact — top slow spans by
  self-time, dependency contribution to total duration, span-to-code mapping where
  Application Signals provides it, and a Mermaid waterfall.
  Trigger phrases: "trace waterfall", "render trace summary", "summarize this trace",
  "explain this slow trace", "trace breakdown", or invoked as the final artifact of
  `latency-regression` and `slo-breach-investigation`.
metadata:
  version: "0.1.0"
---

# Trace Waterfall Summary (Tier 3 Artifact)

Canonical view of a single slow trace, optimized for "where did the time go?"

## Context provider

This artifact skill receives its data from parent investigation skills. The following context fields are used in the metadata footer:

- `context.service` -- the Application Signals service name
- `context.region` -- AWS region (rendered in metadata footer)
- `context.account` -- AWS account ID (rendered in metadata footer)
- `context.time_window.start` / `.end` -- trace retrieval window

## MCP tool dependencies

None -- this is a rendering skill. Trace data is collected by the parent investigation skill (`latency-regression`, `slo-breach-investigation`).

## Required inputs

- Trace ID
- Total duration (ms)
- All spans with: name, service, self-time (ms), total time (ms), parent
- Optional: exception class + message per span
- Optional: span-to-code annotation (`class.method` from Application Signals)

If only a subset of spans is available, render with what you have and call it out
in the metadata footer's `confidence`.

## Canonical layout

```markdown
## ⏱️ Trace Waterfall Summary — `<short trace ID>`

**Total duration:** <ms>ms · **Status:** <ok | error>
**Entry:** `<service>.<operation>` · **Time:** <ISO ts>

### Where the time went
| Rank | Span | Service | Self-time | % of total | Code |
|---|---|---|---|---|---|
| 1 | <span name> | <service> | <ms>ms | <pct>% | `<class.method>` |
| 2 | <span name> | <service> | <ms>ms | <pct>% | `<class.method>` |
| 3 | <span name> | <service> | <ms>ms | <pct>% | `<class.method>` |

### Dependency contribution
| Dependency | Calls | Total time | % of trace |
|---|---|---|---|
| <db / api / queue> | <n> | <ms>ms | <pct>% |
| <db / api / queue> | <n> | <ms>ms | <pct>% |

### Waterfall
```mermaid
gantt
  title Trace <short ID>
  dateFormat X
  axisFormat %S.%L
  section <service A>
  <op A> :a, 0, <ms>
  section <service B>
  <op B (downstream)> :b, after a, <ms>
  ...
```

### Errors (if any)
| Span | Exception | Message |
|---|---|---|
| <span> | <class> | <message> |

### Open in CloudWatch
- [Full trace](<deep-link>)
- [Service map at trace time](<deep-link>)
- [Logs for this requestId](<deep-link>)

---
**Source:** `awslabs_cloudwatch-applicationsignals-mcp-server`
**Trace time:** `<ts>`
**MCP tools called:** `<get_trace>`, `<list_traces>`
**Spans captured:** <captured>/<total> (<pct>%)
**Confidence in attribution:** <Low | Medium | High>
```

## Visual grammar rules

- **Self-time, not total time, drives the rank.** Total time double-counts children.
- **Top 3 spans only.** More than 3 is noise — link to the full trace instead.
- **Dependency contribution is computed**, not pulled — sum self-time per service tier.
- **Mermaid waterfall** in Markdown form. For HTML artifact (Cowork), an SVG waterfall
  with hover-to-reveal exception is preferred.
- **Code column** is empty when Application Signals doesn't provide span-to-code (e.g.
  manual instrumentation, unsupported runtime). Do not fabricate.

## HTML artifact template

For Cowork (or any surface that renders HTML artifacts), use the artifact template at
`artifacts/trace-waterfall.html` and populate the `{{PLACEHOLDERS}}` with actual data.
The template renders an SVG-free CSS waterfall with service-colored span bars,
self-time annotations, error highlighting, and a critical-path mark — do not redesign it
per trace.

Placeholder reference (non-exhaustive — open the file for the full list):

- `{{TRACE_ID_SHORT}}`, `{{ENTRY_SERVICE}}`, `{{ENTRY_OPERATION}}`, `{{TRACE_TIMESTAMP}}`,
  `{{AWS_REGION}}`
- `{{TOTAL_DURATION_MS}}`, `{{TRACE_STATUS}}` (`ok` or `error`),
  `{{STATUS_PILL_CLASS}}` (`ok` / `error`)
- `{{SPANS_CAPTURED}}`, `{{SPANS_TOTAL}}`, `{{SPANS_CAPTURED_PCT}}`, `{{CRITICAL_PATH_PCT}}`
- `{{SERVICE_LEGEND_1..4}}` — service name → `svc-N` color
- `{{WATERFALL_SPAN_ROWS}}` — emit two grid cells per span. Set:
  - `depth-N` class on `.span-meta` to indent by call depth (0–4)
  - `svc-N` class on `.span-bar` to color-match the service in the legend
  - inline `left: <START_PCT>%; width: <WIDTH_PCT>%` on `.span-bar`
  - inline `left: <SELF_OFFSET_PCT>%; width: <SELF_WIDTH_PCT>%` on `.self-time` overlay
  - add `.error` class to error spans, `.critical` to spans on the critical path
- `{{TOP_SPANS_ROWS}}` — top-3 by self-time, with `<code>class.method</code>` in the
  Code column when Application Signals provides span-to-code, empty otherwise
- `{{DEPENDENCY_ROWS}}` — sum self-time per service tier (db / api / queue)
- `{{ERROR_ROWS_OR_NONE}}` — `<tr><td>span</td><td>class</td><td>msg</td></tr>` rows,
  or one `<tr><td colspan="3">No errors in this trace.</td></tr>`
- Deep-link placeholders: `{{LINK_FULL_TRACE}}`, `{{LINK_SERVICE_MAP}}`,
  `{{LINK_LOGS_FOR_REQUEST}}` — generated via `open-in-cloudwatch`
- Hero placeholders: `{{SEVERITY_ICON}}`, `{{HERO_VERDICT_LINE}}`,
  `{{HERO_TIME_HOG}}`, `{{HERO_CONFIDENCE}}`, `{{HERO_CONFIDENCE_CLASS}}`,
  `{{HERO_NEXT_ACTION}}` — populate from "where the time went" + status.
- `{{DATA_UNAVAILABLE_BANNER}}` — emit when only a subset of spans was
  retrieved or X-Ray sampled out; otherwise empty string. Cap attribution
  confidence at Medium when the banner is present.
- `{{CMD_SUGGESTIONS}}` — verdict-driven follow-on commands: e.g.
  `/cw-investigate-latency <entry-service>` for slow traces,
  `/cw-investigate-errors <entry-service>` for status=error traces.
- `{{SAVE_ARTIFACT_BUTTON}}`, `{{SHARE_BUTTON}}` — short labels. Same UX10
  contract as the other artifacts (Cowork pin/share host APIs; Claude Code
  inert because the file is on disk).
- Deep-link placeholders are grouped into "Verify · Investigate" vs
  "Act · Configure · Share" (UX5). The persistent footer at the bottom of
  the page repeats the highest-value links (UX12).
- Empty states (UX11): no errors → "No errors in this trace.";
  single-service trace → "All time spent in `<entry-service>`."; partial
  spans → set the data-unavailable banner.
- Footer: `{{SOURCE_MCP_SERVERS}}`, `{{MCP_TOOLS_LIST}}`,
  `{{ATTRIBUTION_CONFIDENCE}}`, `{{VALIDATION_RESULT}}` (Pass / Fail
  summary from `investigation-validator`).

In **Claude Code** (terminal), use the Markdown / Mermaid form above. The HTML template
is for surfaces that can render it.

## What this is NOT

- Not a flame graph — a flame graph is denser and harder to scan in 3am light.
- Not an attempt to render every span. Three spans + a dependency table covers >90% of
  "where did the time go?" cases.
