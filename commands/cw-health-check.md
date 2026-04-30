---
description: Poll all Application Signals services and render a dashboard of service health cards (RED metrics, SLO status, verdict)
argument-hint: [service-filter]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs.cloudwatch-mcp-server__*"
  - "mcp__awslabs.cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs.cloudtrail-mcp-server__*"
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-health-check

Render a fleet-level health dashboard of every Application Signals service in
the configured region — RED metrics, SLO status, verdict per service. Optional
filter narrows to services whose name matches the substring.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - If empty, include every service returned by `list_services`.
   - Otherwise treat `$ARGUMENTS` as a case-insensitive substring filter on
     the service name. Match by `contains`, not exact.

2. Verify prerequisites. If the
   `awslabs.cloudwatch-applicationsignals-mcp-server` is not connected, run
   the `aws-apm-setup` skill first.

3. Fetch the service list:
   - Call `list_services` for the configured region.
   - Apply the `$ARGUMENTS` filter if any.
   - If the filtered list is empty, surface "No services match `<filter>`"
     and stop.

4. For each service in parallel (cap at 10 concurrent), gather:
   - **Application Signals service health** — call `get_service` (or
     equivalent) to pull the service-level health summary, key attributes
     (Lambda function, ECS service, EKS pod), and operation count. This is
     the canonical "is App Signals seeing this service" check. If
     `get_service` returns `ResourceNotFoundException` or empty key
     attributes, mark the service as `Status unknown — App Signals
     instrumentation incomplete or delayed` and proceed with the fallback
     in step 4a.
   - **RED metrics** — current 5-min request rate, error rate, p50/p90/p99
     latency, sourced from `AWS/ApplicationSignals` namespace via
     `get_metric_data`.
   - **X-Ray trace error rate** — call `query_sampled_traces` (or
     `get_trace_summaries` if available) for the last 5 min on this
     service's name, compute `error_traces / total_traces`. This corroborates
     the App Signals error-rate metric and surfaces sampling-bias gaps. If
     X-Ray returns 0 traces while App Signals shows non-zero requests,
     surface "X-Ray sampling rate may be too low" as a footnote on the
     card.
   - **24h baseline** — same metrics (App Signals + X-Ray trace error rate)
     from the same 5-min window 24h ago.
   - **SLO state** — every SLO configured on this service, with target,
     current attainment, and state (Healthy / Warning / Breach). Sourced via
     `list_slos` + `get_slo`.
   - **Verdict** — derived per the rules below.

4a. **Fallback to raw CloudWatch namespaces** when App Signals data is sparse
    or `get_service` returned empty. For each App-Signals-incomplete service
    whose key attributes can be inferred (function name, API name, cluster
    name), pull RED metrics from the underlying namespace:
    - **Lambda** → `AWS/Lambda` with `FunctionName` dimension: `Invocations`,
      `Errors`, `Duration` (p50, p99), `Throttles`, `ConcurrentExecutions`.
    - **API Gateway** → `AWS/ApiGateway` with `ApiName` (or `ApiId`):
      `Count`, `4XXError`, `5XXError`, `Latency` (p50, p99), `IntegrationLatency`.
    - **ECS** → `AWS/ECS` with `ClusterName` + `ServiceName`: `CPUUtilization`,
      `MemoryUtilization`, plus task-count via `RunningTaskCount`.
    - **EKS / EC2 / RDS** → analogous namespace + dimension mapping (see
      `MCP-TOOL-CONTRACTS.md`).

    Mark the verdict's confidence as `Medium (App Signals fallback)` when this
    path is used.

5. Render the dashboard using the canonical layout below. Each service is
   one card; cards are stacked, sorted by verdict severity (Unhealthy →
   Degraded → Healthy), then by error rate descending within tier.

6. End with a fleet summary line: `<N> services · <H> healthy · <D>
   degraded · <U> unhealthy` and a metadata footer.

## Verdict rules

Same rules as the `service-health-card` skill:

- **🔴 Unhealthy** — error rate >2× baseline OR any SLO in Breach OR p99 >2×
  baseline
- **🟡 Degraded** — any RED metric outside ±20% of baseline OR any SLO in
  Warning
- **🟢 Healthy** — all RED metrics within ±20% of baseline AND no SLO in
  Warning/Breach

If a service has no SLOs configured, the verdict still applies but the SLO
column shows `—` and a footnote: "No SLOs configured."

## Canonical dashboard layout

