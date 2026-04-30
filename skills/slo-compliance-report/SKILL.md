---
name: slo-compliance-report
description: >
  Produce a portfolio-wide SLO compliance report — list every SLO across every
  Application Signals service, calculate compliance status (budget remaining, burn
  rate), rank services by risk of breaching, render a summary dashboard, and surface
  recommendations for at-risk SLOs. Non-incident, reporting use case.
  Trigger phrases: "SLO report", "SLO compliance report", "weekly SLO report",
  "monthly SLO report", "SLO summary", "SLO dashboard", "SLO health check",
  "audit SLOs", "review SLOs", "which SLOs are at risk", "SLO portfolio",
  "all SLOs status", "SLO scorecard", "SLO review", "SLO compliance",
  "error budget report", "burn rate report", "service reliability report",
  or any non-incident request to summarize SLO health across services.
metadata:
  version: "0.2.0"
---

# SLO Compliance Report

End-to-end workflow for producing a **portfolio-wide SLO compliance report** -- a
non-incident, periodic / on-demand reporting view that summarizes SLO health across
every service in the account.

## Context provider

Read these fields from the context provider (ARCHITECTURE.md context shape):

- `context.region` -- AWS region (pass to all MCP calls; tag report with this region)
- `context.account` -- AWS account ID (include in report header)
- `context.time_window.start` / `.end` -- reporting window (default: now minus 7 days to now)
- `context.data_sources_available.application_signals` -- MUST be true; abort if false

## When this activates

Triggers on any of:
- A user asks for a periodic SLO review ("weekly SLO report", "monthly compliance audit")
- A user asks "which SLOs are at risk?" without naming a specific service
- A user wants a portfolio-wide reliability scorecard

If the user is asking about a *specific* breaching SLO right now, prefer
`slo-breach-investigation`.

## MCP tool dependencies

- `awslabs.cloudwatch-applicationsignals-mcp-server` -- `list_services`, `list_slos`, `get_slo`

## Presentation

1. **Show reasoning before each phase.**
2. **Label tool calls in human-readable terms.**
3. **Track phases with `TodoWrite`.**

## Reporting workflow

### Phase 1 -- List all SLOs across all services

#### MCP tool call sequence

1. Call `list_services(region=context.region)`. Iterate until `next_token` is null. Do NOT truncate to first page.
2. For each service, call `list_slos(service_name=<name>)`. Iterate until `next_token` is null.
3. Build a flat inventory: Service, SLO name, SLO type (availability/latency/custom), Target, Compliance window.

**Cap at 200 services per run.** If `list_services` returns more, stop and surface "Exceeded MAX_SERVICES (200), refine filter."

If zero SLOs are returned, the report headline becomes "No SLOs configured" and Phase 5 pivots to "define SLOs for top N services by traffic."

### Phase 2 -- Calculate compliance status for each SLO

#### MCP tool call sequence (per SLO, capped at concurrency 10)

1. Call `get_slo(slo_id=<id>, time_window={start: <window_start>, end: <now>})`.
   Returns: `attainment`, `error_budget_remaining_seconds`, `burn_rate`, `threshold`, `period`.

2. Compute derived fields:
   - `budget_remaining_pct` = `(error_budget_remaining_seconds / total_budget_seconds) * 100`
   - `burn_rate_1h`: query with `time_window` = last 1h
   - `burn_rate_6h`: query with `time_window` = last 6h
   - `burn_rate_24h`: query with `time_window` = last 24h
   - Normalize burn rate to 1.0 = exactly meeting budget

3. Classify state:
   - **Healthy**: attainment >= target AND budget_remaining_pct > 50
   - **Warning**: attainment >= target AND (budget_remaining_pct <= 50 OR burn_rate_6h > 1.0)
   - **At risk**: attainment >= target AND (budget_remaining_pct <= 25 OR burn_rate_1h > 14.0)
   - **Breaching**: attainment < target
   - **Recovered**: attainment >= target AND budget_remaining_pct <= 0

#### Example per-SLO result

