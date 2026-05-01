# Widget & Template Gap Analysis

**Date:** 2026-04-30
**Purpose:** Identify which widgets and templates are missing in the AWS APM plugin, grounded in the actual MCP tool surface and the actual investigation workflows. Companion to [`cloudscape-widget-audit.md`](../cloudscape-widget-audit.md) (broader competitive scan) and [`top-10-widgets.md`](../top-10-widgets.md) (widget-only roadmap).

---

## How "missing" was decided

Three independent lenses, then cross-referenced:

| Lens | Question | Source |
|---|---|---|
| **MCP tool surface** | For each tool response shape, can we render it well? | [`MCP-TOOL-CONTRACTS.md`](../MCP-TOOL-CONTRACTS.md), `.mcp.json` |
| **Skill output** | For each skill that emits structured output, is there a widget / template that fits? | `skills/*/SKILL.md` |
| **Command workflow** | For each user-facing command, does its final artifact have a home? | `commands/*.md`, `artifacts/*.html` |

A gap is real when **at least two lenses** agree. Single-lens "gaps" are usually nice-to-have visualizations that no current tool or workflow actually drives.

---

## TL;DR — the four gaps that matter most

| # | Gap | Type | What it blocks today |
|---|---|---|---|
| 1 | **Line chart** widget | Widget | Every `get_metric_data` response with > 1 series. Today we either inline a sparkline or fall back to a table. |
| 2 | **Topology / service map** widget | Widget | All `list_services` + `list_service_dependencies` output. "Show me my app topology" returns prose. |
| 3 | **`slo-compliance-report.html`** | Template | `/cw-slo-report` output is a fixed-shape portfolio scorecard with no HTML home — markdown-only. |
| 4 | **`service-fleet-dashboard.html`** | Template | `/cw-health-check` cannot scale past ~6 services; cards stack unreadably in chat. |

These four are P0 because each one prevents an existing command from producing the artifact its skill is *already designed to emit*. Everything else is enhancement.

---

## Part 1 — Widget gaps, grounded in the MCP tool surface

For each MCP tool response shape, what's the best widget today, and what's missing?

| MCP tool | Response shape | Best widget today | Gap | Priority |
|---|---|---|---|---|
| `get_metric_data` (single series, ≤ 200 pts) | `{timestamps[], values[]}` | `sparkline` | None — covered | — |
| `get_metric_data` (single series, > 200 pts) | same | `sparkline` (truncates) | **Line chart with axes** | P0 |
| `get_metric_data` (multi-series) | per-query `{timestamps[], values[]}` | None — falls back to `table` | **Line chart** (multi-series, legend, threshold lines) | P0 |
| `get_metric_data` + `ANOMALY_DETECTION_BAND` | series + upper/lower bounds | None | **Anomaly band** (line chart overlay) | P1 |
| `get_metric_data` (stacked composition: e.g. errors-by-type) | multiple series summing to a total | None — table | **Stacked area chart** | P1 |
| `get_metric_data` (categorical aggregate) | one value per dimension | None — table | **Bar chart** | P1 |
| `describe_alarms` (multi-alarm) | array of `{name, state, threshold, dimensions}` | None — table | **Alarm status grid** (color-coded tiles) | P1 |
| `describe_alarms` (single alarm detail) | one alarm with full config | None — table | **Key-value detail panel** | P1 |
| `get_dashboard` (CloudWatch dashboard body) | JSON of widgets[] (metric, text, log, alarm) | None | Dedicated dashboard-mirror widget OR fan-out into multiple existing widgets | P2 |
| `start_query` / `get_query_results` (Logs Insights, raw rows) | array of `[{field, value}]` | `log_viewer` (text only) | None for raw rows; **bar/line/pie** needed when query is `stats by ... | bin()` | P1 |
| `get_trace_summaries` | array of trace summaries | None — table | **Trace summary table** with status/duration sparklines (specialized table preset) | P2 |
| `batch_get_traces` (single trace) | full segments + subsegments | `trace_waterfall` | None — covered | — |
| `batch_get_traces` (response-time distribution across many traces) | derived percentile distribution | None | **Histogram / distribution chart** | P2 |
| `lookup_events` (CloudTrail) | array of audit events | `change_event_list` + `timeline` | None — covered | — |
| `list_services` (Application Signals) | array of services | None — table | **Service list cards** (covered indirectly by service-health-card today) | P2 |
| `list_services` + `list_service_dependencies` (graph) | adjacency list | None — prose | **Topology / service map** widget | P0 |
| `get_slo` (single SLO) | `{attainment, error_budget, burn_rate}` | `stat_card` | **SLO status card** (specialized stat_card with budget/burn) | P1 |
| `get_slo` (many SLOs across services) | array of SLO summaries | None — table | **SLO scorecard table** preset | P1 |
| `get_top_contributors` (operations contributing to a breach) | array with `{operation, contribution_pct, sample_trace_ids[]}` | None — table | **Contributor breakdown** (mini bar chart inline with table) | P1 |
| `put_metric_alarm` (write action preview) | form fields + CLI snippet | `action_form` (in worktree, pending merge) | None once merged — already covered | — |
| `tag_resource` (write action preview) | tag diff | `action_form` | None — covered | — |
| `search_documentation` | search results | None — text | **Citation list** (lightweight, but rare) | P3 |