```markdown
## 🩺 AWS APM Health Check
**Region:** <region> · **Account:** <account> · **As of:** <ISO ts UTC>
**Filter:** `<filter or "all services">` · **Services scanned:** <N>

---

### 🔴 Unhealthy (<count>)

#### `<service-name>`
| Metric | Now (5m) | 24h ago | Δ |
|---|---|---|---|
| Request rate | <r>/s | <r>/s | <±%> |
| Error rate | <%> | <%> | <±pp> |
| p99 latency | <ms> | <ms> | <±%> |

**SLOs:** <slo-name> @ <current>% / target <target>% — **Breach**
**Why unhealthy:** <one-line reason — e.g. "Error rate 4.2% is 14× baseline">
**Investigate:** [`/cw-investigate-slo <service>`] · [`/cw-investigate-errors <service>`]
[Open service in CloudWatch](<deep-link>)

---

### 🟡 Degraded (<count>)

#### `<service-name>`
| Metric | Now (5m) | 24h ago | Δ |
|---|---|---|---|
| ... |

**SLOs:** <slo-name> @ <current>% / target <target>% — **Warning**
**Why degraded:** <one-line reason>
**Investigate:** [`/cw-investigate-latency <service>`]
[Open service in CloudWatch](<deep-link>)

---

### 🟢 Healthy (<count>)

| Service | Req/s | Err % | p99 | SLOs |
|---|---|---|---|---|
| <service> | <r> | <e>% | <ms> | <N> healthy |
| <service> | <r> | <e>% | <ms> | <N> healthy |
| <service> | <r> | <e>% | <ms> | — |

> Healthy services are listed in a compact table — full cards would bury the
> degraded ones.

---

**Fleet summary:** <N> services · 🟢 <H> healthy · 🟡 <D> degraded · 🔴 <U> unhealthy

---
**Source:** `awslabs.cloudwatch-applicationsignals-mcp-server`, `awslabs.cloudwatch-mcp-server` (App Signals + X-Ray)
**Time range:** last 5 min vs same window 24h ago
**Region:** <region> · **Account:** <account>
**MCP tools called:** `list_services`, `get_service`, `list_slos`, `get_slo`, `query_sampled_traces`, `get_metric_data`
**Confidence:** High (live data, no derivation) — capped at Medium when AWS/Lambda or AWS/ApiGateway namespace fallback was used
```

## Rendering rules

- **Unhealthy services get full RED tables. Degraded gets the same. Healthy
  gets a compact one-line-per-service table.** A 50-service fleet rendered
  with 50 full cards is unreadable; the dashboard's job is to surface the
  problems.
- **Sort by severity, not alphabetically.** On-call scans top-to-bottom.
- **Always include `Investigate:` shortcuts** on Unhealthy and Degraded
  cards — the dashboard is a triage surface; the user's next click should
  drop them into the right `/cw-investigate-*` workflow.
- **Deep links go on every card** that gets a card (Unhealthy + Degraded).
  Healthy table rows don't get individual deep links — the metadata footer
  has a single "Open Application Signals dashboard" link covering all.
- **Cap at 50 services** in the rendered output. If the filtered fleet has
  more, render the top 50 by severity and add a footer line: "<N> more
  services not shown — refine filter or use the AWS console."

## Action safety

Read-only. The command only calls `list_services`, `get_service`,
`list_slos`, `get_slo` and supporting metric reads. It never proposes write
actions. If the user wants to act on an unhealthy service, they invoke the
suggested `/cw-investigate-*` command — which has its own confirmation gate
for any write action.

## Examples

```
/cw-health-check
/cw-health-check checkout
/cw-health-check payment-
```

## Empty states and data unavailability

Surface gaps; do not silently render an incomplete dashboard.

**Empty states (UX11)**:

- **No services in region** → "No Application Signals services in
  `<region>`. Confirm region or run `aws-apm-setup`. Dashboard aborted."
- **Filter matches nothing** → "No services match `<filter>` in
  `<region>`. Check spelling or drop the filter."
- **Service has no SLOs** → render the verdict per RED metrics, show `—`
  in the SLO column, and footnote "No SLOs configured" once at the bottom
  of the section rather than per-row.
- **No baseline available** (service is too new) → set the delta cells to
  `—` and note "no 24h baseline" in the verdict reasoning.
- **Wrong region / no permissions** → surface the AWS error verbatim. Do
  not retry silently.

**Data unavailability (UX8)** — render a banner above the dashboard. Per-
row failures appear in a "Status unknown" tier between Degraded and
Healthy with the specific error inline (e.g. `payment-service —
get_service returned AccessDenied`).

## Caching, pagination, and rate limits (Arch7)

Fleet polls fan out reads across many services. Without bounded
concurrency and result caching, the dashboard hits Application Signals
throttle limits and renders a misleading partial picture.

**Bounds and defaults:**

- **Max services in a single render** — 50. If the filtered fleet has
  more, render the top 50 by severity and note "<N> more services not
  shown — refine filter or use the AWS console" at the bottom.
- **Concurrency** — fan out `get_service` / `list_slos` / `get_slo` reads
  at concurrency 10. Bursting 50+ in parallel hits
  `ThrottlingException`.
- **Per-call timeout** — 10s per MCP read.
- **Total command timeout** — 60s. If the dashboard cannot complete in
  60s, render whatever has completed plus a banner.

**Caching:**

- Cache `list_services` for the duration of the run so the per-service
  fan-out reads from a single canonical inventory.
- Cache per-service results so the verdict computation does not re-fetch.
- Do NOT cache across runs.

**Retry and backoff:**

- On `ThrottlingException`, retry once with 2s backoff. After the second
  failure, surface the service in the "Status unknown" tier.
- On `AccessDenied` or `ResourceNotFound`, do NOT retry — propagate to the
  data-unavailable banner immediately.

**Partial results:**

- The dashboard is rendered even if some service fetches failed. Verdict
  counts include only successful reads; a separate "Status unknown" tile
  surfaces failures so completeness is auditable.

## Performance notes

- Cap `get_service` / `get_slo` calls at 10 concurrent. Application Signals
  read APIs are throttled per-account; bursting 50+ in parallel will hit
  `ThrottlingException`.
- If the fleet has >100 services, prefer running this command with a
  filter. The AWS console's Application Signals dashboard is more
  appropriate for unfiltered fleet-wide views.
