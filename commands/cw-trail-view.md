---
description: Query CloudTrail events over the last 7 days and render an interactive HTML timeline visualization
argument-hint: [event-source=...] [username=...] [event-name=...] [resource-type=...]
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - "mcp__awslabs.cloudtrail-mcp-server__*"
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-trail-view

Query CloudTrail management events for the **last 7 days** (the API limit for
`LookupEvents`) and render an interactive HTML timeline.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS` as space-separated `key=value` pairs. All filters are
   optional — if none are given, query *all* events for the last 7 days. Recognised
   keys (map to `LookupEvents` `LookupAttributes`):
   - `event-source` → `EventSource` (e.g. `iam.amazonaws.com`, `s3.amazonaws.com`)
   - `username` / `principal` → `Username`
   - `event-name` → `EventName` (e.g. `ConsoleLogin`, `RunInstances`)
   - `resource-type` → `ResourceType` (e.g. `AWS::IAM::Role`, `AWS::S3::Bucket`)
   - `resource-name` → `ResourceName`

   Unknown keys → ask the user to clarify rather than guessing.

2. Activate the `cloudtrail-explorer` skill and follow its workflow:
   1. Resolve filters and time window (now − 7d → now, UTC).
   2. Call `mcp__awslabs.cloudtrail-mcp-server__lookup_events` (paginating until
      `NextToken` is empty or a sane page cap is hit).
   3. Compute summary stats: total events, unique principals, unique event sources,
      time range actually covered.
   4. Populate `artifacts/cloudtrail-timeline.html` with the events as a JSON
      payload and render the artifact.

3. Hand off the populated HTML file path to the user. Do not auto-open it.

## Action safety

This command is **read-only**. It only calls `lookup_events`. Never call any
`Put*`, `Update*`, `Delete*`, `Modify*`, or `Start*` MCP tool. The plugin's
PreToolUse hook fails closed on state-changing CloudTrail calls.

If the user asks for a window longer than 7 days, explain the API limit and
suggest CloudTrail Lake (`lake_query`) as the alternative — but do not silently
substitute it.

## Examples

```
/cw-trail-view
/cw-trail-view event-source=iam.amazonaws.com
/cw-trail-view username=alice@example.com event-name=ConsoleLogin
/cw-trail-view resource-type=AWS::S3::Bucket
/cw-trail-view event-source=ec2.amazonaws.com event-name=RunInstances
```