### Why these widget gaps matter

- **Line chart (P0)** — `get_metric_data` is the most-called MCP tool. Every investigation skill (`error-spike-triage`, `latency-regression`, `slo-breach-investigation`) pulls multi-series metric data and currently has nowhere good to render it. The `sparkline` widget caps at 200 points and has no axes; for any analysis longer than ~3h at 1m resolution, it loses fidelity. This is a daily friction point, not a polish item.
- **Topology map (P0)** — Application Signals' service map is the canonical answer to "what's my system shaped like?" The plugin already calls `list_services`; without a graph widget it can only describe the topology in prose. CloudWatch console, Datadog, New Relic, Grafana all have this — its absence is the most-noticed gap by users coming from another tool.
- **Alarm status grid (P1)** — `describe_alarms` is one of the simplest tools to call but the hardest to render well. A grid of status tiles is the standard CloudWatch dashboard answer to "what's on fire right now?" Today the plugin returns a table that buries the state column.
- **Anomaly band (P1)** — Once line chart exists, this is a small overlay that turns "is this spike abnormal?" from a judgment call into a visual answer. Differentiator vs. raw CloudWatch.
- **Key-value detail panel (P1)** — Every detail view (alarm config, trace metadata, service properties) currently inlines key/value into ad-hoc HTML inside other widgets. Cloudscape has a primitive for this; we're paying complexity tax for not having one.
- **Histogram / distribution (P2)** — Critical when investigating tail-latency regressions; CloudWatch and X-Ray both expose response-time histograms. Today we summarize percentiles into a stat_card and lose the shape.

The remaining widget gaps catalogued in [`cloudscape-widget-audit.md`](../cloudscape-widget-audit.md) (heatmap, scatter, treemap, gauge, pie, RUM-specific, container map, internet health map) are real but lower priority because **no current MCP tool returns data that obviously demands them in our workflows.** Add them when the underlying MCP servers expose Container Insights / RUM / Internet Monitor APIs and we wire skills to them.

---

## Part 2 — Template gaps, grounded in command workflows

There are 14 commands and 8 templates. The mapping:

| Command | Final artifact spec (per skill) | Template exists? |
|---|---|---|
| `cw-alarm-response` | service-health-card + top-suspected-cause + investigation-summary | ✅ all three |
| `cw-alert-design` | alerting-plan | ✅ |
| `cw-create-alarm` | action_form widget | ❌ widget itself is pending merge; no dedicated template |
| `cw-dashboard` | per-widget interpretation table + verdict | ❌ no template; markdown only |
| `cw-doctor` | 9-row check table + ready/partial/not-ready verdict | ❌ no template |
| `cw-health-check` | many service-health-cards grouped by health tier + fleet summary | ⚠️ single-card template only; no fleet shell |
| `cw-investigate-errors` | service-health-card + top-suspected-cause + investigation-summary | ✅ all three |
| `cw-investigate-latency` | trace-waterfall + service-health-card + top-suspected-cause | ✅ all three |
| `cw-investigate-slo` | slo-breach-explainer + investigation-summary | ✅ both |
| `cw-obs-gaps` | observability-gap-report | ✅ |
| `cw-set-context` | profile/region tables + diff confirmation | ❌ no template; chat-only |
| `cw-slo-report` | portfolio scorecard with risk-ranked tables and recommendations | ❌ no template |
| `cw-trail-view` | cloudtrail-timeline | ✅ |
| `cw-verify-recovery` | 5-check verdict table | ❌ no template |

