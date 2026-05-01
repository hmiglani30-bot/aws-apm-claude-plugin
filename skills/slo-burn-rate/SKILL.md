---
name: slo-burn-rate
description: >
  Compute SLO error-budget consumption and burn rate for one or more
  Application Signals SLOs over arbitrary time windows. Produces the
  numbers that other skills cite (e.g., "burning at 14× normal, budget
  exhausts in 6h"). Use this when you need the math, not the full
  breach investigation. Trigger phrases: "burn rate", "error budget",
  "budget remaining", "burn calc", "fast burn", "slow burn",
  "is the SLO burning", "how much budget is left", "compute burn",
  "calculate burn rate", "budget consumption", "budget exhaustion ETA",
  "1h burn rate", "6h burn rate", "24h burn rate".
metadata:
  version: "0.1.0"
---

# SLO Burn Rate

Pure-math skill for SLO burn-rate and error-budget-consumption calculations.
Other skills (`slo-breach-investigation`, `slo-compliance-report`,
`alarm-response`) call this when they need the numbers cited in their
artifacts; users can also invoke it directly when they want the math without
the full investigation.

## When this activates

- A user asks "what's the burn rate on `<slo>`?"
- An investigation needs burn-rate at multiple time windows (1h / 6h / 24h)
- An alerting design needs the multi-window multi-burn-rate thresholds
- A health check or compliance report wants the canonical
  budget-exhaustion ETA

If the user wants the full "why is this SLO breaching" investigation, defer
to `slo-breach-investigation` — this skill produces only the numbers.

## Context provider

- `context.service` -- service name (optional if `slo_id` is provided)
- `context.slo_id` -- specific SLO identifier
- `context.region` -- AWS region
- `context.account` -- AWS account ID
- `context.time_window.start` / `.end` -- the window over which to compute
  the burn rate. Defaults to the SLO's compliance period if absent.

## MCP tool dependencies

- `awslabs_cloudwatch-applicationsignals-mcp-server` -- `get_slo`,
  `list_slos`
- `awslabs_cloudwatch-mcp-server` -- `get_metric_data` (for raw good/total
  event counts when the SLO API does not expose burn rate over time)

## Definitions

The burn-rate math used here matches the Google SRE Workbook conventions:

- **Compliance period (`P`)** — the SLO's evaluation window (e.g. 30 days,
  7 days, 1 day). Read from `get_slo` → `goal.interval` or equivalent.
- **Target attainment (`T`)** — the SLO's target as a fraction
  (e.g. 99.9% → `T = 0.999`). The error budget is `1 − T`.
- **Total error budget over P** — `(1 − T) × P`.
- **Bad-event rate at time t (`bad_rate(t)`)** — fraction of events in the
  measurement window at time `t` that are bad (errors, slow requests,
  whatever the SLI definition counts as bad).
- **Burn rate over window W (`B(W)`)** — `mean(bad_rate over W) / (1 − T)`.
  Normalized so that `B = 1.0` exactly meets the budget; `B = 14` means the
  budget is being consumed at 14× the sustainable rate.
- **Budget consumed since period start** — fraction of the period's total
  error budget that has been used, in `[0, 1]`. `> 1` means the SLO has
  already breached.
- **Budget remaining** — `1 − consumed`, in `[0, 1]` (or `[0, ∞)` after
  breach).
- **Budget-exhaustion ETA** — current burn rate projected forward:
  `eta_seconds = (budget_remaining × P) / current_bad_rate`. If
  `bad_rate ≈ 0`, the ETA is `+∞` and the SLO is in no danger.

## Computation workflow

### Phase 1 — Resolve the SLO

1. If `context.slo_id` is provided, call `get_slo(slo_id)` directly.
2. Otherwise, call `list_slos(service=context.service)` and let the user
   pick if multiple match. If only one SLO matches, use it.
3. Capture: `target`, `compliance_period`, `metric_type` (availability or
   latency), `threshold` (latency target if applicable), `current_attainment`,
   `current_burn_rate`, `error_budget_remaining`.

### Phase 2 — Compute multi-window burn rates

The Google SRE multi-window multi-burn-rate (MWMBR) pattern uses several
windows simultaneously to balance precision against alert latency. Compute:

| Window | Why |
|---|---|
| **5 minutes** | Catches sudden, severe burns (page immediately) |
| **1 hour** | Catches sustained moderate burns |
| **6 hours** | Catches slow burns over a workday |
| **24 hours** | Detects gradual erosion over a day |