```json
{
  "slo_name": "checkout-availability",
  "target_pct": 99.9,
  "attainment_pct": 99.74,
  "budget_remaining_pct": 12.0,
  "burn_rate_1h": 28.0,
  "burn_rate_6h": 14.5,
  "burn_rate_24h": 6.2,
  "state": "at_risk",
  "time_to_exhaust": "~6h at current 1h rate"
}
```

### Phase 3 -- Rank services by risk

Aggregate per-service:

1. **Worst-state SLO** drives the service's row color.
2. **Time-to-budget-exhaustion** -- extrapolate current burn rate. Service
   with soonest exhaustion ranks highest.
3. **Number of SLOs in Warning / At risk / Breaching** -- services with
   multiple degraded SLOs rank above single-SLO services.

Produce two ranked lists:
- **Top at-risk services** (Warning + At risk + Breaching), sorted by time-to-exhaustion
- **Healthy services** (count only)

### Phase 4 -- Produce the summary dashboard artifact

Render a fixed-shape **SLO Compliance Report** dashboard:

```markdown
## SLO Compliance Report -- `<time-window>`

**Generated:** <ISO timestamp> . **Region:** <region>
**Services scanned:** <n> . **SLOs scanned:** <m>

### Headline
- [green] Healthy SLOs: <count> (<%>)
- [yellow] Warning: <count> (<%>)
- [orange] At risk: <count> (<%>)
- [red] Breaching: <count> (<%>)

### Top at-risk services
| Service | SLO | Target | Attainment | Budget | 1h burn | State | Time-to-exhaust |
|---|---|---|---|---|---|---|---|
| <svc> | <slo> | <%> | <%> | <%> | <x> | <state> | <duration> |

### Healthy services
<count> services with all SLOs Healthy.

### Recently recovered
| Service | SLO | Recovered at | Was breaching for |
|---|---|---|---|

### Open in CloudWatch
- [SLO list (Application Signals)](<deep-link>)
- [Service map](<deep-link>)

---
**Source:** `awslabs.cloudwatch-applicationsignals-mcp-server`
**Time window:** <window>
**MCP tools called:** `list_services`, `list_slos`, `get_slo`
**Region:** <context.region> . **Account:** <context.account>
**Confidence:** <Low | Medium | High>
```

### Phase 5 -- Generate recommendations for at-risk SLOs

For each SLO in **Warning / At risk / Breaching** state, produce one concrete
recommendation anchored to the per-SLO data:

1. **Investigate now** -- for Breaching or At risk with fast burn (>14x). Recommend `/cw-investigate-slo <slo-name>`.
2. **Tune the SLO target** -- for SLOs Warning multiple cycles with no real reliability problem.
3. **Add headroom** -- for latency SLOs nearing breach due to gradual traffic growth.
4. **Define missing SLOs** -- for top-traffic services with no SLOs at all.
5. **Decommission stale SLO** -- for SLOs on services with near-zero traffic.

## Error handling

| Error | Detect | Behavior |
|---|---|---|
| `list_services` returns empty | No services in region | Output "No Application Signals services in `<region>`. Confirm region or run `aws-apm-setup`. Report aborted." |
| `list_slos` returns empty for all services | No SLOs configured | Headline: "No SLOs configured across `<N>` services." Pivot Phase 5 to recommending SLO definitions. |
| `get_slo` ThrottlingException | Rate limit on per-SLO fetch | Retry once with 2s backoff. On second failure, mark SLO as "Status unknown" in dashboard. |
| `get_slo` AccessDenied | IAM permission missing | Do NOT retry. Mark SLO as "Status unknown" and surface in data-unavailable banner. |
| `get_slo` ResourceNotFound | SLO deleted between list and get | Skip this SLO. Note "1 SLO not found (may have been deleted)." |
| Report timeout (>90s) | Total execution time exceeded | Render whatever has completed plus "Report incomplete: `<N>` of `<M>` SLOs scanned" banner. |
| Application Signals not available | `data_sources_available.application_signals` is false | Abort. Output "Application Signals not enabled. Run `aws-apm-setup` first." |

