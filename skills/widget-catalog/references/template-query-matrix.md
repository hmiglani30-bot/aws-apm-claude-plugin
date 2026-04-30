# Template-Query Matrix

Maps user queries and command invocations to the correct template and widget
combination. Use this as a lookup table when deciding how to render a response.

---

## Quick Reference: Command Defaults

| # | Command | Template | Widgets |
|---|---|---|---|
| 1 | `/cw-health-check` | Renderer Dashboard / `grid` per service | stat_cards (per-service RED) + table (healthy fleet) |
| 2 | `/cw-investigate-errors` | Renderer Investigation | stat_cards (error rate, p99) + table (top ops) + timeline (incident) + change_event_list |
| 3 | `/cw-investigate-latency` | Renderer Focus or Investigation | stat_card (p99) + trace_waterfall (worst trace) OR stat_cards + table + chart |
| 4 | `/cw-investigate-slo` | Renderer Investigation | stat_cards (attainment, burn, budget) + table (contributors) + timeline (breach events) |
| 5 | `/cw-slo-report` | Renderer Dashboard | stat_cards (in breach, burning, healthy, avg budget) + change_event_list (burns + config) |
| 6 | `/cw-alarm-response` | Renderer Investigation | stat_cards (metric value, threshold) + table (alarm detail) + timeline (transitions) + change_event_list |
| 7 | `/cw-alert-design` | `stacked` | table (coverage matrix) + table (gap analysis) + table (recommendations) |
| 8 | `/cw-verify-recovery` | `grid` | stat_cards (5 checks) + table (detailed results) |
| 9 | `/cw-trail-view` (timeline) | Renderer Investigation | stat_card (total events) + timeline + table (full list) + change_event_list |
| 10 | `/cw-trail-view` (audit) | Renderer Investigation | stat_cards (principals, writes) + table (by principal) + table (per-event) |
| 11 | `/cw-trail-view` (summary) | Renderer Dashboard | stat_cards (total, writes, principals, errors) + sparkline + change_event_list |
| 12 | `/cw-doctor` | `grid` | stat_cards (9 checks) + table (detail) |

---

## Full Query-to-Template Mapping (25 Examples)

### Error Investigation Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 1 | "checkout-api 5xx rate jumped, what's going on?" | Renderer Investigation | stat_card (error rate, p99) + table (top failing ops) + timeline (incident events) + change_event_list (recent deploys) | `error-spike-triage` |
| 2 | "why is the payment service throwing 500 errors?" | Renderer Investigation | stat_card (error rate) + table (exception classes) + log_viewer (error samples) + change_event_list | `error-spike-triage` |
| 3 | "got paged for HighCheckoutErrorRate alarm" | Renderer Investigation | stat_card (alarm metric value, threshold delta) + table (alarm details) + timeline (alarm transitions) + change_event_list | `alarm-response-triage` |
| 4 | "triage this error spike in auth-service" | Renderer Investigation | stat_card (error rate, request rate) + table (top ops) + timeline + change_event_list | `error-spike-triage` |

### Latency Investigation Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 5 | "POST /checkout p99 is 800ms, normally 200ms" | Renderer Investigation | stat_card (p99 current vs baseline) + chart (p99 over time) + table (slow ops) + trace_waterfall (worst trace) | `latency-regression-investigation` |
| 6 | "open trace 1-66348f12 -- why was this slow?" | Renderer Focus | stat_card (total duration vs baseline) + trace_waterfall | `latency-regression-trace` |
| 7 | "which operation is causing the latency regression?" | Renderer Investigation | stat_cards (p99, p50) + table (ops ranked by p99 delta) + chart (latency over time) | `latency-regression-investigation` |

### SLO Investigation Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 8 | "checkout-availability SLO is breaching, investigate" | Renderer Investigation | stat_cards (attainment, burn rate, budget remaining) + table (top contributors) + timeline (breach milestones) | `slo-breach-investigation` |
| 9 | "which SLOs are burning fast right now?" | Renderer Dashboard | stat_cards (in breach, burning fast, healthy) + table (all SLOs ranked by burn) | `slo-burn-scan` |
| 10 | "weekly SLO compliance report" | Renderer Dashboard | stat_cards (in breach, burning, healthy, avg budget) + change_event_list (largest burns, config changes) | `slo-compliance-report` |

### Overview / Dashboard Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 11 | "how are all my services doing?" | Renderer Dashboard / `grid` | stat_cards (unhealthy count, degraded count, healthy count) + table (service fleet with verdict) | `fleet-health-overview` |
| 12 | "service health dashboard for checkout" | `grid` | stat_cards (request rate, error rate, p99) + table (ops breakdown) | `service-health-dashboard` |
| 13 | "give me an overview of prod us-east-1" | Renderer Dashboard | stat_cards (services, alarms firing, SLOs in breach) + table (service list with health) | `fleet-health-overview` |
| 14 | "summarize today's CloudTrail activity" | Renderer Dashboard | stat_cards (total events, writes, principals, errors) + sparkline (activity over time) + change_event_list | `trail-summary-dashboard` |

