---
description: Investigate an AWS Application Signals SLO breach end-to-end and produce an SLO Breach Explainer artifact
argument-hint: [service-name-or-slo-name]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs_cloudwatch-mcp-server__*"
  - "mcp__awslabs_cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs_cloudtrail-mcp-server__*"
  - "mcp__awslabs_aws-documentation-mcp-server__*"
---

# /cw-investigate-slo

Run the full **SLO breach investigation** workflow for the given service or SLO.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. If `$ARGUMENTS` is empty, list current breaching SLOs first via the Application
   Signals MCP server, then ask the user which one to investigate.
2. Otherwise treat `$ARGUMENTS` as a service name OR SLO name and resolve it:
   - First try as an SLO name
   - Fall back to "all SLOs on this service"
3. Activate the `slo-breach-investigation` skill and follow its full 6-phase workflow:
   1. Frame the breach (burn rate, error budget, breach start)
   2. Localize impact (top contributing operations)
   3. Pull representative traces
   4. Correlate with CloudTrail changes
   5. Rank root-cause hypotheses
   6. Follow dependencies (cascading health check, capped at depth 2)
4. Produce the **SLO Breach Explainer** artifact as the final output, including the
   metadata footer (source metric, time range, queries, MCP tools called, confidence).
5. Surface deep links into the AWS console via the `open-in-cloudwatch` skill.
6. For prose accompanying the artifact (50–150 word companion text next to each
   widget, or any text-only fallback when data completeness is below 80%), follow
   `skills/hybrid-renderer/references/text-presentation-guide.md` — lead with the
   answer, the 3am test, hard word limits.

## Action safety

This command is **read-only**. Do not call any `Put*`, `Update*`, `Delete*`, `Modify*`,
or `Start*` MCP tool without an explicit confirmation gate from the user. Prefer
deep-linking to the AWS console for destructive or billing-impacting actions.

## Examples

```
/cw-investigate-slo
/cw-investigate-slo checkout-service
/cw-investigate-slo checkout-availability-slo
```
