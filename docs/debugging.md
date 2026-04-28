# Debugging the AWS APM plugin

When the plugin is misbehaving — wrong verdict, missing data, slow runs,
phantom failures — you need to see what it actually did. This guide is for
plugin maintainers and on-call engineers who want to introspect a run rather
than re-run it blind.

## What's worth observing

These are the categories the plugin tries to make legible at runtime. If you
add a new skill, mirror this surface so it can be debugged the same way.

### 1. Tool calls made

Every MCP call is the smallest auditable unit of work. For a finished
investigation, you should be able to reconstruct:

- Which MCP server was called (`awslabs.cloudwatch-mcp-server`,
  `awslabs.cloudwatch-applicationsignals-mcp-server`,
  `awslabs.cloudtrail-mcp-server`, `awslabs.aws-documentation-mcp-server`)
- The exact tool name (`list_services`, `get_slo`, `lookup_events`, etc.)
- The arguments (especially: time window, region, service / resource ID)
- The status (success / throttled / access-denied / timeout)
- The duration

The metadata footer of every Tier 3 artifact lists the MCP servers and tool
names called. For a richer per-call audit, run with
`FASTMCP_LOG_LEVEL=DEBUG` (set per-server in `.mcp.json`) and tail the MCP
client logs.

### 2. Duration per phase

Each workflow skill (`slo-breach-investigation`, `latency-regression`,
`error-spike-triage`, `alarm-response`) is structured as discrete phases.
Phase 1 always finishes before Phase 2 starts; `TodoWrite` reflects the
current phase in real time.

To debug slowness:

- Check the `TodoWrite` log — which phase took longest?
- Cross-reference with the MCP tool log — was the slow phase blocked on a
  single Logs Insights query, an X-Ray fetch, a CloudTrail Lake scan?
- For Logs Insights specifically, the query ID is captured in the artifact's
  deep links — re-run the query from the AWS console to compare timings.

### 3. Failures per MCP server

When a run produces a "Status unknown" tier or a data-unavailable banner,
the cause is captured in the banner text. To enumerate failures across a
session:

- Look for `data-unavailable` banners in artifacts — each names the failed
  source and the impact on confidence.
- Look for `Status unknown` rows in `/cw-health-check` and
  `/cw-slo-report` outputs — these are the per-row failures that didn't
  warrant a global banner.
- For systemic issues, run `aws-apm-setup` to re-validate every MCP
  connection from scratch.

Recurring patterns and what they usually mean:

| Failure | Likely cause | First check |
|---|---|---|
| `AccessDenied` on CloudTrail | IAM perm gap or wrong account | `aws-apm-setup` Step 4 |
| `ThrottlingException` on Application Signals | Concurrency too high / fleet too large | Reduce `MAX_SERVICES`, raise concurrency cap last |
| `ResourceNotFound` on a service | Wrong region | `aws-apm-setup` Step 3 |
| `Connection refused` to MCP | `uvx` failed to launch | `FASTMCP_LOG_LEVEL=DEBUG` to see launch error |
| Logs Insights timeout | Query too broad or log group too big | Narrow the query window or pre-filter by `errorType` |

### 4. Services scanned

A portfolio command (`/cw-health-check`, `/cw-slo-report`) reports the
number of services scanned in its metadata footer. If that number doesn't
match what you expect:

- The filter may be excluding services unintentionally — check the filter
  substring and case.
- The pagination cap (`MAX_SERVICES=200` for `/cw-slo-report`,
  `MAX_SERVICES=50` for the `/cw-health-check` render) may have truncated
  the result. The footer / banner says "<N> more services not shown" when
  this happens.
- Application Signals may not be enabled on every service in the region —
  check the AWS console.

### 5. Query sizes

For `error-spike-triage` and `latency-regression`, the Logs Insights
queries can scan large amounts of data. To debug a slow or expensive run:

- Re-run the query via the deep link in the artifact — the AWS console
  shows bytes scanned and records returned.
- The investigation phases query at most 5 patterns × 2 sample lines each
  (capped). If you need a broader query, run it manually rather than
  re-running the workflow.
- If a query times out, the artifact's data-unavailable banner says so,
  and the workflow falls back to top-level error counts only.

### 6. Artifact validation

Every Tier 3 artifact is run through `investigation-validator` before
presentation. The result is captured in the artifact's footer as
`Self-validation: <Pass | Fail (N issues fixed)>`. To debug a validation
failure:

- The validator's expanded output (under the `<details>` block in the
  artifact) lists each of the 6 checks with Pass / Fail and a one-line
  reason.
- A `Fail` should have been auto-corrected before presentation. If you see
  a `Fail` in a presented artifact, the auto-correction logic broke —
  file an issue with the artifact attached.

## Tracing a single bad investigation

The workflow when "the verdict is wrong" or "the artifact is missing
something":

1. **Capture the artifact**. The HTML / Markdown is the canonical record;
   read it cold rather than relying on what you remember the model saying.
2. **Read the metadata footer**. It tells you which MCP servers were
   reached, which tools were called, which queries ran, and the
   confidence in the conclusion. Most "wrong verdict" reports are
   actually "right verdict given missing data" — the footer reveals the
   gap.
3. **Read the data-unavailable banner if present**. It explicitly names
   sources that failed and the impact on confidence.
4. **Read the "Considered and ruled out" section**. If the right answer
   appears here as ruled-out-with-bad-evidence, the issue is the
   ruling-out logic, not the ranking logic.
5. **Re-run with `FASTMCP_LOG_LEVEL=DEBUG`** if the above doesn't explain
   the problem. The MCP server logs will reveal silent failures.

## Tracing a slow run

1. **Read the `TodoWrite` log**. The phase that's `in_progress` longest is
   the culprit.
2. **For portfolio commands**, check the per-call concurrency cap — at
   default 10, a 200-service portfolio takes ~20s of MCP round-trips
   alone. This is intentional (avoids throttling) but means the absolute
   floor on `/cw-slo-report` is roughly 20–30s.
3. **For investigation skills**, check whether Phase 6 (cascading
   dependency check) ran. The depth-2 cap exists to prevent runaway
   chains; if you see depth 1 fully traversed, that's `service-health-card`
   running on the dependency, which is expected.
4. **Logs Insights queries** are the single most common slowness source.
   If a query timed out at 30s, the artifact says so and the workflow
   moves on; if it returned but slowly, you'll see the phase took 20–30s.

## Tracing a permission failure

1. **Read the AWS error verbatim** from the data-unavailable banner — it
   names the IAM action that was denied.
2. **Cross-reference with `aws-apm-setup` Step 4** — the minimum
   permission set is documented there.
3. **The plugin's PreToolUse hook** does not deny reads, only writes. A
   read failure is a real IAM gap, not a hook artifact.

## Self-observability checklist

If you are adding or modifying a skill, the run should expose at least:

- [ ] Phase boundaries via `TodoWrite` (one in-progress at a time)
- [ ] A plain-English label before each MCP tool call ("Pulling burn
      rate over 1h / 6h / 24h…")
- [ ] A footer listing MCP servers + tool names + time range + region +
      account
- [ ] A data-unavailable banner when any source returned an error
- [ ] A "Considered and ruled out" section when ranking is involved
- [ ] A confidence claim with a plain-English justification

The plugin's value is that the on-call can audit the conclusion in 30
seconds. Anything that hides part of that surface is a regression to fix,
not a feature to keep.
