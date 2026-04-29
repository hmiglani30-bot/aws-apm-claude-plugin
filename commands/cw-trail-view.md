---
description: View recent CloudTrail events and render them as an intent-shaped hybrid-renderer manifest (timeline, table, or stat-card dashboard)
argument-hint: [time-range] [service-filter] [event-type]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs.cloudtrail-mcp-server__*"
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-trail-view

Fetch recent CloudTrail events and render them via the **hybrid-renderer**
manifest grammar. The user's natural-language prompt determines the layout:
audit log → table-heavy investigation, activity timeline → timeline + table,
"summarize" → stat-card dashboard with sparklines.

The user invoked this with: `$ARGUMENTS`

## Argument parsing

`$ARGUMENTS` is free-form. Extract:

- **time-range** — `15m | 1h | 6h | 24h | 7d` (default `1h`). Also accept
  ISO 8601 ranges like `2026-04-28T12:00Z..2026-04-28T13:00Z`.
- **service-filter** — substring match on `EventSource` (e.g. `s3`,
  `iam.amazonaws.com`, `lambda`). Multiple comma-separated filters allowed.
- **event-type** — one of `read | write | all` (default `write`). Maps to
  `ReadOnly` lookup attribute.

If `$ARGUMENTS` is empty, default to last `1h` of write events across all
services.

## Instructions

1. Verify the `awslabs.cloudtrail-mcp-server` is connected. If not, run the
   `aws-apm-setup` skill.

2. Decide layout intent from the user's prompt (the literal `$ARGUMENTS`
   string and any preceding chat context). Pick **one**:

   | Intent signal in prompt                                  | Layout (`query_intent` tag)        |
   |----------------------------------------------------------|------------------------------------|
   | "show recent API calls", "what happened", "list events"  | `trail-activity-timeline`          |
   | "who changed X", "audit", "find calls by user/principal" | `trail-audit-investigation`        |
   | "summarize", "overview", "dashboard", "how much activity"| `trail-summary-dashboard`          |
   | anything else                                            | `trail-activity-timeline` (default)|

3. Fetch CloudTrail events via the cloudtrail MCP server:
   - For simple lookups, use `lookup_events` with `LookupAttributes`
     derived from the parsed filters (EventSource, EventName, Username,
     ReadOnly).
   - For complex audits across many services, prefer `lake_query` with a
     SQL filter — but only if a CloudTrail Lake event data store is
     configured (`list_event_data_stores` first; if none, fall back to
     `lookup_events` and note the limitation in the artifact subtitle).
   - Cap result count at **200 events**. Page if necessary; stop at 200
     and surface "Truncated at 200 events — narrow the time range or add
     a service filter" in the artifact subtitle.

4. If the user asks about a specific service or event you don't recognise,
   use the `awslabs.aws-documentation-mcp-server` to look up the
   service / event semantics before rendering. Cite the doc URL in the
   relevant widget's description.

5. Activate the `hybrid-renderer` skill and emit a manifest matching the
   chosen layout intent. Layout templates below.

## Layout templates

The renderer picks the shell from widget mix; you pick widgets to match
the intent. **You are not required to use these exact widget sets** — they
are starting points. Vary by what the data actually shows.

### `trail-activity-timeline` — "show me recent API calls"

Widgets, in priority order:

1. `stat_card` — total events in window, with sparkline of per-bucket counts
2. `timeline` — chronological list of the most notable events (errors first,
   then writes, then high-volume principals). Cap at 12 entries.
3. `table` — full event list (timestamp, event_name, principal, source,
   resource, error_code). `searchable: true`, `sortable: true`.
4. `change_event_list` — top 5 deploy / config / iam events as a sidebar
   summary (use `kind` from event classification — see below).

Renderer infers **investigation** shell.

### `trail-audit-investigation` — "who made changes to S3 buckets"

Table-heavy. Widgets:

1. `stat_card` — distinct principals in window, status `neutral`.
2. `stat_card` — write-event count, `unhealthy` if any failed.
3. `table` (priority 1, primary) — rows grouped by principal, with columns
   for principal, role/source-IP, event_count, distinct_resources_touched,
   first_seen, last_seen. Sortable, searchable. This is the centrepiece.
