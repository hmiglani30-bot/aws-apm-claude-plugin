---
description: Run a single end-to-end diagnostic on the AWS APM plugin — MCP servers, AWS identity, region, Application Signals, logs, traces, CloudTrail — and render a ready / not-ready verdict
argument-hint: [verbose]
allowed-tools: [Read, Bash, Grep]
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

3. Before running checks, write a one-line thought: "Running 9 read-only
   probes — MCP, identity, region, Application Signals, Logs, X-Ray,
   CloudTrail, IAM coverage. This will take ~10s."

## The 9 checks

Run these in order. For each, record Pass / Fail / Skip with a one-line
reason. None of these are write actions — every probe is read-only.

### 1. MCP server status
- All four `awslabs` servers connected? (`cloudwatch-mcp-server`,
  `cloudwatch-applicationsignals-mcp-server`, `cloudtrail-mcp-server`,
  `aws-documentation-mcp-server`)
- If any are missing, surface which ones and stop subsequent checks that
  depend on them (mark dependent checks as Skip with reason "depends on
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
- Call `list_services` for the configured region (capped to 1 result for
  the probe; we only need to know it returns).
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
- Call `GetTraceSummaries` for the last 5 minutes with no filter, limit=1.
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

## Verdict line

End with exactly one of:

- ✅ **Ready** — all 8 must-pass checks (1–8) passed. Check 9 may show
  "Not verified" entries; those are advisory, not blocking.
- ⚠️ **Partially ready** — checks 1–4 passed, but Application Signals
  returned 0 services OR Logs / X-Ray / CloudTrail had non-fatal warnings.
  The plugin can still investigate, but some workflows will degrade.
  List which workflow skills will degrade and how (link to the
  degraded-telemetry handling section in the workflow skills).
- 🔴 **Not ready** — any of checks 1–4 failed. The plugin cannot run
  reliably. Surface the first failing check's remediation step from the
  `aws-apm-setup` skill verbatim.

## Canonical output layout

```markdown
## 🩺 AWS APM Plugin Doctor
**Region:** <region> · **Account:** <account-id> (<alias>) · **Profile:** <profile>
**As of:** <ISO ts UTC>

| # | Check | Status | Notes |
|---|---|---|---|
| 1 | MCP servers | ✅ | 4/4 connected |
| 2 | AWS identity | ✅ | `<arn>` |
| 3 | Account ID | ✅ | `<account-id>` (`<alias>`) |
| 4 | Region | ✅ | `<region>` (consistent across 4 servers) |
| 5 | Application Signals | ✅ | <N> services |
| 6 | CloudWatch Logs | ✅ | DescribeLogGroups returned |
| 7 | X-Ray | ✅ | GetTraceSummaries returned |
| 8 | CloudTrail | ✅ | source: Lake event data store |
| 9 | Missing permissions | ⚠️ | `synthetics:GetCanary` not verified — needed for canary alarms |

---

✅ **Ready** — all 8 must-pass checks passed.

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
