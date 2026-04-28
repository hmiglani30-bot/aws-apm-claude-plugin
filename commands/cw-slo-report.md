---
description: Produce a portfolio-wide SLO compliance report — every SLO across every service, ranked by risk, with recommendations
argument-hint: [time-window]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs.cloudwatch-mcp-server__*"
  - "mcp__awslabs.cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs.cloudtrail-mcp-server__*"
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-slo-report

Run the **SLO compliance report** workflow across every Application Signals service in
the configured region.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - First arg = time window (default: last 7 days, accepts `1d`, `7d`, `14d`, `30d`)
   - If `$ARGUMENTS` is empty, use the default 7-day window.
2. Activate the `slo-compliance-report` skill and follow its full 5-phase workflow:
   1. List all SLOs across all services in the region
   2. Calculate compliance status for each (attainment, budget, 1h / 6h / 24h burn)
   3. Rank services by risk (closest to breach by time-to-exhaustion)
   4. Produce the **SLO Compliance Report** dashboard artifact
   5. Generate concrete recommendations for each at-risk SLO
3. If any SLO is *Breaching with fast burn*, surface a one-line callout above the
   dashboard headline pointing the user to `/cw-investigate-slo <slo-name>`.
4. Include deep links via `open-in-cloudwatch` to the Application Signals SLO list and
   service map.

## Action safety

This command is **read-only**. The workflow only enumerates SLO state — no write
actions are in scope. Tuning or decommissioning SLOs is surfaced as a recommendation
with a console deep link, never executed automatically.

## Examples

```
/cw-slo-report
/cw-slo-report 7d
/cw-slo-report 30d
```
