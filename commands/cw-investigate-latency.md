---
description: Investigate a latency regression in an AWS Application Signals service and produce a Trace Waterfall Summary artifact
argument-hint: <service-or-operation> [time-window]
allowed-tools: [Read, Bash, Grep]
---

# /cw-investigate-latency

Run the **latency regression** workflow for the given service or operation.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - First arg = service or operation name (required)
   - Second arg = time window (default: last 1 hour, accepts `30m`, `2h`, `6h`, `1d`)
2. If the first arg is missing, ask the user which service or operation to investigate.
3. Activate the `latency-regression` skill and follow its full workflow:
   1. Confirm the regression is real (compare vs 1d / 7d baseline)
   2. Localize: which operation, which dependency contributes most?
   3. Sample 3–5 representative slow traces
   4. Correlate with CloudTrail changes
   5. Rank hypotheses (code change, dependency, capacity, DB, GC, cold start)
4. Produce the **Trace Waterfall Summary** artifact for the worst operation, plus a
   **Service Health Card** if multiple operations are affected, plus **Top Suspected
   Cause** for the ranked hypotheses.
5. Include deep links via `open-in-cloudwatch`.

## Action safety

Read-only. Do not call any write MCP tool without explicit confirmation from the user.

## Examples

```
/cw-investigate-latency checkout-service
/cw-investigate-latency checkout-service 2h
/cw-investigate-latency POST_/orders 30m
```
