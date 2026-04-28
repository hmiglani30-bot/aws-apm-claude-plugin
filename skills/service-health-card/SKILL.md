---
name: service-health-card
description: >
  Render the canonical "Service Health Card" artifact — RED metrics (rate, errors,
  duration) with SLO context, recent changes, and dependency status, in a fixed
  visual grammar.
  Trigger phrases: "service health card", "summarize service health", "render service status",
  "service overview", "is service X healthy", or invoked as the final artifact of
  `error-spike-triage` and as a secondary artifact for `latency-regression`.
metadata:
  version: "0.1.0"
---

# Service Health Card (Tier 3 Artifact)

Canonical "is this service OK right now?" view.

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
| SLO | Target | Current | Budget remaining | State |
|---|---|---|---|---|
| <slo> | <target>% | <current>% | <budget>% | <Healthy / Warning / Breach> |

> If no SLOs: "No SLOs configured for this service. Recommend: define availability +
> latency SLOs via Application Signals."

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
**Source:** `awslabs.cloudwatch-applicationsignals-mcp-server`, `awslabs.cloudtrail-mcp-server`
**Time range:** last 5 min (current) vs same window 24h ago
**MCP tools called:** `<list_services>`, `<get_service>`, `<list_operations>`, `<lookup_events>`
**Confidence:** <Low | Medium | High>
```

## Verdict rules

- **Healthy** — all RED metrics within ±20% of baseline AND no SLO in Warning/Breach
- **Degraded** — any RED metric outside ±20% of baseline OR any SLO in Warning
- **Unhealthy** — error rate >2× baseline OR any SLO in Breach OR p99 >2× baseline

The verdict is derived deterministically from the data — do not stylize it.

## Visual grammar rules

- **Verdict comes first.** 3am scan should read in 2 seconds.
- **24h baseline is the canonical comparison.** Avoid "vs last week" unless explicitly
  asked — week-over-week catches different problems and isn't appropriate as default.
- **Dependencies table caps at 3.** If the service has more, show top 3 by call volume
  and add a deep link to "see all dependencies."
- **Changes table is omitted** if no events; replace with one-liner.