### Comparison Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 15 | "compare checkout error rates before and after the deploy" | `stacked` or Renderer Investigation | chart (two-series: pre-deploy vs post-deploy) + stat_cards (before/after deltas) | `before-after-comparison` |
| 16 | "how does checkout compare to payment service p99?" | `grid` | stat_cards (checkout p99, payment p99) + chart (both series on one chart) | `service-comparison` |

### Audit / CloudTrail Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 17 | "who made changes to S3 buckets in the last 24h?" | Renderer Investigation | stat_cards (distinct principals, write count) + table (by principal) + table (per-event detail) | `trail-audit-investigation` |
| 18 | "show me recent API calls in the last hour" | Renderer Investigation | stat_card (total events) + timeline (notable events) + table (full event list) + change_event_list | `trail-activity-timeline` |
| 19 | "any IAM changes in the last 7 days?" | Renderer Investigation | stat_card (IAM event count) + table (IAM events with principal, action, resource) + change_event_list (iam kind) | `trail-audit-investigation` |

### Recovery / Verification Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 20 | "did the rollback fix checkout-service?" | `grid` | stat_cards (5 recovery checks) + table (check details) | `recovery-verification` |
| 21 | "is checkout-service recovered after the deploy rollback at 14:18?" | `grid` | stat_cards (SLO burn, p99, error rate, traces, alarms) + table (per-check detail) | `recovery-verification` |

### Write Action Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 22 | "create the alarm that alerting-design recommended" | `investigation_with_actions` | table (recommendation summary, diagnostic slot) + action_form (create_metric_alarm, actions slot) | `alarm-creation` |
| 23 | "apply these alarms to checkout-service" | `investigation_with_actions` | table (coverage matrix, diagnostic slot) + action_form (per alarm, actions slot, max 2) | `alarm-creation` |
| 24 | "tag this alarm with service=checkout" | `single` | action_form (tag_resource) | `resource-tagging` |

### Setup / Diagnostics Queries

| # | Example Query | Template | Widgets | `query_intent` |
|---|---|---|---|---|
| 25 | "is the plugin working? run diagnostics" | `grid` | stat_cards (9 doctor checks) + table (check details + remediation) | `plugin-diagnostics` |

---

## Decision Tree: Choosing Between Similar Templates

### Investigation vs. Dashboard

| Signal | Choose Investigation | Choose Dashboard |
|---|---|---|
| Active incident / triage | Yes | No |
| Mixed-density widgets (stat_card + table + timeline) | Yes | No |
| All low-density widgets (stat_cards + sparklines only) | No | Yes |
| >4 stat_cards with no table/chart | No | Yes |
| User wants to "scan" or get "overview" | No | Yes |
| User wants to "investigate" or "triage" | Yes | No |

### `grid` vs. Renderer Dashboard Shell

| Signal | Choose `grid` (explicit) | Choose Renderer Dashboard |
|---|---|---|
| Fixed layout: cards row + one primary widget | Yes | No |
| Variable number of low-density widgets | No | Yes |
| You know the exact slot assignments | Yes | No |
| The hybrid-renderer should auto-layout | No | Yes |

### `stacked` vs. Investigation Shell

| Signal | Choose `stacked` (explicit) | Choose Investigation |
|---|---|---|
| Exactly 2-3 widgets, order matters | Yes | No |
| 4+ widgets of mixed density | No | Yes |
| Simple output (table + table, or chart + table) | Yes | No |
| Complex investigation with stat_cards + table + timeline | No | Yes |

### `single` vs. Other Templates

| Signal | Choose `single` |
|---|---|
| One widget answers the entire query | Yes |
| User asked for a specific trace (one waterfall) | Yes |
| Standalone action form (tag, quick alarm) | Yes |
| User asked "show me the table of alarms" (one table) | Yes |

### `investigation_with_actions` vs. Other Templates

| Signal | Choose `investigation_with_actions` |
|---|---|
| Diagnostic output + user asked to execute a write action | Yes |
| Any `action_form` widget needs to coexist with read-only widgets | Yes |
| Pure read-only output, no write actions | No -- use Investigation or grid |
| Standalone write action with no diagnostic context | No -- use `single` |

---

## Widget Count Guidelines by Query Type

| Query type | Recommended widget count | Widget mix |
|---|---|---|
| Single metric lookup | 1-2 | stat_card, maybe sparkline |
| Single trace inspection | 2 | stat_card + trace_waterfall |
| Error triage | 4-5 | 2 stat_cards + table + timeline + change_event_list |
| Latency investigation | 4-6 | 2 stat_cards + chart + table + trace_waterfall (optional) |
| SLO breach investigation | 4-5 | 3 stat_cards + table + timeline |
| Fleet health check | 3-6 | 3 stat_cards + table (healthy) + per-service cards |
| SLO compliance report | 4-6 | 4 stat_cards + 2 change_event_lists |
| CloudTrail audit | 3-5 | 2 stat_cards + 1-2 tables + change_event_list |
| Recovery verification | 6 | 5 stat_cards + table |
| Alerting plan | 3 | 3 tables (stacked) |
| Write action (with context) | 3-5 | 2-3 diagnostic widgets + 1-2 action_forms |
| Write action (standalone) | 1 | 1 action_form |