### The seven missing templates, in priority order

| # | Template | Drives | Why it can't be the hybrid manifest | Priority |
|---|---|---|---|---|
| 1 | `slo-compliance-report.html` | `/cw-slo-report` | The skill already prescribes a *fixed-shape* dashboard (headline tiles, top-at-risk ranked table with sortable burn-rate columns, recently-recovered table). Every weekly/monthly run should look identical so leadership can compare across weeks — that's exactly what a template guarantees and what a manifest can't. | **P0** |
| 2 | `service-fleet-dashboard.html` | `/cw-health-check` | Healthy services should collapse to a compact one-line table; degraded/unhealthy get full cards. That layout decision is structural, not data-driven — has to live in a template. Without it the command can't render more than ~6 services without becoming an unreadable wall of cards. | **P0** |
| 3 | `recovery-verification.html` | `/cw-verify-recovery` | The on-call needs an unambiguous, archivable artifact at incident close ("can I go to bed?"). Five fixed checks with status icons + a clear Recovered/Partial/Not-recovered banner is the kind of thing that has to look the same every time. Manifest output drifts. | **P0** |
| 4 | `create-alarm-form.html` | `/cw-create-alarm` | Hosts the (still-pending) `action_form` widget, plus the CLI snippet, threshold-provenance footer, and Tier-3/Tier-4 safety block. Unblocks the command independently of the widget catalog work. | **P1** |
| 5 | `dashboard-narrative.html` | `/cw-dashboard` | Per-widget "Now / 24h ago / Δ / Status" mini-table is repetitive structure ideal for a template. A free-text narrative loses side-by-side comparability. | **P1** |
| 6 | `plugin-doctor.html` | `/cw-doctor` (and `aws-apm-setup`) | Diagnostic output gets screenshotted and shared when filing setup bugs; needs consistent shape. Template can host both the doctor's check table and the setup skill's first-run output. | **P1** |
| 7 | `aws-context-selector.html` | `/cw-set-context` | Mostly interactive (chat ask + confirm); only the `.mcp.json` diff really benefits from HTML. Could plausibly live in the hybrid manifest with a generic diff widget. | **P2** |

### Pattern: aggregation templates

All three P0 template gaps share a structural property — they are **aggregations** over multiple entities (a portfolio of SLOs, a fleet of services, a multi-check verdict). The existing templates are all single-entity (one trace, one service, one breach, one alarm plan). The plugin has no aggregate-shell templates. Building one of the P0s well will likely produce reusable patterns for the other two.

---

## Part 3 — What other APM tools render that this plugin can't

This list is filtered to views that have a clear AWS data source (so a future skill could drive them). See [`cloudscape-widget-audit.md`](../cloudscape-widget-audit.md) for the broader catalog.

| View | Where it shows up | AWS data source available? | Can plugin render today? |
|---|---|---|---|
| Service map / topology | CW console, Datadog, NR, Grafana | Yes (X-Ray `GetServiceGraph`, App Signals dependencies) | ❌ — no widget |
| Multi-series time-series chart | Universal | Yes (`get_metric_data`) | ❌ — sparkline only |
| Alarm status grid | CW console | Yes (`describe_alarms`) | ❌ — table only |
| Response-time histogram / distribution | X-Ray, Datadog, NR | Yes (X-Ray `ResponseTimeHistogram`) | ❌ |
| SLO portfolio dashboard | App Signals, Datadog SLO list | Yes (`list_slos`, `get_slo`) | ⚠️ skill exists, no template |
| Anomaly detection band overlay | CW console | Yes (`ANOMALY_DETECTION_BAND`) | ❌ |
| Top-contributors breakdown | App Signals, CW Contributor Insights | Yes (`get_top_contributors`) | ❌ — table only |
| Container map (EKS/ECS) | CW Container Insights, Datadog, Grafana | Yes (Container Insights perf logs) | ❌ — no MCP tool surface for it yet |
| RUM session waterfall | RUM, Datadog RUM, NR Browser | Yes (RUM API) | ❌ — no MCP tool surface yet |
| Synthetics canary dashboard | CW Synthetics | Yes (Synthetics API) | ❌ — no MCP tool surface yet |
| Geo / internet health map | Internet Monitor, Datadog | Yes (Internet Monitor API) | ❌ — no MCP tool surface yet |
| Profile flame graph | Datadog Profiling, NR | Indirect (CodeGuru Profiler) | ❌ — no MCP tool surface yet |

