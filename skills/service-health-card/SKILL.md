---
name: service-health-card
description: >
  Render the canonical "Service Health Card" artifact — RED metrics (rate, errors,
  duration) with SLO context, recent changes, and dependency status, with a fixed
  layout.
  Trigger phrases: "service health card", "summarize service health", "render service status",
  "service overview", "is service X healthy", or invoked as the final artifact of
  `error-spike-triage` and as a secondary artifact for `latency-regression`.
metadata:
  version: "0.1.0"
---

# Service Health Card (Tier 3 Artifact)

Canonical "is this service OK right now?" view.

## Text-only escape — for trivial yes/no questions

Not every health question deserves the full card. When the user asks a
**simple yes/no** ("is `<svc>` healthy?", "is `<svc>` up?", "anything
wrong with `<svc>`?") and the answer fits in **≤ 100 words** with one
verdict line + one or two supporting numbers, **respond text-only**.

Concretely:

- All RED metrics within ±20 % of baseline AND no SLO in
  Warning/Breach → one sentence:
  *"`<svc>` is healthy as of `<ts>` — error rate 0.3 % (24h baseline 0.3 %),
  p99 175 ms (baseline 180 ms). All `<N>` SLOs in target. No alarms firing."*
- Single signal off-baseline → two sentences: verdict + the one
  number that explains it.

The full Service Health Card artifact is appropriate when:
- The user invoked `/cw-health-check` (fleet view, multiple cards expected).
- An investigation skill (`error-spike-triage`, `latency-regression`,
  `alarm-response`) is producing the canonical artifact for its workflow.
- The user explicitly asked for the artifact ("show me the service
  health card", "render the full health view").
- There are ≥ 5 distinct data points worth surfacing (multiple
  off-baseline metrics, multiple SLOs, recent CloudTrail changes, etc.).

This mirrors hybrid-renderer Gate 4: lookup-shape questions stay text-only.
The card is for investigation outputs, not for casual yes/no checks.

## Rendering — do not author HTML

This skill defines the *grammar* of a Service Health Card, but the artifact
itself is rendered through the `hybrid-renderer` + `widget-catalog` pipeline,
not by hand. Pass the verdict, RED metrics, SLO state, dependency rows, and
recent-changes rows to `hybrid-renderer`; let it pick the manifest, and let
`render-standalone.mjs` produce the HTML. Do not author `<html>` markup
yourself. See top-level `CLAUDE.md` rule 1.

## Context provider

This artifact skill receives its data from parent investigation skills. The following context fields are used in the metadata footer:

- `context.service` -- the Application Signals service name
- `context.region` -- AWS region (rendered in metadata footer)
- `context.account` -- AWS account ID (rendered in metadata footer)
- `context.environment` -- prod / staging / dev
- `context.time_window.start` / `.end` -- time window for baseline comparison

## MCP tool dependencies

None -- this is a rendering skill. Data is collected by the parent investigation skill (`error-spike-triage`, `latency-regression`, `alarm-response`).

## Required inputs

- Service name
- RED metrics (current 5 min):
  - Request rate (req/s)
  - Error rate (%)
  - Latency p50 / p90 / p99 (ms)
- Same metrics 24h ago (baseline)
- SLO state for any SLOs configured on this service
- Top 3 dependencies and their health
- Last 3 CloudTrail changes that touched this service

If SLO state isn't available because no SLOs are configured, render an explicit
"No SLOs configured" note rather than omitting the section.

## Data-source order

Pull RED metrics in this order — fall through to the next source if the
prior one returns no data. The card must show *which* source was used.

1. **Application Signals** (preferred) — `list_services` →
   `get_service_detail` for the matched service. Provides RED with
   normalized error/fault distinction, dependency map, and SLO context in
   one shape.
2. **X-Ray trace summaries** — `query_sampled_traces` /
   `get_trace_summaries` over the same window. Compute error rate from
   `http_status >= 500` plus `error/fault` flags, p99 from `duration_ms`.
   This catches services that route requests but lack ADOT instrumentation
   for App Signals SLIs. Surface the trace-error rate even when App
   Signals data is present — it's a useful cross-check.
3. **Raw CloudWatch namespace metrics** (degraded mode) — when 1 and 2
   return no data. Map service type → namespace and dimension:

   | Service type | Namespace | Dimension |
   |---|---|---|
   | Lambda | `AWS/Lambda` | `FunctionName` |
   | API Gateway HTTP | `AWS/ApiGateway` (v2) | `ApiId`, `Stage` |
   | API Gateway REST | `AWS/ApiGateway` | `ApiName`, `Stage` |
   | ECS service | `AWS/ECS` | `ClusterName`, `ServiceName` |
   | ALB target group | `AWS/ApplicationELB` | `TargetGroup`, `LoadBalancer` |
   | App Runner | `AWS/AppRunner` | `ServiceName` |

   Pull `Invocations`/`RequestCount`, `Errors`/`5XXError`,
   `Duration`/`Latency` (with `Statistic=p99`) for the window. Note in the
   metadata footer: "Falling back to raw CloudWatch — Application Signals
   not available for this service."

Always cross-check Application Signals' error rate with X-Ray's
trace-error rate. A divergence (App Signals shows healthy, X-Ray shows
errors) is meaningful evidence of incomplete instrumentation; surface it
in the verdict reasoning rather than picking one silently.

## Canonical layout

```markdown
## 🟢 Service Health — `<service name>`

**Verdict:** <Healthy | Degraded | Unhealthy>
**Region:** <region> · **Environment:** <env>

### RED metrics
| Metric | Now (5m) | 24h ago | Δ |
|---|---|---|---|
| Request rate | <r>/s | <r>/s | <±%> |
| Error rate | <%> | <%> | <±pp> |
| p50 latency | <ms> | <ms> | <±%> |
| p90 latency | <ms> | <ms> | <±%> |
| p99 latency | <ms> | <ms> | <±%> |

### SLO status
| SLO | Target | Current | Budget remaining | Burn (1h / 6h / 24h) | State |
|---|---|---|---|---|---|
| <slo> | <target>% | <current>% | <budget>% | <1h>× / <6h>× / <24h>× | <Healthy / Warning / Breach> |

> If no SLOs: "No SLOs configured for this service. Recommend: define availability +
> latency SLOs via Application Signals."

Burn rate convention (matches `slo-breach-investigation`): 1.0× = exactly meeting
the budget, 14.4× over 1h depletes a 30-day budget in ~50 minutes. Surface a Warning
state when 1h burn ≥ 14× even if the SLO has not yet breached — the budget will be
exhausted before the breach alarm fires.

### X-Ray cross-check
| Source | Error rate | p99 | Sample count |
|---|---|---|---|
| Application Signals | <%> | <ms> | <n> |
| X-Ray trace summaries | <%> | <ms> | <n> |

> If both sources are within 10% of each other, render this section as a single
> "Sources agree" line. If they disagree by >10% on either column, render the table
> and add a one-liner: "Trace data disagrees with App Signals — likely instrumentation
> gap on `<operation>`. Run `/cw-investigate-errors <service>` to drill in."

### Top dependencies
| Dependency | Calls/min | p99 | Errors |
|---|---|---|---|
| <dep> | <n> | <ms> | <pct>% |

### Recent changes (CloudTrail, last 24h on this service)
| Time | Event | Resource | Principal |
|---|---|---|---|
| <ts> | <event> | <arn> | <user> |

### Open in CloudWatch
- [Service detail](<deep-link>)
- [Service map](<deep-link>)
- [SLO list](<deep-link>)

---
**Source:** `awslabs_cloudwatch-applicationsignals-mcp-server`, `awslabs_cloudtrail-mcp-server`
**Time range:** last 5 min (current) vs same window 24h ago
**MCP tools called:** `<list_services>`, `<get_service>`, `<list_operations>`, `<lookup_events>`
**Confidence:** <Low | Medium | High>
```

## Verdict rules

- **Healthy** — all RED metrics within ±20% of baseline AND no SLO in Warning/Breach
- **Degraded** — any RED metric outside ±20% of baseline OR any SLO in Warning
- **Unhealthy** — error rate >2× baseline OR any SLO in Breach OR p99 >2× baseline

The verdict is derived deterministically from the data — do not stylize it.

## Layout rules

- **Verdict comes first.** 3am scan should read in 2 seconds.
- **24h baseline is the canonical comparison.** Avoid "vs last week" unless explicitly
  asked — week-over-week catches different problems and isn't appropriate as default.
- **Dependencies table caps at 3.** If the service has more, show top 3 by call volume
  and add a deep link to "see all dependencies."
- **Changes table is omitted** if no events; replace with one-liner.

## Empty states and data unavailability

The card must surface missing data, not hide it.

**Empty states (UX11)** — each section has a defined empty state; use them:

- **No SLOs configured** → render the "No SLOs configured for this service.
  Recommend defining availability + latency SLOs via Application Signals."
  empty-line block in the SLO pill row.
- **No dependencies** in the trace window → render `<tr><td colspan="5">No
  downstream dependencies in the trace window.</td></tr>` in the
  dependencies table.
- **No CloudTrail events** in the last 24h → render `<tr><td colspan="4">No
  CloudTrail events in last 24h on this service.</td></tr>` in the recent
  changes table.
- **No baseline available** (service too new) → set the delta classes to
  `neutral` and replace the baseline text with "No 24h baseline — service
  has only `<N>` minutes of history."
- **Wrong region / no permissions** → do not silently render an empty card.
  Surface the AWS error via the `DATA_UNAVAILABLE_BANNER` placeholder and
  abort the card. Recommend running `aws-apm-setup`.

**Data unavailability (UX8)** — populate `DATA_UNAVAILABLE_BANNER` with the
specific error and the impact on confidence. Example:

> Data unavailable — CloudTrail unreachable: AccessDenied. Recent-changes
> table empty for this reason (not because no changes occurred). Confidence
> capped at Medium.

## HTML artifact template

For Cowork (or any surface that renders HTML artifacts), use the artifact template at
`artifacts/service-health-card.html` and populate the `{{PLACEHOLDERS}}` with actual
data. The template encodes the hero verdict + recommended action, RED metric tiles
(with sparkline / gauge), SLO status pills, dependency table, recent-changes table,
action-grouped deep links, suggested commands, and a persistent "Open in CloudWatch"
footer — do not redesign it. The template's leading HTML comment documents the full
typed schema (required + optional fields, empty-state contract, button contract).

Placeholder reference (non-exhaustive):

- `{{SERVICE_NAME}}`, `{{AWS_REGION}}`, `{{ENVIRONMENT}}`, `{{GENERATED_AT}}`
- `{{VERDICT}}` (Healthy / Degraded / Unhealthy) + `{{VERDICT_CLASS}}` (`healthy` /
  `degraded` / `unhealthy`) — derived deterministically per the verdict rules above
- `{{REQUEST_RATE_NOW}}` / `{{REQUEST_RATE_BASELINE}}` / `{{REQUEST_RATE_DELTA}}` /
  `{{REQUEST_RATE_DELTA_CLASS}}` (`up-bad` / `up-good` / `down-bad` / `down-good` /
  `neutral`) — sparkline polyline as `{{REQUEST_RATE_SPARKLINE}}`, formatted
  `x1,y1 x2,y2 ...` over a 100×30 viewBox
- `{{ERROR_RATE_NOW}}` / `{{ERROR_RATE_BASELINE}}` / `{{ERROR_RATE_DELTA}}` /
  `{{ERROR_RATE_DELTA_CLASS}}` and gauge: `{{ERROR_GAUGE_PCT}}` (0–100) +
  `{{ERROR_GAUGE_CLASS}}` (`healthy` / `degraded` / `unhealthy`)
- `{{P99_NOW}}`, `{{P50_NOW}}`, `{{P90_NOW}}`, `{{P99_BASELINE}}`, `{{P99_DELTA}}`,
  `{{P99_DELTA_CLASS}}`, `{{P99_SPARKLINE}}`
- `{{SLO_PILLS_OR_EMPTY}}` — emit one `<div class="slo-pill healthy|warning|breach">…</div>`
  per SLO, or the "No SLOs configured" empty-line block
- `{{DEPENDENCY_ROWS}}` — top 3 with `<span class="dep-status healthy|warning|breach">…</span>`
- `{{RECENT_CHANGES_ROWS_OR_NONE}}` — rows, or `<tr><td colspan="4">No CloudTrail events
  in last 24h.</td></tr>`
- Deep-link placeholders: `{{LINK_SERVICE_DETAIL}}`, `{{LINK_SERVICE_MAP}}`,
  `{{LINK_SLO_LIST}}` — generated via `open-in-cloudwatch`
- Hero placeholders: `{{SEVERITY_ICON}}`, `{{HERO_VERDICT_LINE}}`,
  `{{HERO_TOP_OBSERVATION}}`, `{{HERO_CONFIDENCE}}`, `{{HERO_CONFIDENCE_CLASS}}`,
  `{{HERO_NEXT_ACTION}}` — populate from the verdict rules above. The hero is
  the 2-second read; the rest of the card is progressive disclosure.
- `{{DATA_UNAVAILABLE_BANNER}}` — emit a `<div class="data-unavailable">…</div>`
  block when one or more sources failed; otherwise emit the empty string.
- `{{CMD_SUGGESTIONS}}` — emit verdict-driven `<div class="cmd-suggestion">`
  blocks. Healthy → `/cw-verify-recovery <service>`; Degraded →
  `/cw-investigate-latency <service>`; Unhealthy → `/cw-investigate-slo
  <service>` and/or `/cw-investigate-errors <service>`.
- `{{SAVE_ARTIFACT_BUTTON}}`, `{{SHARE_BUTTON}}` — short labels. The buttons
  render visually but the click handler is host-provided. In Cowork, future
  hooks pin / share. In Claude Code, they are inert (the file is on disk;
  user copies the path manually). See the template's leading comment for
  the full UX10 contract.
- `{{LINK_*}}` deep-link placeholders — generated via `open-in-cloudwatch`
  and grouped into "Verify · Investigate" vs "Act · Configure · Share"
  blocks (UX5). The persistent footer at the bottom of the page repeats
  the highest-value links so they are always within reach (UX12).
- Footer: `{{SOURCE_MCP_SERVERS}}`, `{{MCP_TOOLS_LIST}}`, `{{CONFIDENCE}}`,
  `{{VALIDATION_RESULT}}` (Pass / Fail summary from
  `investigation-validator`).

In **Claude Code** (terminal), use the Markdown form above. Both must contain identical
data — only the rendering differs.
