---
name: latency-regression
description: >
  Investigate latency regressions in AWS Application Signals services — p50/p90/p99
  comparison vs baseline, slow-trace waterfall analysis, dependency contribution,
  span-to-code mapping, and correlated deploys via CloudTrail.
  Trigger phrases: "latency regression", "service got slow", "p99 spike", "p99 increased",
  "tail latency", "slow service", "high latency", "response time increase",
  "API got slow", "endpoint slow", "latency anomaly", "performance degradation",
  "performance regression", "investigate latency", "slow API", "slow endpoint",
  "request duration up", "slow traces", "increased response time",
  or any request about diagnosing why a service or operation got slower.
metadata:
  version: "0.1.0"
---

# Latency Regression Investigation

Workflow for finding *why* a service or operation got slower. Produces a
**Trace Waterfall Summary** artifact plus, when relevant, a **Service Health Card**.

## When this activates

- User reports a service / API / endpoint is slow
- p99 / p90 latency has crossed a threshold
- An Application Signals operation is flagged as "degraded" without an SLO breach

If a *latency SLO is actively breaching*, prefer `slo-breach-investigation` — it is the
strict superset.

## Required MCP servers

- `awslabs.cloudwatch-applicationsignals-mcp-server` — service map, traces, operations
- `awslabs.cloudwatch-mcp-server` — supporting metric math and logs
- `awslabs.cloudtrail-mcp-server` — change correlation

## Presentation

How to surface progress while the investigation runs:

1. **Show reasoning before each phase.** Before each phase, write a one-line thought
   explaining what you are about to do and why — e.g. "Comparing current p99 to the
   same-hour baseline from 1d and 7d ago to confirm this is a real regression and not
   a daily-traffic pattern." Make the investigation inspectable, not a black box.
2. **Label tool calls in human-readable terms.** When invoking MCP tools, prefix each
   call with a plain-English label ("Pulling p50/p90/p99…", "Sampling slow traces…",
   "Building latency budget for the worst operation…") rather than dumping raw API
   or tool names. Raw names go in the metadata footer, not the running narrative.
3. **Track phases with `TodoWrite`.** At the start of the workflow, create a todo
   per phase (Confirm regression, Localize, Sample slow traces, Correlate changes,
   Hypothesize, Follow dependencies). Mark each `in_progress` when you start it and
   `completed` when its data is in hand. Exactly one phase is `in_progress` at a
   time.

## Investigation workflow

### Phase 1 — Confirm the regression is real

1. Pull p50 / p90 / p99 for the suspected operation over:
   - Last 1 hour (current)
   - Same hour 1 day ago (yesterday baseline)
   - Same hour 7 days ago (week-over-week baseline)
2. A "real" regression is typically:
   - p99 up >2× vs both baselines
   - OR p90 up >1.5× *and* sustained for 15+ min
3. If the regression is only at p99 with stable p50, suspect a single-instance issue
   (bad host, GC pause, noisy neighbor) — note this in hypotheses.

### Phase 2 — Localize: which operation, which dependency?

1. List operations on the service ranked by p99 latency.
2. For the worst N operations, get the service map / dependency view:
   - Which downstream calls dominate?
   - Have any dependencies' latencies also moved?
3. Build the latency budget: of the operation's total p99, how much is local work vs
   each downstream call?

### Phase 3 — Sample slow traces

1. Search for slow traces (filter: duration > new p99) in the regression window.
2. Pick 3–5 traces, preferring diversity over redundancy:
   - 1 fastest "bad" trace (closest to threshold)
   - 1 slowest trace
   - 1 trace per distinct dependency that appears slow
3. For each trace, extract for the artifact:
   - Top slow spans by self-time
   - Span exception (if any)
   - Span-to-code annotation (Application Signals provides class.method on supported runtimes)
   - Downstream dependency timings

### Phase 4 — Correlate with changes

Same as `slo-breach-investigation` Phase 4 — query CloudTrail for the regression
window ± 30 min.

### Phase 5 — Hypotheses

Common root causes to consider, ranked by base rate:
1. **Code change** — recent deploy modified the slow path. Look for `UpdateService` /
   `UpdateFunctionCode` near the regression start.
2. **Downstream dependency degradation** — a service or DB you call got slow. Check
   dependencies' own metrics and SLOs.
3. **Capacity / scaling** — request volume up + tasks unchanged → CPU contention. Check
   `CPUUtilization`, task count, autoscaling events.
