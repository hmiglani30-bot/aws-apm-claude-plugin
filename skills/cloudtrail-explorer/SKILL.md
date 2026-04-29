---
name: cloudtrail-explorer
description: >
  Query CloudTrail management events for the last 7 days (the LookupEvents API
  limit) with optional filters (event source, username/principal, event name,
  resource type/name) and render an interactive HTML timeline artifact with
  per-source color coding, client-side search/filter, collapsible event details,
  and summary stats.
  Trigger phrases: "cloudtrail timeline", "show cloudtrail events", "trail view",
  "cloudtrail explorer", "visualize cloudtrail", "audit timeline", "who did what",
  "iam activity", "console logins", "recent api calls", "cloudtrail filter",
  "explore cloudtrail", "render cloudtrail", "cloudtrail dashboard",
  or any request to browse / visualize raw CloudTrail events over a recent
  window.
metadata:
  version: "0.1.0"
---

# CloudTrail Explorer

Pull CloudTrail management events using `LookupEvents` and render them as an
interactive HTML timeline. This is a *browse / explore* skill, not an
investigation skill — it does not rank hypotheses, correlate with metrics, or
produce a verdict. Use the investigation skills (`alarm-response`,
`error-spike-triage`, `slo-breach-investigation`) when you need a root-cause
artifact.

## When this activates

- A user wants to *see* what API calls happened recently — IAM changes, console
  logins, S3 bucket policy edits, EC2 instance launches.
- A user pastes a username, role ARN, or event source and wants the full
  recent history.
- A user is preparing for a security review or audit and needs a visual
  timeline rather than raw JSON.

If the goal is to correlate a deploy with an outage, prefer `alarm-response`
or `error-spike-triage` — those skills already query CloudTrail in their
correlation phase.

## Required MCP servers

- `awslabs.cloudtrail-mcp-server` — `lookup_events` for the management-event
  history. CloudTrail Lake (`lake_query`) is the fallback for windows longer
  than 7 days; this skill does not use it.

If the MCP server is not connected, run the `aws-apm-setup` skill before
continuing.

## API limits and time window

`LookupEvents` covers the last **90 days** of management events but most use
cases scope to the last 7 days for a manageable payload. This skill defaults
to the last 7 days. The user can narrow further by passing a tighter
`StartTime` / `EndTime` via filters, but the skill does NOT query beyond 7
days unless the user explicitly asks — at which point recommend CloudTrail
Lake.

## Workflow

### Phase 1 — Parse filters

Accept `key=value` pairs from the slash-command arguments (or from natural
language if invoked conversationally). Map to `LookupAttributes`:

| Argument key | LookupAttributeKey | Example value |
|---|---|---|
| `event-source` | `EventSource` | `iam.amazonaws.com` |
| `username` / `principal` | `Username` | `alice@example.com` |
| `event-name` | `EventName` | `ConsoleLogin` |
| `resource-type` | `ResourceType` | `AWS::IAM::Role` |
| `resource-name` | `ResourceName` | `prod-deploy-role` |

`LookupEvents` accepts **at most one** `LookupAttribute` per call. If the user
provides two compatible filters (e.g. `event-source` + `event-name`), pick the
most selective one for the API call and apply the rest client-side after
events return. Tell the user which filter was server-side vs client-side.

If no filter is given, call `lookup_events` with no `LookupAttributes` —
returns all events in the window.

### Phase 2 — Query CloudTrail

1. Call `mcp__awslabs.cloudtrail-mcp-server__lookup_events` with:
   - `StartTime`: now − 7d (ISO 8601, UTC)
   - `EndTime`: now (UTC)
   - `LookupAttributes`: from Phase 1 (or omit)
   - `MaxResults`: 50 per page
2. Paginate via `NextToken` until empty OR the running total reaches 1000
   events. If capped, surface "Showing first 1000 events; narrow the filter
   for a complete view."
3. Apply any client-side filters from Phase 1 to the paginated results.

### Phase 3 — Compute summary stats

Across the returned events:
- **Total events**
- **Unique principals** — distinct `Username` values (fall back to
  `UserIdentity.arn` if `Username` is empty)
- **Unique event sources** — distinct `EventSource` values
- **Time range covered** — earliest → latest `EventTime` in the result set
- **Top 5 event names** — by count
- **Top 5 principals** — by count

Use these for the summary header row.

### Phase 4 — Shape the event payload

For each event, extract a compact record (drop the verbose `CloudTrailEvent`
JSON unless the user expanded it):

```json
{
  "id": "{{EventId}}",
  "time": "{{EventTime ISO 8601 UTC}}",
  "source": "{{EventSource}}",
  "name": "{{EventName}}",
  "username": "{{Username || UserIdentity.arn || 'unknown'}}",
  "region": "{{AwsRegion}}",
  "resources": [{ "type": "...", "name": "..." }, ...],
  "errorCode": "{{ErrorCode || null}}",
  "raw": "{{full CloudTrailEvent JSON, redacted}}"
}
```