For each window, derive `B(W)`:

- If `get_slo` exposes a `burn_rate_over_time` series, average it over the
  window.
- Otherwise, pull good-events and bad-events from `get_metric_data` for the
  window, compute `bad_rate = bad / (good + bad)`, then divide by
  `(1 − target)` to get the normalized burn rate.

### Phase 3 — Compute budget consumed and remaining

1. Pull total bad events since the compliance period started (`P` window).
2. Compute total budget = `(1 − T) × total_events_in_period`.
3. `consumed = bad_events_since_period_start / total_budget`.
4. `remaining = max(0, 1 − consumed)`.
5. If `consumed > 1.0`, the SLO has already breached — surface that
   explicitly with `breach_amount = consumed − 1.0`.

### Phase 4 — Project budget-exhaustion ETA

Use the most recent stable window (1h is a good default — 5min is too noisy
for a projection):

```
eta_seconds = (remaining × period_seconds) / current_bad_rate
eta_human   = format_duration(eta_seconds)  // e.g. "6h 12m", "3 days", "infinity"
```

If `current_bad_rate <= (1 − T)` (burn at or below sustainable rate), the
ETA is "infinity / SLO is sustainable at current rate."

### Phase 5 — Classify burn

| Burn rate `B` | Classification | Recommended action |
|---|---|---|
| `B ≤ 1` | **Sustainable** | None — within budget. |
| `1 < B ≤ 2` | **Slow burn** | Watch — flag for next review. |
| `2 < B ≤ 6` | **Moderate burn** | Investigate — likely worth a hypothesis ranking via `slo-breach-investigation`. |
| `6 < B ≤ 14` | **Fast burn** | Page on-call — budget exhaustion in hours, not days. |
| `B > 14` | **Critical burn** | Page severity-up — budget exhaustion in <1h at this rate. |

These thresholds align with the multi-window patterns from the Google SRE
book; they can be overridden per-SLO via context if a team has different
risk appetite.

## Final artifact

```markdown
## ⏱️ SLO Burn Rate — `<slo name>`
**Service:** `<service>` · **Target:** `<target>%` · **Period:** `<P>`

### Current state
- **Attainment:** `<current>%` (target `<target>%`)
- **Budget remaining:** `<remaining_pct>%` of total
- **Budget consumed:** `<consumed_pct>%`
- **Classification:** <Sustainable | Slow | Moderate | Fast | Critical> burn

### Multi-window burn rates
| Window | Burn rate | Classification |
|---|---|---|
| 5m | <B>× | <class> |
| 1h | <B>× | <class> |
| 6h | <B>× | <class> |
| 24h | <B>× | <class> |

### Projection
**Budget exhaustion ETA (1h burn rate):** `<eta_human>` <or "infinity">

### Open in CloudWatch
- [SLO detail](<deep-link>)
- [Burn rate dashboard](<deep-link>)

---
**Source:** `awslabs_cloudwatch-applicationsignals-mcp-server`, `awslabs_cloudwatch-mcp-server`
**Time range:** since period start (<P>) · current windows: 5m / 1h / 6h / 24h
**MCP tools called:** `get_slo`, `get_metric_data`
**Confidence:** High (deterministic math)
```

## Verdict rules

The skill never produces a binary verdict on its own — it produces *numbers*.
A separate skill (`slo-breach-investigation`, `service-health-card`) decides
whether the burn rate is alarming enough to surface.

If invoked directly by the user, lead the response with the classification
band ("⚠️ Fast burn — 8.4× normal at the 1h window. Budget exhaustion ETA:
4h 12m.") so the answer reads in one line.

## Empty states and data unavailability

- **SLO not found** → surface the AWS error verbatim. Do not invent a burn
  rate.
- **Period has zero events** → all rates are `0`, ETA is `infinity`, surface
  "No traffic in period — burn calc not meaningful."
- **`get_slo` does not expose `burn_rate`** → fall back to the
  `get_metric_data` path and label confidence as Medium.
- **One window has no data, others do** → render the available windows and
  set the missing one to `—` rather than dropping the row.

## What this skill does NOT do

- Does not investigate *why* the burn rate is high — use
  `slo-breach-investigation`.
- Does not produce a recommendation list of fixes — the math is the output.
- Does not write any state — read-only by construction.
