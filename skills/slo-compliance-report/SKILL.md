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
  version: "0.1.0"
---

# SLO Compliance Report

End-to-end workflow for producing a **portfolio-wide SLO compliance report** — a
non-incident, periodic / on-demand reporting view that summarizes SLO health across
every service in the account. The output is a summary dashboard + recommendations for
at-risk SLOs, suitable for weekly reliability reviews, monthly stakeholder updates, or
ad-hoc audits.

## When this activates

Triggers on any of:
- A user asks for a periodic SLO review ("weekly SLO report", "monthly compliance audit")
- A user asks "which SLOs are at risk?" without naming a specific service
- A user wants a portfolio-wide reliability scorecard

If the user is asking about a *specific* breaching SLO right now, prefer
`slo-breach-investigation` — that workflow is for active incident triage, not reporting.

## Required MCP servers

- `awslabs.cloudwatch-applicationsignals-mcp-server` — SLOs, services, attainment,
  burn rate

The CloudWatch and CloudTrail MCP servers are not strictly required for this workflow —
this is a reporting view, not a root-cause workflow. They are still useful for the
recommendations phase if a specific at-risk SLO needs deeper context.

If the Application Signals MCP is not connected, run the `aws-apm-setup` skill before
continuing.

## Presentation

How to surface progress while the report runs:

1. **Show reasoning before each phase.** Before each phase, write a one-line thought
   explaining what you are about to do and why — e.g. "Enumerating SLOs across all
   services first so the per-SLO compliance fetches in Phase 2 can fan out in
   parallel." Make the report inspectable, not a black box.