Sort newest-first.

### Phase 5 — Render the artifact

1. Read `artifacts/cloudtrail-timeline.html`.
2. Replace placeholders:
   - `{{GENERATED_AT}}` — current UTC ISO timestamp
   - `{{AWS_REGION}}` — region from context (or "all regions" if none set)
   - `{{TIME_RANGE_START}}` / `{{TIME_RANGE_END}}` — UTC ISO bounds
   - `{{FILTERS_APPLIED}}` — human-readable filter summary or "None — all events"
   - `{{TOTAL_EVENTS}}`, `{{UNIQUE_PRINCIPALS}}`, `{{UNIQUE_SOURCES}}`
   - `{{EVENTS_JSON}}` — the JSON array from Phase 4 (HTML-safe)
   - `{{LINK_CLOUDTRAIL_CONSOLE}}` — deep link to CloudTrail event history
     in the AWS console for the same filter (use `open-in-cloudwatch` patterns
     for the URL builder)
   - `{{SOURCE_MCP_SERVERS}}` — `awslabs.cloudtrail-mcp-server`
   - `{{MCP_TOOLS_LIST}}` — `lookup_events`
   - `{{PAGINATION_NOTE}}` — empty unless the 1000-event cap was hit
3. Write the populated HTML to a path like
   `artifacts/cloudtrail-timeline-{{YYYYMMDD-HHMMSS}}.html` (do not overwrite
   the template) and tell the user the file path.

## Color coding by event source

The artifact CSS handles this — each event card carries a `data-source` attribute
and the stylesheet maps known sources to colors. Make sure the data attribute
matches the source string exactly (lowercased, no `.amazonaws.com` stripped):

| Source | Color | Notes |
|---|---|---|
| `iam.amazonaws.com` | Blue (#539fe5) | identity / access |
| `sts.amazonaws.com` | Yellow (#ffd166) | role assumption |
| `ec2.amazonaws.com` | Orange (#ffa552) | compute |
| `s3.amazonaws.com` | Green (#6aaf3f) | storage |
| `monitoring.amazonaws.com` | Purple (#b07dff) | CloudWatch |
| `logs.amazonaws.com` | Purple (#b07dff) | CloudWatch Logs |
| `lambda.amazonaws.com` | Teal (#3ed4c4) | functions |
| `signin.amazonaws.com` | Yellow (#ffd166) | console login |
| `cloudtrail.amazonaws.com` | Gray (#95a5b8) | self-events |
| (unknown) | Light gray (#7c8ba0) | fallback |

The HTML/CSS in the template owns the actual rendering; this skill only needs
to pass through the raw `EventSource` so the stylesheet can match.

## Redaction

Before writing event payloads into the HTML, **redact**:
- Auth tokens, API keys, session tokens, JWTs in `requestParameters` /
  `responseElements` → `<redacted-token>`
- Email addresses in user-identifier contexts → `<redacted-user>`
- IP addresses outside service-internal contexts → `<redacted-ip>`
- Any `kms` / `secretsmanager` / `ssm` parameter values

Redact the raw `CloudTrailEvent` JSON included for the collapsible "raw"
section, not just the top-level fields.

## Empty states

- **No events match the filter** → render the artifact with the summary tiles
  showing zeros and an empty-state message in the timeline body: "No events
  matched the filter in the last 7 days. Try widening the filter or removing
  it."
- **Filter syntactically invalid** → ask the user before querying. Do not
  send a malformed `LookupAttribute`.
- **CloudTrail not enabled in region** → `lookup_events` returns empty plus
  the API may include a region-not-configured hint. Surface: "CloudTrail may
  not be capturing management events in `<region>`. Check trail status."
- **AccessDenied on `LookupEvents`** → render a data-unavailable banner with
  the IAM action that's missing (`cloudtrail:LookupEvents`) and exit.

## Action safety

**Read-only.** This skill only calls `lookup_events`. No `Put*`, `Update*`,
`Delete*`, `Modify*`, `Start*`, `Stop*`, `Create*`, or `Remove*` calls. If
the user asks for a write action (e.g. "delete the trail", "stop logging"),
refuse via the structured approval block and prefer deep-linking to the
console.

## What this skill does NOT do

- Does not correlate events with metrics, traces, or alarms — use
  `alarm-response` / `error-spike-triage` for that.
- Does not query data events (S3 object-level, Lambda invoke) — those require
  CloudTrail Lake or a data-events trail.
- Does not query beyond 7 days — recommend `lake_query` instead.
- Does not rank events by suspicion or produce a security verdict — this is a
  browser, not an analyzer.
