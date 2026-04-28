---
name: slo-breach-explainer
description: >
  Render the canonical "SLO Breach Explainer" artifact — burn rate, error budget
  remaining, breach window, top impacted operations, correlated deploys, and ranked
  hypotheses, in a fixed visual grammar.
  Trigger phrases: "SLO Breach Explainer", "render SLO breach card", "summarize SLO breach",
  "format SLO breach output", or invoked as the final artifact of `slo-breach-investigation`.
metadata:
  version: "0.1.0"
---

# SLO Breach Explainer (Tier 3 Artifact)

This is a **canonical artifact** — same investigation produces the same shape every time.
Do not reinvent the layout. Fill the known shape with MCP data.

## Required inputs

The parent skill (`slo-breach-investigation`) must have already collected:

- SLO name, target, time window
- Current attainment, error budget remaining (raw + percent)
- Burn rate over 1h / 6h / 24h
- Breach start time + duration
- Top 3 impacted operations with % contribution
- Top 3 correlated CloudTrail events in the breach window
- Ranked hypotheses (use `top-suspected-cause` for that section)

If any of these are missing, do not render — return to the parent skill to gather them.

## Canonical layout

```markdown
## 🚨 SLO Breach Explainer — `<SLO name>`

**Status:** <Fast burn | Slow burn | Recovered, budget depleted>
**Breach started:** <ISO timestamp> (<duration> ago)
**SLO target:** <target>% over <window> · **Current:** <current>%
**Error budget remaining:** <X>% (<raw value> events / minutes)

### Burn rate
| Window | Rate | Multiplier vs normal |
|---|---|---|
| 1h | <rate> | <Nx> |
| 6h | <rate> | <Nx> |
| 24h | <rate> | <Nx> |

> <One-sentence interpretation. e.g.: "1h burn at 28× will exhaust remaining budget in ~6 hours.">

### Top impacted operations
| Operation | Bad events | % of breach | p99 latency | Error rate |
|---|---|---|---|---|
| <op> | <n> | <pct> | <ms> | <%> |
| <op> | <n> | <pct> | <ms> | <%> |
| <op> | <n> | <pct> | <ms> | <%> |

### Correlated changes (CloudTrail, breach window ± 30m)
| Time | Event | Resource | Principal |
|---|---|---|---|
| <ts> | UpdateService | <arn> | <user> |
| <ts> | RegisterTaskDefinition | <arn> | <user> |

### Ranked hypotheses
<insert Top Suspected Cause artifact here>

### Open in CloudWatch
- [SLO detail](<deep-link>)
- [Service map at breach start](<deep-link>)
- [Logs Insights for breach window](<deep-link>)
- [CloudTrail event search](<deep-link>)

---
**Source:** `awslabs.cloudwatch-applicationsignals-mcp-server`
**Time range:** `<start>` → `<end>` (UTC)
**MCP tools called:** `<list_slos>`, `<get_slo>`, `<list_top_contributors>`, `<list_traces>`, `<lookup_events>`
**Queries used:** see Logs Insights deep link above
**Confidence in causal explanation:** <Low | Medium | High>
```

## Visual grammar rules

- **Always lead with status + breach start.** This is the on-call's first question.
- **Burn rate table comes before operations.** Burn rate determines urgency.
- **Operations are ranked by % contribution, not by name.** Top contributor first.
- **Correlated changes table is omitted** if zero CloudTrail events match; replace with a
  one-liner: "No CloudTrail changes in window."
- **Deep links go below content, never inline** — keeps the artifact readable.
- **Metadata footer is mandatory** — this is the trust surface (Q11.2 in the scope).

## What to do if data is incomplete

If burn rate cannot be computed (insufficient samples), say so explicitly in the burn rate
section. Do **not** fabricate values. The footer's `confidence` field exists exactly for
this case.

## Cowork vs Claude Code

In **Cowork** (desktop), prefer rendering as an HTML artifact for richer visuals (sparkline
SVG for burn rate, mini service map). In **Claude Code** (terminal), the Markdown form
above is the default. Both must contain identical data — just different rendering.
