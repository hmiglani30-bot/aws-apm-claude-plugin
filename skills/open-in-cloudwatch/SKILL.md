---
name: open-in-cloudwatch
description: >
  Generate AWS CloudWatch console deep links that preserve service / operation /
  time range / filters. Embedded in every other artifact component. The plugin's
  smart-front-door primitive — never replaces the console.
  Trigger phrases: "open in CloudWatch", "deep link to console", "link to CloudWatch",
  "console URL for this", or invoked by every other Tier 3 artifact component.
metadata:
  version: "0.1.0"
---

# Open in CloudWatch (Deep-Link Primitive)

Every Tier 3 artifact embeds these. The framing (Q13 in the scope): *Claude is the smart
front door to CloudWatch, not a replacement.*

## Context provider

Deep links are parameterized from context provider fields:

- `context.service` -- substituted into service detail and operation detail URLs
- `context.region` -- substituted into all URL templates as `<region>`
- `context.slo` -- substituted into SLO detail URL as `<slo-id>`
- `context.alarm` -- substituted into alarm detail URL as `<alarm-name>`
- `context.time_window.start` / `.end` -- substituted as `<iso-start>` / `<iso-end>` in time-scoped URLs

## MCP tool dependencies

None -- this skill generates URLs from context data. It does not call MCP tools.

## URL templates

All URLs assume the user's current AWS region (`AWS_REGION` env from `.mcp.json`). When
generating, substitute the region from the MCP server's environment.

### Application Signals — service detail
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#application-signals:services/<service-name>
```

### Application Signals — service map
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#application-signals:service-map?timeRange=<iso-start>~<iso-end>
```

### Application Signals — SLO detail
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#application-signals:slo/<slo-id>
```

### Application Signals — operation detail
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#application-signals:services/<service>/operations/<operation>?timeRange=<iso-start>~<iso-end>
```

### Logs Insights — preloaded query
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#logsV2:logs-insights$3FqueryDetail$3D~(end~<iso-end>~start~<iso-start>~timeType~'ABSOLUTE~tz~'UTC~editorString~'<urlencoded-query>~queryId~''~source~(~'<log-group>))
```
URL-encode the query before substitution.

### CloudWatch Alarms — alarm detail
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#alarmsV2:alarm/<alarm-name>
```

### CloudWatch Metrics — metric explorer with metric math
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#metricsV2:graph=<base64-graph-spec>
```
The graph spec is a base64'd JSON describing metrics + period + stat. Build it from the
metric IDs and time range collected during investigation.

### Trace detail
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#xray:traces/<trace-id>
```

### CloudTrail — event lookup
```
https://<region>.console.aws.amazon.com/cloudtrail/home?region=<region>#/events?StartTime=<iso-start>&EndTime=<iso-end>&LookupAttributes=<attr>
```

### Container Insights — cluster
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#container-insights:performance/<cluster-name>
```

### Database Insights — DB instance
```
https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#database-insights:resource/<resource-id>
```

## Rendering rules

- **Always include the time range** — never link to a "now" view; observability links go
  stale fast and the user needs the breach window preserved.
- **Bullet list with descriptive anchor text**, not bare URLs:
  ```markdown
  - [SLO detail — checkout-availability](<url>)
  - [Service map at breach start (14:23–14:53 UTC)](<url>)
  ```
- **Region must match** the MCP server's configured `AWS_REGION`. If multiple regions are
  involved (cross-region service map), generate one link per region.
- **Group by category** when more than 4 links: SLO, Service map, Logs, Traces, CloudTrail.

## Anti-patterns

- ❌ Linking to a "now" view without time range — user clicks 10 min later, sees nothing.
- ❌ Pointing to the AWS console root and asking the user to navigate.
- ❌ Hard-coding `us-east-1` instead of reading the configured region.
- ❌ Generating a Logs Insights URL without URL-encoding the query (breaks the link).
