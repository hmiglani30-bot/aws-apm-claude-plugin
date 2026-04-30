# Skill Improvements Log

**Date:** 2026-04-29
**Scope:** All 19 skills in `skills/*/SKILL.md`
**Reference:** `eval-analysis.pdf` Section 3.1 (improvement areas) and Section 3.2 (weakness rankings)

---

## Phase 1: Full Rewrites (5 Weakest Skills)

### 1. `service-ownership` (v0.1.0 -> v0.2.0)

**Eval rank:** #1 weakest (no MCP tool call sequence, no examples, no fallback chain, no context provider)

Changes:
- Added `## Context provider` section with all relevant context fields (`context.service`, `context.region`, `context.account`, `context.environment`, `context.data_sources_available`)
- Added `## MCP tool dependencies` section listing `list_services`, `list_tags_for_resource`
- Added explicit MCP tool call sequence for AWS resource tag resolution (3-step sequence with example)
- Added 6 ownership sources in priority order with per-source call patterns
- Added confidence rule (High/Medium/Low/Unknown with exact criteria)
- Added error handling table (7 error scenarios with detect + behavior columns)
- Added 2 few-shot examples: rich ownership data (3 sources agree) and no ownership data (all sources empty)
- Added empty states section
- Added Mode A (inline) and Mode B (standalone) output structures

### 2. `copy-to-incident` (v0.1.0 -> v0.2.0)

**Eval rank:** #2 weakest (no context provider, no MCP tool calls, no format delimiters, no incomplete-data handling)

Changes:
- Added `## Context provider` section
- Added explicit required inputs section with data extraction guidance from investigation artifacts
- Added output format specification with `---BEGIN/END---` delimiters for all 5 formats
- Added per-format required fields (Slack: 6 lines, IC: 5 sections, Customer: 3 variants, Postmortem: pre-fill vs fill-in, Exec: 4-element structure)
- Added error handling table (6 conditions with behavior)
- Added 2 few-shot examples: full data (SEV2 active incident) and incomplete data (missing fields shown as `<fill in>`)
- Added explicit "do NOT include" and "Rules" for each format

### 3. `incident-memory` (v0.1.0 -> v0.2.0)

**Eval rank:** #3 weakest (no MCP tool calls for pre-investigation read, no glob pattern, no recurrence detection algorithm)

Changes:
- Added `## Context provider` section
- Added `## MCP tool dependencies` (None -- uses local filesystem)
- Added explicit glob pattern for incident file lookup: `.aws-apm/incidents/*_<service-name-lowercased>*.json`
- Added step-by-step pre-investigation read procedure (4 steps: resolve/glob, read/sort, recurrence detection, render table)
- Added recurrence detection algorithm with MATCH / WEAK MATCH criteria
- Added field-to-source mapping table for post-investigation write (12 fields with their source)
- Added first-write opt-in procedure with sentinel file check (`.aws-apm/incidents/.opted-in`)
- Added incident summary JSON schema with all required and optional fields
- Added error handling table (7 error scenarios)
- Added 2 few-shot examples: pre-investigation recurrence detected and post-investigation write

### 4. `trace-to-code` (v0.1.0 -> v0.2.0)

**Eval rank:** #4 weakest (no MCP tool call sequence for trace retrieval, no span-to-code resolution example, no wrong-repo handling)

Changes:
- Added `## Context provider` section with `context.data_sources_available.xray` check
- Added `## MCP tool dependencies` listing `batch_get_traces`, `get_trace_summaries`, `start_query`, `get_query_results`
- Added explicit MCP tool call sequences for Phase 1 (trace ID path and span name path)
- Added per-span JSON extraction format with annotation_level tagging (annotated/partially annotated/opaque)
- Added 4-priority search strategy for span-to-code mapping (exact code attribute, OTel instrumentation string, HTTP/RPC handler, exception class)
- Added per-span output format with confidence levels (High/Medium/Low)
- Added git log command template for commit correlation
- Added instrumentation gap fix table (3 gap types with language-specific fix snippets)
- Added 5-element fix plan structure
- Added validation query commands
- Added error handling table (7 error scenarios)
- Added 2 few-shot examples: annotated spans with commit correlation and all-opaque spans

### 5. `slo-compliance-report` (v0.1.0 -> v0.2.0)

**Eval rank:** #5 weakest (no HTML artifact template, no few-shot examples, no MCP call pattern, no context provider)

