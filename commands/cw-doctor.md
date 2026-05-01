---
description: Run a single end-to-end diagnostic on the AWS APM plugin — MCP servers, AWS identity, region, Application Signals, logs, traces, CloudTrail — and render a ready / not-ready verdict
argument-hint: [verbose]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs_cloudwatch-mcp-server__*"
  - "mcp__awslabs_cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs_cloudtrail-mcp-server__*"
---

# /cw-doctor

Single diagnostic command. Runs every read-only probe needed to confirm the
plugin is wired up correctly, surfaces the first failure in plain English,
and ends with a one-line **ready / not ready** verdict the on-call engineer
can act on.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - If `verbose`, render full per-check output including raw response counts
     and exact tool names called.
   - Otherwise render the compact verdict summary (one line per check).

2. **Do not stop at the first failure.** Run every check, collect every
   failure, and present them all together. The on-call engineer should not
   have to invoke `/cw-doctor` five times to discover five problems.

3. Before running checks, write a one-line thought: "Running 12 read-only
   probes — runtime, MCP, identity, region, Application Signals, Logs,
   X-Ray, CloudTrail, renderer, end-to-end data flow. This will take ~15s."

## The 12 checks

Run these in order. For each, record Pass / Fail / Skip with a one-line
reason. None of these are write actions — every probe is read-only.

The first three checks (0a, 0b, 0c) probe the **runtime environment** —
they cover Cowork's lightweight VM, fresh Claude Code installs, and
restricted CI environments where the plugin's host dependencies may be
missing. Without these, the data flow described later cannot run.

### 0a. Runtime: `uvx` available
- Run `command -v uvx` via Bash. The four `awslabs` MCP servers in
  `.mcp.json` are launched via `uvx`. If `uvx` is missing, every MCP server
  in checks 1–8 will fail to launch and the plugin cannot reach AWS at all.
- Pass = `uvx --version` prints. Fail = command not found.
- **Fix this** if missing: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  then restart the Claude Code / Cowork session. In Cowork's VM the install
  goes to `~/.local/bin`, which Cowork includes in `PATH` by default.

### 0b. Runtime: `node` available (renderer)
- Run `command -v node && node --version`. The HTML artifact path
  (`render-standalone.mjs`) requires Node.js 18+.
- Pass = node ≥ 18 prints. Skip-with-warning = node missing or < 18 (the
  plugin still works for Markdown-only output; HTML rendering is degraded).
- **Fix this** if missing: install Node.js 18+ from https://nodejs.org or
  via the user's package manager. In Cowork's VM, `apt-get install -y nodejs`
  may require sudo; surface that as a known limitation rather than retrying.

### 0c. Runtime: `${CLAUDE_PLUGIN_ROOT}` resolves
- Run `echo "${CLAUDE_PLUGIN_ROOT:-UNSET}"` and verify the path exists and
  contains `render-standalone.mjs`. The hook script and the renderer
  invocation both depend on this env var being populated by the plugin host.
- Pass = path resolves and contains `render-standalone.mjs`. Fail =
  variable unset OR path does not contain the renderer.
- **Fix this** if missing: the plugin is not loaded correctly. Re-install
  via the marketplace or check `.claude-plugin/plugin.json` is on disk.

### 1. MCP server status
- All four `awslabs` servers connected? (`cloudwatch-mcp-server`,
  `cloudwatch-applicationsignals-mcp-server`, `cloudtrail-mcp-server`,
  `aws-documentation-mcp-server`)
- The actual MCP tool prefix is `mcp__awslabs_<server-name>__<tool>` (single
  underscore between `awslabs` and `<server>`, double underscore at segment
  boundaries). If `allowed-tools` patterns or hook matchers in the plugin
  use the wrong form (e.g. dotted `mcp__awslabs.<server>__*` or
  double-underscore `mcp__awslabs__.*`), grep for and surface them — they
  silently disable permissions / hooks without throwing errors.
