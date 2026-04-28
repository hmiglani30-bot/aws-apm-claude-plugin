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
**Source:** `awslabs.cloudwatch-applicationsignals-mcp-server`
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

## What this is NOT

- Not a flame graph — a flame graph is denser and harder to scan in 3am light.
- Not an attempt to render every span. Three spans + a dependency table covers >90% of
  "where did the time go?" cases.
