# MCP Tool Contracts

The plugin's workflows depend on a specific shape of tools being available from
the four AWS MCP servers. This doc records the **contract** the plugin assumes
for each tool class so:

- Future swapping of an MCP server (e.g. moving from `awslabs.cloudwatch-mcp-server`
  to a remote-hosted variant) can be validated against the same expectations.
- Skill authors know what they can rely on (and what they have to defend against).
- Anyone forking the plugin to wire a different MCP knows which contracts must hold.

This is not API documentation for the underlying AWS APIs — see the
[AWS Application Signals docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Intro.html)
and the [`awslabs/mcp`](https://github.com/awslabs/mcp) source for that. This is
the boundary between the plugin's orchestration layer and the data-access layer.

## Contract structure

Every required tool has a contract with six parts:

1. **Name** — the MCP tool identifier the skill calls.
2. **Input** — required and optional parameters, with types and units.
3. **Output** — the shape and units the skill expects in the response.
4. **Failure modes** — what the skill must handle gracefully (timeouts,
   throttling, missing data, ambiguous results).
5. **Pagination** — whether the response can exceed a single page and how the
   skill must iterate.
6. **Permissions** — minimum IAM the underlying API requires.

If a tool deviates from a contract, the skill that depends on it MUST detect the
deviation and either fall back or stop with a structured error. Skills MUST NOT
assume newer MCP behavior than the contract describes.

## Service / SLO discovery (Application Signals)

### `list_services`

| | |
|---|---|
| **Name** | `awslabs.cloudwatch-applicationsignals-mcp-server.list_services` (or equivalent) |
| **Input** | `region` (string), `time_window` (start/end ISO-8601, optional — defaults to last 24h) |
| **Output** | Array of `{name, namespace, type, key_attributes}`. Empty array if Application Signals is enabled but no services have reported. |
| **Failure modes** | (a) Application Signals not enabled in region → structured error referencing the setup skill. (b) IAM denied → structured error naming the missing permission. (c) Region typo → empty array, NOT error. |
| **Pagination** | Yes. Iterate until `next_token` is null. The skill MUST iterate; truncating to first page hides services. |
| **Permissions** | `application-signals:ListServices` |

### `get_service_level_objective`

| | |
|---|---|
| **Name** | `awslabs.cloudwatch-applicationsignals-mcp-server.get_slo` (or equivalent) |
| **Input** | `slo_id` or `(service_name, slo_name)`, `time_window` |
| **Output** | `{attainment, error_budget_remaining_seconds, burn_rate, threshold, period}`. Burn rate normalized to 1.0 = exactly meeting the budget. |
| **Failure modes** | (a) SLO not found → structured error. (b) Time window outside retention → empty / null fields, NOT error. (c) Multiple SLOs match → return all and let skill rank. |
| **Pagination** | No. |
| **Permissions** | `application-signals:GetServiceLevelObjective` |

### `list_service_operations`

| | |
|---|---|
| **Input** | `service_name`, `time_window` |
| **Output** | Array of `{operation, request_count, error_count, fault_count, p50_ms, p99_ms, availability}`. Sorted by request volume desc. |
| **Failure modes** | Empty array if service has no traffic in the window. |
| **Pagination** | Yes. Iterate to completion before the skill ranks contributors. |
| **Permissions** | `application-signals:ListServiceOperations` |

### `get_top_contributors`

| | |
|---|---|
| **Input** | `slo_id`, `time_window` |
| **Output** | Array of `{operation, contribution_pct, error_count, p99_ms, sample_trace_ids[]}`. Sum of `contribution_pct` ≤ 100. |
| **Failure modes** | Empty array if SLO is not currently breaching (the API should still return contributors, but the skill must handle empty). |
| **Pagination** | Optional. The skill should treat the first page as authoritative for ranking. |
| **Permissions** | `application-signals:GetTopContributors`, `xray:GetTraceSummaries` |

## Metric retrieval (CloudWatch)

### `get_metric_data`

| | |
|---|---|
| **Name** | `awslabs.cloudwatch-mcp-server.get_metric_data` |
| **Input** | `metric_data_queries[]` (each has `id`, `metric_stat`, `period_seconds`), `start_time`, `end_time`, optional `scan_by` |
| **Output** | Per-query `{timestamps[], values[], status}`. Timestamps in UTC, ISO-8601. Periods MUST match what was requested. |
| **Failure modes** | (a) Period < retention floor for old data → empty `values`, NOT error. (b) Throttled → MCP retries with backoff; skill retries if MCP returns retryable error. (c) Math expression error in query → status=`ProblemFound` with message. |
| **Pagination** | No (response is bounded by 1440 datapoints per query). |
| **Permissions** | `cloudwatch:GetMetricData` |

### `describe_alarms`

| | |
|---|---|
| **Input** | `alarm_names[]` or `alarm_name_prefix`, `state_value` (optional) |
| **Output** | Array of alarm objects with current state, threshold, dimensions, actions. |
| **Failure modes** | Empty array if no match — NOT error. |
| **Pagination** | Yes. |
| **Permissions** | `cloudwatch:DescribeAlarms` |

## Log retrieval (CloudWatch Logs Insights)

### `start_query` / `get_query_results`

| | |
|---|---|
| **Input (start)** | `log_group_names[]` (or `log_group_identifier_pattern`), `start_time`, `end_time`, `query_string` (Logs Insights syntax) |
| **Output (start)** | `{query_id}` |
| **Input (results)** | `query_id` |
| **Output (results)** | `{status: Running|Complete|Failed|Cancelled|Timeout, results[][], statistics}`. Results are `[{field, value}]` pairs per row. |
| **Failure modes** | (a) Polling required — skill MUST poll status, NOT block-wait. (b) `Timeout` is a normal terminal state for slow queries — skill MUST treat as best-effort partial result. (c) Log group not found in any account → empty results. |
| **Pagination** | Insights returns up to 10,000 rows per query. The skill should write queries that aggregate / limit. |
| **Permissions** | `logs:StartQuery`, `logs:GetQueryResults`, `logs:DescribeLogGroups` |

## Trace retrieval (X-Ray)

### `get_trace_summaries`

| | |
|---|---|
| **Input** | `start_time`, `end_time`, `filter_expression` (X-Ray filter syntax), `sampling` (boolean) |
| **Output** | Array of trace summaries with `{trace_id, duration_ms, http_status, root_cause, error_root_cause, fault_root_cause, response_time_root_cause}`. |
| **Failure modes** | Empty array if no traces match — NOT error. Filter syntax error → structured error. |
| **Pagination** | Yes. Iterate up to a skill-defined cap (typically 100 traces) to avoid runaway cost. |
| **Permissions** | `xray:GetTraceSummaries` |

### `batch_get_traces`

| | |
|---|---|
| **Input** | `trace_ids[]` (max 5 per call) |
| **Output** | Array of full traces with all segments and subsegments. |
| **Failure modes** | Trace expired (>30 days) → omitted from response, NOT error. |
| **Pagination** | Yes — chunk the trace_ids array. |
| **Permissions** | `xray:BatchGetTraces` |

## Audit trail (CloudTrail)

### `lookup_events`

| | |
|---|---|
| **Input** | `start_time`, `end_time`, `lookup_attributes[]` (event source / event name / resource name / username), `event_category` (optional) |
| **Output** | Array of events with `{event_time, event_name, event_source, username, resources[], request_parameters_json}`. Sorted by event_time desc. |
| **Failure modes** | (a) Outside retention (typically 90 days for management events, configurable for data events) → empty. (b) IAM denied → structured error. |
| **Pagination** | Yes. Iterate to completion when the skill is correlating a small window (≤ 1h) of changes. |
| **Permissions** | `cloudtrail:LookupEvents` |

## Documentation lookup

### `search_documentation`

| | |
|---|---|
| **Name** | `awslabs.aws-documentation-mcp-server.search_documentation` |
| **Input** | `query` (string), `service` (optional) |
| **Output** | Array of `{title, url, snippet, last_updated}`. |
| **Failure modes** | Empty array, NOT error, when nothing matches. |
| **Pagination** | First page is authoritative for skill use. |
| **Permissions** | None — public docs. |

## Time-window contract

Every retrieval tool above accepts a `(start_time, end_time)` pair. The plugin's
**time-window invariant** says that all calls within a single investigation
phase use the same window (computed once from the user prompt or the alarm's
state-transition time). See [ARCHITECTURE.md](ARCHITECTURE.md#time-window-propagation).

If a tool returns data outside the requested window, the skill MUST filter to
the window before ranking. If a tool returns datapoints with a different
period than requested (e.g. CloudWatch falls back from 1m to 5m for old data),
the skill MUST surface that period in the artifact's metadata footer.

## Write Action Contracts

Write-action tools mutate AWS resources. Every write tool is **Tier 4** (see
[ACTION-SAFETY-MODEL.md](ACTION-SAFETY-MODEL.md)) and gated by the `PreToolUse`
hook — the plugin MUST surface a confirmation prompt to the user before execution.
Skills MUST NOT call these tools speculatively or in a loop without per-call
confirmation.

### `put_metric_alarm`

| | |
|---|---|
| **Name** | `awslabs.cloudwatch-mcp-server.put_metric_alarm` (or equivalent) |
| **Input** | `alarm_name` (string, required), `namespace` (string, required), `metric_name` (string, required), `dimensions[]` (array of `{name, value}`, optional), `statistic` (string — `SampleCount\|Average\|Sum\|Minimum\|Maximum`, required unless `extended_statistic` given), `period` (integer seconds, required — must be 10, 30, or multiple of 60), `evaluation_periods` (integer, required), `datapoints_to_alarm` (integer, optional — defaults to `evaluation_periods`), `threshold` (number, required), `comparison_operator` (string — `GreaterThanOrEqualToThreshold\|GreaterThanThreshold\|LessThanThreshold\|LessThanOrEqualToThreshold\|LessThanLowerOrGreaterThanUpperThreshold\|LessThanLowerThreshold\|GreaterThanUpperThreshold`, required), `treat_missing_data` (string — `breaching\|notBreaching\|ignore\|missing`, optional — defaults to `missing`), `alarm_actions[]` (array of SNS topic ARNs, optional), `ok_actions[]` (array of SNS topic ARNs, optional), `tags[]` (array of `{key, value}`, optional) |
| **Output** | `{alarm_arn}` — the ARN of the created or updated alarm. |
| **Failure modes** | (a) `ValidationError` — invalid parameter combination (e.g. period not a multiple of 60, missing required fields). (b) `LimitExceededFault` — account alarm limit reached (default 5,000 per region). (c) `ResourceNotFound` — an SNS topic ARN in `alarm_actions` or `ok_actions` does not exist or is not accessible. |
| **Pagination** | N/A — single-resource write. |
| **Permissions** | `cloudwatch:PutMetricAlarm`. Additionally `sns:GetTopicAttributes` if `alarm_actions` or `ok_actions` are specified (CloudWatch validates the topic exists). |
| **Safety** | Tier 4. PreToolUse hook gated. **Create-only by default** — if an alarm with the given name already exists, the skill MUST detect this (via `describe_alarms`) and surface an explicit overwrite confirmation to the user before proceeding. The skill MUST NOT silently overwrite existing alarms. |

### `tag_resource`

| | |
|---|---|
| **Name** | `awslabs.cloudwatch-mcp-server.tag_resource` (or equivalent) |
| **Input** | `resource_arn` (string, required — the ARN of the CloudWatch resource to tag), `tags[]` (array of `{key, value}` pairs, required — at least one tag) |
| **Output** | `{success: true}` on success. No additional payload. |
| **Failure modes** | (a) `ResourceNotFoundException` — the ARN does not reference an existing CloudWatch resource. (b) `InvalidParameterValueException` — tag key/value violates constraints (key max 128 chars, value max 256 chars, reserved `aws:` prefix, max 50 tags per resource). (c) `ConcurrentModificationException` — another process modified the resource's tags simultaneously; safe to retry once. |
| **Pagination** | N/A — single-resource write. |
| **Permissions** | `cloudwatch:TagResource` |
| **Safety** | Tier 4. PreToolUse hook gated. **Idempotent** — re-tagging with the same key overwrites the value; the skill may call this without checking existing tags first. The skill SHOULD surface the tag diff to the user before execution. |

## Versioning

When a contract here changes (input added, output field added, pagination
behavior changed), bump the plugin minor version and document the contract
diff in the changelog. Skill authors should treat any new field as opt-in:
read it if present, do not require it.

If an MCP server drops a tool the plugin depends on, that is a breaking change
for any skill calling it. The plugin's structural tests do not currently
cross-check live MCP capabilities — that's a roadmap item.

## Related

- [ARCHITECTURE.md](ARCHITECTURE.md) — orchestration / data-access split, context
  provider, time-window invariant.
- [ACTION-SAFETY-MODEL.md](ACTION-SAFETY-MODEL.md) — how write-verb tools are
  gated by the PreToolUse hook regardless of which MCP exposes them.
- [SECURITY.md](SECURITY.md) — minimum IAM policies per tool class.