- If any servers are missing, surface which ones and stop subsequent checks
  that depend on them (mark dependent checks as Skip with reason "depends on
  <server>").

### 2. AWS identity (caller identity)
- Resolve the caller via STS `GetCallerIdentity` (through the CloudWatch
  MCP server's IAM-adjacent tools, or via the user's shell if MCP cannot).
- Report: ARN, user / role name, source profile.
- If creds are missing or expired, fail this check and skip checks 3–9.

### 3. Account ID
- Extract from the identity check above. Surface as `<account-id>`.
- Also resolve account alias if available.

### 4. Region
- Read the configured region from `.mcp.json` env (`AWS_REGION`) or from
  the user's shell.
- Confirm consistency across all four MCP servers — if any server is
  configured for a different region, fail this check (mixed-region setups
  are a footgun).

### 5. Application Signals service count
- Call `list_monitored_services` for the configured region (capped to 1
  result for the probe; we only need to know it returns).
- If the call returns 0 services, **fail with reason** "Application
  Signals not enabled or no services in region — run /cw-set-context to
  pick a region with services, or enable Application Signals in the AWS
  console."
- If the call returns ≥1 services, also surface the total count (this is
  a useful "how big is the fleet" signal for the user).

### 6. CloudWatch Logs access
- Call `DescribeLogGroups` with limit=1 in the configured region.
- Pass = returns at least one log group OR returns empty without error.
- Fail = `AccessDenied` or `ThrottlingException`.

### 7. X-Ray trace access
- Call `query_sampled_traces` for the last 5 minutes with no filter, limit=1.
- Pass = call returns (any number of traces is fine, even 0).
- Fail = `AccessDenied` or auth error.

### 8. CloudTrail access
- Try the data sources in the documented priority order:
  1. Lake event data store (if any configured)
  2. CloudWatch Logs integration (if any configured)
  3. Lookup Events API (always available, but limited to 7 days)
- Pass if any one source returns. Surface which source was used.
- Fail only if all three fail.

### 9. Missing permissions audit
- Compare the actions the previous checks attempted vs. the actions the
  `aws-apm-setup` skill lists as required.
- Surface any required action that has not been exercised by the probes
  AND is documented as needed by the workflow skills (e.g.
  `synthetics:GetCanary` — not exercised above but required for canary
  alarms in `alarm-response`).
- Mark these as **"Not verified"** rather than Pass / Fail — the probe
  set is intentionally minimal; the user's actual workflow may exercise
  more actions.

### 10. Renderer end-to-end smoke test
- Skip if check 0b failed (no `node`).
- Write a tiny manifest to a temp file, run the standalone renderer, and
  confirm a non-empty HTML file lands on disk:
  ```bash
  tmp=$(mktemp -d) && cat > "$tmp/m.json" <<'EOF'
  {"version":"1.0","metadata":{"title":"doctor","severity":"info","query_intent":"doctor"},"widgets":[{"type":"stat_card","priority":1,"data":{"label":"ok","value":1,"status":"healthy"}}]}
  EOF
  node "$CLAUDE_PLUGIN_ROOT/render-standalone.mjs" "$tmp/m.json" "$tmp/out.html" && \
    test -s "$tmp/out.html" && echo "renderer-ok: $(wc -c < "$tmp/out.html") bytes"
  ```
- Pass = renderer prints `Rendered:` and the output file is > 1 KB.
- Fail = non-zero exit OR empty file. Surface the first error line.
- This proves the JSON-manifest → HTML half of the data flow is wired —
  it does NOT prove AWS data flows in (that's checks 5–8).

### 11. Full-loop smoke test (AWS → manifest → HTML)
- Skip if any of checks 0a, 0b, 1, 2, 5 failed (the loop has no chance).
- This is the single check that proves the whole pipeline:
  1. Call `list_monitored_services` (Application Signals MCP) for the
     configured region with limit=1 — same as check 5, but capture the response.
  2. Convert the response to a one-widget manifest (a `stat_card` whose
     `value` is the service count, `label` is "Application Signals
     services" + region) and write it under
     `${CLAUDE_PROJECT_DIR:-.}/.aws-apm/artifacts/doctor-<ts>.manifest.json`.
  3. Render via the same `node $CLAUDE_PLUGIN_ROOT/render-standalone.mjs`
     command from check 10, output to `doctor-<ts>.html` next to it.
  4. Confirm the HTML contains the service count text from step 1.
- Pass = HTML written, contains the value from the AWS response. This is
  the only check that proves data flowed end-to-end from AWS to a rendered
  artifact in this environment.
- Fail = describe which step failed.

## Verdict line

End with exactly one of:

- ✅ **Ready** — all must-pass checks (0a, 0c, 1–8, 10, 11) passed. Check 9
  may show "Not verified" entries; those are advisory, not blocking. 0b
  may downgrade to a warning if Node is missing; the rest of the plugin
  still works in that case (Markdown-only output).
- ⚠️ **Partially ready** — runtime + identity + region passed (0a, 0c,
  1–4), but Application Signals returned 0 services OR Logs / X-Ray /
  CloudTrail had non-fatal warnings OR Node is unavailable so check 10/11
  could not run. The plugin can still investigate via MCP, but the HTML
  artifact path is degraded. List which workflow skills will degrade and
  how (link to the degraded-telemetry handling section in the workflow
  skills).
- 🔴 **Not ready** — any of checks 0a, 0c, 1–4 failed. The plugin cannot
  run reliably. Surface the first failing check's remediation step from
  the `aws-apm-setup` skill verbatim.

## Canonical output layout

```markdown
## 🩺 AWS APM Plugin Doctor
**Region:** <region> · **Account:** <account-id> (<alias>) · **Profile:** <profile>
**As of:** <ISO ts UTC>

| #   | Check                  | Status | Notes |
|-----|------------------------|--------|---|
| 0a  | uvx                    | ✅     | uvx 0.x.y |
| 0b  | node (renderer)        | ✅     | node v20.x |
| 0c  | CLAUDE_PLUGIN_ROOT     | ✅     | resolves; render-standalone.mjs found |
| 1   | MCP servers            | ✅     | 4/4 connected |
| 2   | AWS identity           | ✅     | `<arn>` |
| 3   | Account ID             | ✅     | `<account-id>` (`<alias>`) |
| 4   | Region                 | ✅     | `<region>` (consistent across 4 servers) |
| 5   | Application Signals    | ✅     | <N> services |
| 6   | CloudWatch Logs        | ✅     | DescribeLogGroups returned |
| 7   | X-Ray                  | ✅     | query_sampled_traces returned |
| 8   | CloudTrail             | ✅     | source: Lake event data store |
| 9   | Missing permissions    | ⚠️     | `synthetics:GetCanary` not verified — needed for canary alarms |
| 10  | Renderer smoke         | ✅     | render-standalone.mjs OK, 27 KB out |
| 11  | Full-loop smoke (AWS→HTML) | ✅ | wrote `doctor-<ts>.html`, contains "<N>" |

---

✅ **Ready** — all must-pass checks passed.

> Run `/cw-set-context` to switch account / region.
> Run `/cw-health-check` to scan service health.
> Run `/cw-investigate-slo` to investigate a breaching SLO.
```

When a check fails, replace its row with the failure reason and surface
remediation in a separate **Fix this** block beneath the table — do not
hide the fix at the bottom of the file.

## Action safety

Read-only. Every probe is a `Get*` / `List*` / `Describe*` call. The
command never proposes a write action; if a check fails, remediation is
an instruction for the user, not an automated fix.

## Examples

```
/cw-doctor
/cw-doctor verbose
```

## Performance notes

- Run probes in parallel where independent (checks 5 / 6 / 7 / 8 do not
  depend on each other once identity is resolved).
- Cap each probe at a 5s timeout. A 60s `/cw-doctor` is unacceptable —
  if any probe is slow, it is itself a finding.
- Cache the result for 60s. If the user runs `/cw-doctor` twice in
  quick succession (e.g. after fixing one issue), do NOT cache — re-run.
  Detect intent by whether `$ARGUMENTS` changed or the user's previous
  invocation surfaced failures.