2. **Label tool calls in human-readable terms.** When invoking MCP tools, prefix each
   call with a plain-English label ("Listing services in `us-east-1`…", "Fetching
   SLO attainment and burn rate…", "Computing time-to-exhaustion…") rather than
   dumping raw API or tool names. Raw names go in the metadata footer.
3. **Track phases with `TodoWrite`.** At the start of the workflow, create a todo
   per phase (List SLOs, Compute compliance, Rank by risk, Render dashboard,
   Generate recommendations). Mark each `in_progress` when you start it and
   `completed` when its data is in hand. Exactly one phase is `in_progress` at a
   time.

## Reporting workflow

### Phase 1 — List all SLOs across all services

1. Enumerate every Application Signals service in the configured region.
2. For each service, list every SLO configured on it (availability, latency, custom).
3. Build a flat inventory:
   - Service
   - SLO name
   - SLO type (availability / latency / custom)
   - Target (e.g. 99.9% over 30 days)
   - Compliance window (rolling 7d / 30d / calendar)
4. If multiple regions are in scope, fan out per-region and tag each SLO with its region.

If zero SLOs are returned, the report's headline becomes "No SLOs configured" and the
recommendations phase pivots to "define availability + latency SLOs for top N services
by traffic." Do not fabricate compliance data.

### Phase 2 — Calculate compliance status for each SLO

For every SLO in the inventory, fetch:

- **Current attainment** (e.g. 99.87% vs target 99.9%)
- **Error budget remaining** — both raw (e.g. 12 minutes of 30 days) and percent
- **Burn rate over 1h / 6h / 24h** — the three windows together distinguish slow burn
  from fast burn from recovery
- **State** classification:
  - **Healthy** — attainment ≥ target AND budget remaining > 50%
  - **Warning** — attainment ≥ target but budget remaining ≤ 50%, OR 6h burn rate >1×
  - **At risk** — attainment ≥ target but budget remaining ≤ 25%, OR 1h burn rate >14×
  - **Breaching** — attainment < target right now
  - **Recovered** — attainment ≥ target now but budget exhausted in window

Cache the per-SLO results to avoid recomputing the same numbers in Phase 3.

### Phase 3 — Rank services by risk

Aggregate per-service:

1. **Worst-state SLO on the service** drives the service's overall row color.
2. **Time-to-budget-exhaustion** — extrapolate current burn rate forward; the service
   with the soonest exhaustion time ranks highest in the at-risk list.
3. **Number of SLOs in Warning / At risk / Breaching** — services with multiple
   degraded SLOs rank above services with a single one of equal severity.

Produce two ranked lists:
- **Top at-risk services** (Warning + At risk + Breaching), sorted by time-to-exhaustion
- **Healthy services** (count only — do not list every name; the report should focus on
  attention-worthy items)

### Phase 4 — Produce the summary dashboard artifact

Render a fixed-shape **SLO Compliance Report** dashboard. Canonical layout:

```markdown
## 📊 SLO Compliance Report — `<time-window>`

**Generated:** <ISO timestamp> · **Region:** <region(s)>
**Services scanned:** <n> · **SLOs scanned:** <m>

### Headline
- 🟢 Healthy SLOs: <count> (<%>)
- 🟡 Warning: <count> (<%>)
- 🟠 At risk: <count> (<%>)
- 🔴 Breaching: <count> (<%>)

### Top at-risk services
| Service | SLO | Target | Attainment | Budget | 1h burn | State | Time-to-exhaust |
|---|---|---|---|---|---|---|---|
| <svc> | <slo> | <%> | <%> | <%> | <×> | <state> | <duration> |

### Healthy services
<count> services with all SLOs Healthy. (See deep link below for full list.)

### Recently recovered
| Service | SLO | Recovered at | Was breaching for |
|---|---|---|---|

### Open in CloudWatch
- [SLO list (Application Signals)](<deep-link>)
- [Service map](<deep-link>)

---
**Source:** `awslabs.cloudwatch-applicationsignals-mcp-server`
**Time window:** <window>
**MCP tools called:** `<list_services>`, `<list_slos>`, `<get_slo>`
**Confidence:** <Low | Medium | High>
```

The dashboard is the canonical output. Keep it scannable — a reliability lead reading
this in 30 seconds should walk away knowing exactly which 1–3 services need attention
this week.

### Phase 5 — Generate recommendations for at-risk SLOs

For each SLO in **Warning / At risk / Breaching** state, produce one concrete
recommendation. Recommendations fall into a small fixed set:

1. **Investigate now** — for *Breaching* or *At risk* with fast burn (>14×). The
   recommendation is to run `/cw-investigate-slo <slo-name>` for that SLO. This is the
   handoff point from reporting into incident triage.
2. **Tune the SLO target** — for SLOs that have been Warning multiple cycles in a row
   without a real reliability problem (the target may be unrealistic).
3. **Add headroom** — for latency SLOs nearing breach due to gradual traffic growth;
   recommend capacity planning or autoscaling tuning.
4. **Define missing SLOs** — for top-traffic services with no SLOs at all, recommend
   defining availability + latency SLOs.
5. **Decommission stale SLO** — for SLOs on services with near-zero traffic or that
   appear deprecated.

Each recommendation must cite the per-SLO data that motivated it (current attainment,
budget remaining, burn rate). Do not generate generic advice — every recommendation is
anchored to a specific row in the dashboard.

## Final artifact

**Lead with a one-line verdict** before presenting the dashboard. The verdict goes
ABOVE the dashboard, in plain text, so it's the first thing the reliability lead
reads. Shape:

> 🟠 **3 SLOs at risk this week** — `checkout-availability` has 15% budget remaining
> and is the top concern; recommend running `/cw-investigate-slo checkout-availability`
> first.

The verdict must name (1) overall portfolio state (counts of Breaching / At risk /
Warning), (2) the single most-at-risk SLO, and (3) the recommended next action. If
everything is healthy, lead with "🟢 All SLOs healthy — N services scanned, all above
target with >50% budget remaining." Never hide the verdict inside the dashboard.

The **SLO Compliance Report** dashboard from Phase 4 is the canonical output. The
recommendations from Phase 5 render as a follow-on section directly under the dashboard,
not as a separate artifact.

If a single SLO in the report is *Breaching* with fast burn, the verdict above must
use the 🚨 marker and explicitly recommend running `/cw-investigate-slo <slo-name>`
first.

## Empty states and data unavailability

A portfolio report covers many services and is the most common place where
some sources will be missing. Surface gaps; do not hide them.

**Empty states (UX11)**:

- **No services in region** → "No Application Signals services in
  `<region>`. Confirm region or run `aws-apm-setup`. Report aborted."
- **No SLOs configured anywhere** → headline becomes "No SLOs configured
  across `<N>` services". Recommendations phase pivots to "define
  availability + latency SLOs for the top `<N>` services by traffic." Do
  not fabricate compliance data.
- **No at-risk SLOs** → headline becomes "🟢 All SLOs healthy — `<N>`
  services scanned, all above target with >50% budget remaining." The
  "Top at-risk services" table is replaced with a one-line "None."
- **No recently-recovered SLOs** → omit the "Recently recovered" table or
  render `(none)` rather than an empty table with no rows.
- **Single-region scope on a multi-region account** → tag the report with
  the region in the headline so it is not mistaken for an account-wide view.

**Data unavailability (UX8)** — render a banner above the dashboard when
sources fail. Examples:

> Data unavailable — Application Signals returned `ThrottlingException` for
> `<N>` of `<M>` SLOs after retry. Those SLOs are listed under "Status
> unknown" in the dashboard rather than omitted.

> Data unavailable — `list_services` paged out at the configured cap
> (`MAX_SERVICES=200`); `<extra>` services scanned but not enumerated. Use
> a region or name filter to narrow the next run.

The rule: a missing SLO is shown explicitly as "unknown", not silently
dropped. The dashboard's value depends on every row being accounted for.

## Caching, pagination, and rate limits

Portfolio reports fan out reads across many SLOs. Without bounded
concurrency and result caching, this hits Application Signals throttle
limits and produces a misleading partial report.

**Bounds and defaults:**

- **Max services** — cap at 200 per run. If `list_services` returns more,
  stop, surface "exceeded MAX_SERVICES, refine filter", and abort. A
  report on every service in a 1000-service account is not a useful
  artifact.
- **Concurrency** — fan out `get_slo` / `list_slos` reads at concurrency
  10. Bursting 200 in parallel will throttle.
- **Per-call timeout** — 10s per MCP read. If the server hangs, stop
  waiting and mark the SLO as "Status unknown" in the dashboard.
- **Total report timeout** — 90s. If the report cannot complete in 90s,
  render whatever has completed plus a "report incomplete: `<N>` of `<M>`
  SLOs scanned" banner.

**Caching:**

- Cache `list_services` results for the duration of the run so Phase 2
  fanout can read from a single canonical inventory.
- Cache per-SLO compliance results (Phase 2 output) so Phase 3 ranking
  does not re-fetch.
- Do NOT cache across runs — SLO state changes faster than a typical cache
  TTL would tolerate, and a stale headline is worse than a slow one.

**Retry and backoff:**

- On `ThrottlingException`, retry once with 2s backoff per call. After
  the second failure, mark the SLO as "Status unknown" and continue.
- On `AccessDenied` or `ResourceNotFound`, do NOT retry — propagate the
  error to the data-unavailable banner immediately.

**Partial results:**

- The dashboard is rendered even if some SLO fetches failed. The Headline
  counts (Healthy / Warning / At risk / Breaching) include only SLOs with
  successful reads; a separate "Status unknown" count surfaces failures
  so the reader can audit completeness.

## Action safety

**Read-only.** This workflow only reads SLO state. There are no write actions in scope.
The plugin's PreToolUse hook still applies if a recommendation is acted on later — it
fails closed on state-changing MCP calls (Put / Update / Delete / Modify / Create /
Remove / Disable / Enable / Attach / Detach / Tag / Untag / Set / Batch / Send /
Publish / Invoke / Execute / Run / Associate / Disassociate / Register / Deregister /
Restore / Reboot / Terminate / Start / Stop).

If a follow-up action *does* need to run as part of this workflow (for example, the
user accepts a "tune the SLO target" recommendation in-session), the model must first
render this **structured approval block** and wait for the exact confirmation phrase
before re-issuing the call:

```
🛑 Write action proposed
- API action: mcp__awslabs.<server>__<ToolName>
- Target ARN: <fully-qualified ARN or resource ID>
- Region / account: <region> · <account>
- Arguments: <full JSON the tool will receive>
- Blast radius: <single resource | service-wide | account-wide | cross-account>
- Reversible? <yes — how | no — why>
- Rollback plan: <exact reverse action and how to verify it took effect>
- Side-effect detection: <metric / log / event the user should watch post-write>

Type CONFIRM <ToolName> to proceed. Any other reply cancels.
```

For "tune the SLO target" or "decommission stale SLO" recommendations, the **default**
remains: never execute the change automatically — surface advice with a deep link to
the Application Signals console for the user to apply manually. The approval block is
the escape hatch when in-session execution is explicitly requested by the user, not
the default path.

## Redaction

This is a reporting workflow over SLO state — it should not surface raw logs or trace
payloads. If a recommendation cites supporting evidence pulled from logs, redact PII,
tokens, and customer identifiers before including it:

- Email addresses, user IDs, customer IDs, account numbers — replace with `<redacted-user>`
- Auth tokens, API keys, session IDs, JWTs, bearer tokens — replace with `<redacted-token>`
- IP addresses in user contexts (not service-internal IPs) — replace with `<redacted-ip>`

Cite SLO metadata (name, target, attainment, burn rate) verbatim — those are not PII.
Service names and ARNs are also fine. If you cannot tell whether a free-text field is
sensitive, redact it.

## What this skill does NOT do

- Does not investigate the root cause of any specific breach — hand off to
  `slo-breach-investigation` for that.
- Does not produce per-service health cards — use `service-health-card` for an
  individual service deep dive.
- Does not run on a schedule by itself — invoked on-demand or via the `/cw-slo-report`
  slash command. Periodic execution is the user's responsibility (cron, scheduled
  agents, etc.).
- Does not cross AWS accounts — single-account, single-region (or user-specified
  multi-region) scope only.