4. `table` — full per-event detail (timestamp, principal, event_name,
   resource_arn, error_code if any).
5. `change_event_list` — IAM-kind events specifically, since audits care
   about permission changes.

Renderer infers **investigation** shell with the audit table dominant.

### `trail-summary-dashboard` — "summarize CloudTrail activity"

Low-density tiles only — renderer infers **dashboard** shell.

1. `stat_card` — total events (with sparkline)
2. `stat_card` — write events (with sparkline, status by error rate)
3. `stat_card` — distinct principals
4. `stat_card` — error/failed-event count, `warning` if >0
5. `sparkline` — events per minute over the window
6. `change_event_list` — top 5 most impactful changes (deploys + IAM)

No `table` widgets — the dashboard intent is "scan in 5 seconds."

## Event classification

For `change_event_list.kind`, classify each CloudTrail event:

- `deploy` — `UpdateFunctionCode`, `CreateDeployment`, ECS `UpdateService`,
  CloudFormation `UpdateStack`, CodeDeploy `*Deployment*`.
- `config` — `Put*`, `Update*`, `Modify*` on configuration resources
  (parameter store, app config, feature flags, env vars).
- `iam` — anything in `iam.amazonaws.com`, plus `AssumeRole`,
  `CreateAccessKey`, `AttachRolePolicy`, `PutBucketPolicy`.
- `infra` — VPC / EC2 / RDS / EKS resource lifecycle (`Create*`, `Delete*`,
  `Modify*`, `Reboot*`).
- `other` — everything else.

If you cannot classify, use `other`. Don't guess.

## Manifest metadata

Every emitted manifest must include:

```json
"metadata": {
  "title": "<intent-appropriate title>",
  "subtitle": "<region> · <event count> events · <time range>",
  "severity": "info | warning | critical",
  "query_intent": "<one of the three tags above>",
  "generated_at": "<ISO 8601 UTC>",
  "region": "<resolved region from .mcp.json>"
}
```

`severity` rule: `critical` if any unauthorized / failed write event,
`warning` if any IAM changes or >10% error rate, otherwise `info`.

## Rendering

Pass the manifest to `renderer/render.js` via the host. The renderer picks
the shell, slots widgets by priority, applies the density budget, and
overflows extras into a "Show N more" drawer. Do **not** hand-author HTML
or pick a Tier-3 template — that's what `hybrid-renderer` is for.

## Action safety

This command is **read-only**. CloudTrail MCP tools called are limited to
`lookup_events`, `lake_query`, `get_query_status`, `get_query_results`,
`list_event_data_stores`. Never call any management-plane tool that would
create, delete, or modify event data stores or trails.

## Examples

```
/cw-trail-view
/cw-trail-view 24h
/cw-trail-view 6h s3
/cw-trail-view 1h iam,lambda write
/cw-trail-view 7d s3 read
```

Prompts that route to different layouts:

- "show me recent API calls in the last hour" → `trail-activity-timeline`
- "who made changes to S3 buckets today" → `trail-audit-investigation`
- "summarize CloudTrail activity for the last 24h" → `trail-summary-dashboard`

## Empty states

- **No events in window** → emit a manifest with one `stat_card` (value 0,
  status `healthy`) plus a `timeline` with an `empty_message` rather than a
  blank artifact. Do not skip rendering.
- **CloudTrail Lake not configured but user asked for SQL-style audit** →
  fall back to `lookup_events` and add a one-line note in the manifest
  subtitle: "Lake not configured — using management-event lookup, last
  90 days max."
- **Region has no CloudTrail trail** → surface the AWS error verbatim and
  point the user at the AWS console to create one. Do not fabricate data.

## Pagination and limits

- `lookup_events` returns ≤50 events per page. Page until 200 events or the
  time window is exhausted, whichever comes first.
- Per-call timeout 10s. Total command budget 60s.
- On `ThrottlingException`, retry once with 2s backoff. After the second
  failure, render the partial result with a banner.
