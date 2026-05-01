---
description: Triage a fired CloudWatch alarm end-to-end and produce a Service Health Card + Top Suspected Cause artifact
argument-hint: <alarm-name-or-arn>
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs_cloudwatch-mcp-server__*"
  - "mcp__awslabs_cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs_cloudtrail-mcp-server__*"
  - "mcp__awslabs_aws-documentation-mcp-server__*"
---

# /cw-alarm-response

Run the **CloudWatch alarm response** workflow for the given alarm.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - Treat as an alarm name OR full alarm ARN — try ARN first, fall back to name lookup
     in the configured region.
2. If `$ARGUMENTS` is empty, list alarms currently in `ALARM` state via the CloudWatch
   MCP server, then ask the user which one to triage.
3. Activate the `alarm-response` skill and follow its full 5-phase workflow:
   1. Parse alarm details (metric, threshold, service, duration, classification)
   2. Pull current metric values and recent trends (15m / 6h / 24h / 7d)
   3. Correlate with traces and logs for the affected service
   4. Check CloudTrail for recent config / deploy changes in the alarm window ± 30 min
   5. Rank 2–4 hypotheses and recommend a read-only verification step for each
4. Produce **Service Health Card** + **Top Suspected Cause** as the final artifacts,
   each with the metadata footer (source metric, time range, queries, MCP tools called,
   confidence).
5. Include deep links via `open-in-cloudwatch` to the alarm detail, the metric graph,
   and the affected service view.
6. For prose accompanying the artifacts (50–150 word companion text next to each
   widget, or any text-only fallback when data completeness is below 80%), follow
   `skills/hybrid-renderer/references/text-presentation-guide.md` — lead with the
   answer, the 3am test, hard word limits.

## Action safety

This command is **read-only**. Do not call any `Put*`, `Update*`, `Delete*`, `Modify*`,
`Disable*`, or `Start*` MCP tool without an explicit confirmation gate from the user.
For threshold changes or alarm disables, prefer deep-linking to the AWS console.

## Examples

```
/cw-alarm-response checkout-5xx-high
/cw-alarm-response arn:aws:cloudwatch:us-east-1:123456789012:alarm:checkout-p99-latency
/cw-alarm-response checkout-composite-health
```