## Few-shot examples

### Example 1: Portfolio with at-risk SLOs

**Input:** "Give me this week's SLO compliance report"

**Output:**
```
[orange] 3 SLOs at risk this week -- `checkout-availability` has 15% budget
remaining and is the top concern; recommend running
`/cw-investigate-slo checkout-availability` first.

## SLO Compliance Report -- 2026-04-22 to 2026-04-29

**Generated:** 2026-04-29T10:00:00Z . **Region:** us-east-1
**Services scanned:** 8 . **SLOs scanned:** 14

### Headline
- [green] Healthy SLOs: 9 (64%)
- [yellow] Warning: 2 (14%)
- [orange] At risk: 2 (14%)
- [red] Breaching: 1 (7%)

### Top at-risk services
| Service | SLO | Target | Attainment | Budget | 1h burn | State | Time-to-exhaust |
|---|---|---|---|---|---|---|---|
| checkout-api | checkout-availability | 99.9% | 99.74% | 15% | 12x | At risk | ~8h |
| auth-svc | auth-latency-p99 | 200ms | 245ms | 22% | 8x | At risk | ~14h |
| payment-svc | payment-availability | 99.95% | 99.91% | 0% | 1.2x | Breaching | exhausted |

### Recommendations
1. **Investigate now:** `/cw-investigate-slo checkout-availability` -- 1h burn rate is 12x, budget exhaustion in ~8h.
2. **Investigate now:** `/cw-investigate-slo payment-availability` -- budget exhausted, attainment below target.
3. **Add headroom:** `auth-latency-p99` -- p99 trending up 15% week-over-week; review autoscaling.
```

### Example 2: All healthy portfolio

**Input:** "SLO scorecard"

**Output:**
```
[green] All SLOs healthy -- 12 services scanned, all above target with >50%
budget remaining.

## SLO Compliance Report -- 2026-04-22 to 2026-04-29

**Generated:** 2026-04-29T10:00:00Z . **Region:** us-east-1
**Services scanned:** 12 . **SLOs scanned:** 18

### Headline
- [green] Healthy SLOs: 18 (100%)

### Top at-risk services
None.

### Recommendations
No action needed. All SLOs are healthy with comfortable budget margins.
```

## Final artifact

**Lead with a one-line verdict** before the dashboard:

> [orange] **3 SLOs at risk this week** -- `checkout-availability` has 15% budget
> remaining. Recommend running `/cw-investigate-slo checkout-availability` first.

The verdict must name (1) overall portfolio state, (2) the single most-at-risk
SLO, and (3) the recommended next action.

## Empty states and data unavailability

- **No services in region** -- "No Application Signals services in `<region>`. Report aborted."
- **No SLOs configured** -- Headline: "No SLOs configured." Pivot to recommending SLO definitions.
- **No at-risk SLOs** -- "[green] All SLOs healthy."
- **No recently-recovered SLOs** -- Omit the table or render `(none)`.
- **Single-region scope** -- Tag report with region in headline.
- **Data unavailable** -- Render banner naming failed source and impact on completeness.

## Caching, pagination, and rate limits

- **Max services:** 200 per run.
- **Concurrency:** Fan out `get_slo` reads at concurrency 10.
- **Per-call timeout:** 10s per MCP read.
- **Total report timeout:** 90s.
- **Retry:** On ThrottlingException, retry once with 2s backoff. After second failure, mark as "Status unknown."
- **Partial results:** Dashboard renders even if some SLO fetches failed. "Status unknown" count surfaces failures.

## Action safety

**Read-only.** This workflow only reads SLO state. For follow-up write actions,
render the structured approval block and wait for CONFIRM.

## Redaction

SLO metadata (name, target, attainment, burn rate) is not PII. If
recommendation evidence includes log data, apply standard redaction rules.

## What this skill does NOT do

- Does not investigate root causes -- hand off to `slo-breach-investigation`.
- Does not produce per-service health cards -- use `service-health-card`.
- Does not run on a schedule -- invoked on-demand.
- Does not cross AWS accounts.