4. **Database** — query plan change, lock contention, connection pool exhaustion. If
   Database Insights is enabled, pull top slow queries.
5. **GC / runtime** — intermittent p99 spikes with stable p50. JVM GC, .NET LOH, Node
   event loop blocking.
6. **Cold starts** — Lambda regressions on low-traffic functions; check init duration.

Each hypothesis needs evidence from ≥2 sources before it ranks "High confidence."

### Phase 6 — Follow dependencies (cascading health check)

If Phase 5's top hypothesis is **downstream dependency degradation** — or a single
downstream call dominates the latency budget from Phase 2 — follow the chain one hop:

1. **Pick the slowest / most-implicated dependency.** Use the dependency that contributes
   the largest share of the operation's p99 (from Phase 2's latency budget) or the one
   named in the top hypothesis. Pick at most one.
2. **Run a service health snapshot on it.** Invoke the `service-health-card` skill on
   the dependency, scoped to the regression window.
3. **Include the result in the final summary.** Add a "Downstream dependency health"
   section to the Trace Waterfall Summary or Service Health Card output, showing the
   dependency's RED-metric verdict and its own latency baseline comparison. If the
   dependency's p99 has *also* regressed by ≥1.5× over its own baseline, escalate the
   "downstream dependency" hypothesis to High confidence and note that the regression
   likely originated upstream of this service.
4. **Cap the chain at depth 2.** If the dependency's health card implicates *its*
   dependency, you may follow one more hop (depth 2) — but stop there. Note "Further
   dependencies not auto-followed" in the summary. Never follow a third hop. This is
   the loop guard.
5. **Skip the cascade entirely** if:
   - No single dependency dominates the latency budget (work is local CPU / GC / DB
     query plan)
   - Top hypothesis is a code change or capacity issue with no downstream component
   - The implicated dependency is outside the user's account

## Final artifact

**Lead with a one-line verdict** before presenting the artifact. The verdict goes
ABOVE the artifact, in plain text, so it's the first thing the user reads. Shape:

> 🟠 **p99 up 3.2× on `POST /checkout`** — 78% of the regression is downstream
> `payment-service` latency. Top hypothesis: payment-service degraded after its
> 14:05 UTC deploy (High confidence).

The verdict must name (1) the magnitude of the regression, (2) the worst operation,
(3) where the time went (local vs which dependency), and (4) the top-ranked
hypothesis with its confidence. Never hide the verdict inside the artifact.

Then present **Trace Waterfall Summary** for the worst operation. If multiple
operations are affected, also produce a **Service Health Card**. Always include
**Top Suspected Cause** when you have ranked hypotheses.

For a full postmortem-style writeup (timeline + root cause + impact + remediation),
use the artifact template at `artifacts/investigation-summary.html` and populate the
`{{PLACEHOLDERS}}` with actual data — see that file for the full placeholder list.

## Empty states and data unavailability

Surface missing data; do not hide it.

**Empty states (UX11)** — render a short, helpful message with a suggested
next action:

- **No services found / wrong region** → "No Application Signals services
  in `<region>`. Confirm region or run `aws-apm-setup`."
- **No traces in the regression window** → "No traces sampled. X-Ray may
  have sampled them out. Continue with p50/p90/p99 metric evidence and
  flag attribution confidence as Medium (capped)."
- **No baseline available** (service is too new) → "No baseline for
  comparison — service has only `<N>` minutes of history. Compare against
  the last `<N>` minutes within the current window instead, and surface
  this caveat in the artifact."
- **No span-to-code annotations** (manual instrumentation, unsupported
  runtime) → "Span-to-code unavailable for `<service>`. Code column will
  be empty in the artifact."
- **Multiple ambiguous services match** → "Multiple matches for `<name>`:
  <list>. Ask the user which one."

**Data unavailability (UX8)** — surface failures in the artifact's
data-unavailable banner rather than silently skipping. Examples:

> **Data unavailable** — CloudTrail unreachable: AccessDenied. Change
> correlation skipped. Confidence capped at Medium.

> **Data unavailable** — X-Ray returned `ThrottlingException`. Trace
> sampling may be incomplete; only `<N>` of `<M>` requested traces
> retrieved.

The rule: a missing source caps confidence at Medium. State the cap in
the confidence justification per `investigation-validator`.

## What this skill does NOT do

- Does not investigate error spikes that aren't latency-related — use `error-spike-triage`.
- Does not investigate cross-service cascading failures — escalate to
  `slo-breach-investigation` if multiple SLOs are breaching.