The bottom four are widget gaps **gated by missing MCP tools**, not by the renderer. Adding those widgets without first wiring the MCP servers would produce empty visuals.

---

## Part 4 — Prioritized recommendations

### P0 (do first — unblocks existing commands)

| Item | Type | Effort | Unblocks |
|---|---|---|---|
| Line chart widget | Widget | M | All `get_metric_data` multi-series rendering across every investigation skill |
| Topology map widget | Widget | L | Application Signals service-map queries |
| `slo-compliance-report.html` | Template | M | `/cw-slo-report` |
| `service-fleet-dashboard.html` | Template | M | `/cw-health-check` at scale |
| `recovery-verification.html` | Template | S | `/cw-verify-recovery` |

### P1 (do second — completes the picture)

| Item | Type | Effort | Why |
|---|---|---|---|
| Alarm status grid widget | Widget | S | Standard CW dashboard answer to "what's on fire" |
| Stacked area chart widget | Widget | M | Errors-by-type, traffic composition; reuses line-chart axis logic |
| Bar chart widget | Widget | M | Categorical comparisons, Logs Insights `stats by` results |
| Key-value detail panel widget | Widget | S | Generic detail view; replaces ad-hoc HTML inside other widgets |
| Anomaly detection band overlay | Widget | M | Differentiator; sits on top of line chart |
| SLO status card widget | Widget | S | First-class App Signals object today rendered as a generic stat_card |
| `create-alarm-form.html` | Template | S | Unblocks `/cw-create-alarm` |
| `dashboard-narrative.html` | Template | S | Structures `/cw-dashboard` output |
| `plugin-doctor.html` | Template | S | Sharable diagnostic for `/cw-doctor` and `aws-apm-setup` |

### P2 (nice to have)

| Item | Type | Effort | Why |
|---|---|---|---|
| Histogram / distribution widget | Widget | M | Tail-latency analysis; X-Ray data is available |
| Trace-summary table preset | Widget | S | Specialized `table` configuration for `get_trace_summaries` |
| Contributor breakdown widget | Widget | S | Inline mini-bar within a table row for `get_top_contributors` |
| Pie / donut chart widget | Widget | S | Distribution breakdowns; Logs Insights GROUP BY |
| Gauge widget | Widget | S | Utilization metrics (CPU, memory, disk) |
| `aws-context-selector.html` | Template | S | Marginal — chat flow already works |

### P3 (gated on missing MCP tool surface)

Container map, RUM session waterfall, synthetics dashboard, geo / internet health map, profile flame graph. **Do not build the widgets first** — wire the MCP servers first so the widgets have data to render.

---

## How to keep this analysis current

Two simple drift checks to run when adding things:

1. **New MCP tool added?** — list its response shape against the table in Part 1. If no widget fits, that's a candidate gap.
2. **New skill added?** — does it produce a fixed-shape output? If yes, list it against the table in Part 2. If the skill specifies a "Phase N: render" with a particular structure but no template exists, that's a template gap.

A skill that produces structured output without a dedicated template will always work (markdown twin renders fine in chat) but loses the visual grammar guarantees that templates provide for shareable / archived artifacts.

---

## Related

- [`cloudscape-widget-audit.md`](../cloudscape-widget-audit.md) — broader competitive scan covering ~51 visualization types across CW console, Cloudscape, Datadog, New Relic
- [`top-10-widgets.md`](../top-10-widgets.md) — widget-only roadmap with data structures and complexity estimates for each candidate
- [`MCP-TOOL-CONTRACTS.md`](../MCP-TOOL-CONTRACTS.md) — the data shapes every widget / template ultimately consumes
- [`schemas/manifest.schema.json`](../schemas/manifest.schema.json) — current widget catalog (8 types)
- [`skills/widget-catalog/SKILL.md`](../skills/widget-catalog/SKILL.md) — runtime catalog of widgets and templates the LLM picks from
