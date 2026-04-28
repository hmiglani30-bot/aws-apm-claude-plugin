---
description: Triage an error spike in an AWS Application Signals service and produce a Service Health Card + Top Suspected Cause
argument-hint: <service-name> [time-window]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs.cloudwatch-mcp-server__*"
  - "mcp__awslabs.cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs.cloudtrail-mcp-server__*"
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-investigate-errors

Run the **error spike triage** workflow for the given service.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - First arg = service name (required)
   - Second arg = time window (default: last 30 min, accepts `15m`, `1h`, `2h`)
2. If service name is missing, ask the user which service to investigate.
3. Activate the `error-spike-triage` skill and follow its full 6-phase workflow:
   1. Quantify the spike (rate, customer impact, 4xx vs 5xx)
   2. Localize to top exception classes via Logs Insights — patterns first, raw second
   3. Pull representative failing traces per exception class
   4. Correlate with CloudTrail changes (deploys, IAM, secrets, networking)
   5. Rank hypotheses (bad deploy, downstream, credentials, throttling, bad caller)
   6. Follow dependencies (cascading health check, capped at depth 2)
4. Produce **Service Health Card** + **Top Suspected Cause** as the final artifacts.
5. Surface the Logs Insights query used so the user can rerun / extend it in the console
   via `open-in-cloudwatch`.

## Action safety

Read-only. Confirmation gate before any write action.

## Examples

```
/cw-investigate-errors checkout-service
/cw-investigate-errors checkout-service 1h
```
