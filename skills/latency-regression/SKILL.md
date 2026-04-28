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

### Phase 1b — Compute blast radius

Before localizing, compute the **blast radius** — who and what is affected
by the latency regression. This becomes a section of the final artifact
and feeds the `copy-to-incident` skill's customer / exec summaries.
Capture all of:

- **Affected operations** — names + p99 delta vs baseline.
- **Callers** — every Application Signals service calling these
  operations during the regression window. Pull from the service map.
- **AZ / region** — concentrated in one AZ (single-instance / AZ issue,
  often shows up as p99-only with stable p50) or fleet-wide? Compute
  per-AZ if the metric supports it; else note "AZ breakdown
  unavailable."
- **Customer segments** — group slow requests by `tenantId`,
  `customerTier`, or whatever segmentation tag the service emits. If no
  tag, note "customer-segment data unavailable."
- **Upstream services** — for each caller, note whether their own
  latency has also moved. A caller that's degrading because of this
  service is different from one that has its own independent issue.
- **Estimated impacted requests** — count of requests slower than the
  pre-regression p99 over the window. Round and surface uncertainty
  (e.g. "~3,400 requests >500ms during the window vs. baseline ~120,
  ±25%").
- **Severity label** — proposed SEV1 / SEV2 / SEV3 / SEV4:
  - SEV1: customer-facing, p99 >5× baseline, broad caller fan-out,
    sustained > 15 min
  - SEV2: customer-facing, p99 >2× baseline, narrow scope OR sustained
    short
  - SEV3: internal-only callers OR p90 only with stable p99
  - SEV4: tooling / synthetics, no customer impact
  This is a **proposal** — the on-call engineer / IC makes the final call.

Render this as a "Blast radius" subsection. If any field is unavailable,
say so explicitly rather than omitting the line.

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

## Degraded telemetry handling

If the inputs you need are unavailable, the investigation must
gracefully degrade rather than fabricate. Detect each gap and apply the
matching rule. Cap final confidence based on the worst gap, and tell
the user explicitly which signals were missing.

| Gap | Detect | Behavior | Confidence cap |
|---|---|---|---|
| Traces missing | `search_traces` for slow traces returns 0 results when latency metrics show events | Skip Phases 3 + 6 trace-based steps; rely on metrics only. Latency-budget split is not possible | Medium |
| Logs not correlated to traces | No `traceId` field on log lines for the affected operation | Surface log patterns without trace cross-reference | Medium |
| Per-operation latency unavailable | `get_service_operations` returns no per-operation breakdown | Skip Phase 2 ranking; analyze service-level p50/p90/p99 only | Medium |
| Service map empty | No callers / dependencies returned | Skip dependency contribution analysis (Phase 2.2/3) and blast radius "Callers" / "Upstream services" lines | Low for blast radius |
| SLOs absent | `list_slos` returns empty | Continue — latency-regression doesn't require SLOs. Note "no latency SLO context" in artifact | None |
| CloudTrail denied | `AccessDenied` on `LookupEvents` / Lake / Logs integration | Skip Phase 4 entirely; surface "Cannot correlate with CloudTrail" | Medium |
| All telemetry unavailable | `list_services` errors or returns empty | Stop. Run `/cw-doctor` and `/cw-set-context` first | N/A — refuse to run |

Always tell the user which signals degraded. A hedged artifact beats a
confident-looking one built on missing data.

## Final artifact

**Lead with a one-line verdict** before presenting the artifact. The verdict goes
ABOVE the artifact, in plain text, so it's the first thing the user reads. Shape:

> 🟠 **p99 up 3.2× on `POST /checkout`** — 78% of the regression is downstream
> `payment-service` latency. Top hypothesis: payment-service degraded after its
> 14:05 UTC deploy (High confidence).

The verdict must name (1) the magnitude of the regression, (2) the worst operation,
(3) where the time went (local vs which dependency), and (4) the top-ranked
hypothesis with its confidence. Never hide the verdict inside the artifact.

Then present **Trace Waterfall Summary** for the worst operation. If
multiple operations are affected, also produce a **Service Health Card**.
Always include **Top Suspected Cause** when you have ranked hypotheses.

The artifacts must include:
- **Blast radius** subsection (from Phase 1b): callers, AZ/region scope,
  customer segments, upstream services, estimated impacted requests,
  proposed severity label.
- **Owner + suggested page** (from `service-ownership` skill).
- **Degraded-telemetry note** (if any signal was missing) with the
  capped confidence label.

For a full postmortem-style writeup (timeline + root cause + impact + remediation),
use the artifact template at `artifacts/investigation-summary.html` and populate the
`{{PLACEHOLDERS}}` with actual data — see that file for the full placeholder list.

## Action safety

**Read-only by default.** Never call write actions without an explicit confirmation
gate. The plugin's PreToolUse hook fails closed on state-changing MCP calls (Put /
Update / Delete / Modify / Create / Remove / Disable / Enable / Attach / Detach / Tag
/ Untag / Set / Batch / Send / Publish / Invoke / Execute / Run / Associate /
Disassociate / Register / Deregister / Restore / Reboot / Terminate / Start / Stop),
but rely on the rule, not the hook.

Before proposing any write, render this **structured approval block** to the user and
wait for the exact confirmation phrase before re-issuing the call:

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

Do not paraphrase or shorten this block — the structure is the safety surface. If any
field is unknown, say so explicitly ("blast radius unknown — refusing to propose").

For destructive or billing-impacting actions (e.g. modifying autoscaling groups, DB
parameter groups), prefer deep-linking the user to the AWS console via
`open-in-cloudwatch` rather than executing through MCP.

## Redaction

**Redact PII, tokens, and customer identifiers from logs and traces before including
them in any output.** Trace span attributes and log lines pulled in Phases 2–3 may
contain `request.body`, `user.id`, `customer.id`, auth headers, or session tokens —
strip them before they reach the artifact:

- Email addresses, user IDs, customer IDs, account numbers — replace with `<redacted-user>`
- Auth tokens, API keys, session IDs, JWTs, bearer tokens — replace with `<redacted-token>`
- IP addresses in user contexts (not service-internal IPs) — replace with `<redacted-ip>`
- Request / response bodies — keep size and content-type, redact value

Cite **structural fields** (span name, `class.method`, self-time, exception class), not
raw payloads. If you cannot tell whether a field is sensitive, redact it.

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