Changes:
- Added `## Context provider` section with `context.data_sources_available.application_signals` check
- Added `## MCP tool dependencies` listing `list_services`, `list_slos`, `get_slo`
- Added explicit MCP tool call sequences for all 3 phases (with pagination handling and concurrency cap at 10)
- Added derived field computation formulas (`budget_remaining_pct`, burn rate normalization)
- Added state classification rules with exact thresholds (Healthy/Warning/At risk/Breaching/Recovered)
- Added per-SLO JSON result example
- Added service ranking algorithm (worst-state, time-to-exhaustion, degraded SLO count)
- Added fixed-shape dashboard template with all required sections
- Added Phase 5 recommendation categories (5 types)
- Added caching, pagination, and rate limits section (MAX_SERVICES=200, concurrency=10, timeouts)
- Added error handling table (7 error scenarios)
- Added 2 few-shot examples: portfolio with at-risk SLOs and all-healthy portfolio
- Added empty states and data unavailability section

---

## Phase 2: Consistency Pass (All 19 Skills)

### Changes Applied to All 14 Non-Rewritten Skills

#### Heading normalization
- Renamed `## Required MCP servers` to `## MCP tool dependencies` in 6 skills:
  - `alarm-response`
  - `error-spike-triage`
  - `latency-regression`
  - `slo-breach-investigation`
  - `alerting-design`
  - `observability-gap-analysis`

#### Context provider sections added
Added `## Context provider` sections to all 14 non-rewritten skills, with context fields specific to each skill's role:

**Investigation/workflow skills** (6 skills -- also got specific MCP tool names in the renamed `## MCP tool dependencies` section):
- `alarm-response` -- Added `context.alarm`, `context.region`, `context.account`, `context.service`, `context.time_window`, `context.data_sources_available` fields. Listed specific tool names: `describe_alarms`, `get_metric_data`, `start_query`, `get_query_results`, `list_services`, `list_service_operations`, `get_top_contributors`, `lookup_events`.
- `error-spike-triage` -- Added `context.service`, `context.region`, `context.account`, `context.time_window`, `context.environment`, `context.data_sources_available` fields. Listed specific tool names.
- `latency-regression` -- Added `context.service`, `context.operation`, `context.region`, `context.account`, `context.time_window`, `context.environment`, `context.data_sources_available` fields. Listed specific tool names.
- `slo-breach-investigation` -- Added `context.service`, `context.slo`, `context.region`, `context.account`, `context.time_window`, `context.environment`, `context.data_sources_available` fields. Listed specific tool names including `list_slos`, `get_slo`.
- `alerting-design` -- Added `context.region`, `context.account`, `context.service` (optional), `context.environment`, `context.data_sources_available.cloudwatch_metrics` fields. Listed specific tool names: `describe_alarms`, `get_metric_data`, `list_metrics`, `search_documentation`.
- `observability-gap-analysis` -- Added `context.service`, `context.region`, `context.environment` fields. Listed `search_documentation`.

**Artifact/rendering skills** (4 skills -- noted they receive data from parent skills):
- `service-health-card` -- Added context fields used in metadata footer. MCP tool dependencies: None (rendering skill).
- `slo-breach-explainer` -- Added context fields used in metadata footer. MCP tool dependencies: None (rendering skill).
- `top-suspected-cause` -- Added context fields used in metadata footer. MCP tool dependencies: None (rendering skill).
- `trace-waterfall-summary` -- Added context fields used in metadata footer. MCP tool dependencies: None (rendering skill).

**Utility/infrastructure skills** (4 skills):
- `aws-apm-setup` -- Added context provider section noting this skill initializes the context. Listed all 4 MCP servers with their connectivity test tool names.
- `investigation-validator` -- Added context fields it validates (region, account, time_window must appear in metadata footer). MCP tool dependencies: None (validation skill).
- `hybrid-renderer` -- Added context-to-manifest-metadata field mapping. MCP tool dependencies: None (manifest production skill).
- `open-in-cloudwatch` -- Added context fields used in URL template substitution. MCP tool dependencies: None (URL generation skill).

---

## Summary Statistics

| Metric | Count |
|---|---|
| Skills fully rewritten | 5 |
| Skills with consistency edits | 14 |
| Total skills modified | 19 |
| `## Context provider` sections added | 19 (was 0) |
| `## MCP tool dependencies` sections added/renamed | 19 (was 0 with this exact heading) |
| `## Required MCP servers` headings eliminated | 6 (was 6, now 0) |
| Few-shot examples added | 10 (2 per rewritten skill) |
| Error handling tables added | 5 (one per rewritten skill) |
| Version bumps | 5 (v0.1.0 -> v0.2.0 for rewritten skills) |
