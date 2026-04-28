# Action Safety Model

The plugin orchestrates a Claude-driven AWS APM investigation. Some of the work it
does (and proposes) is read-only telemetry retrieval; some of it is suggesting that
a human change configuration; some of it is calling AWS APIs that mutate state.
This document defines the **5 tiers** the plugin uses to classify every action
the model can take or recommend, and the safety guarantees of each tier.

**Default disposition:** the plugin is read-only. Anything that would mutate AWS
state requires explicit, in-chat human confirmation, and most destructive or
billing-impacting changes are not executed at all — the model deep-links to the
AWS console instead.

## The five tiers

| Tier | Class | Examples | Who executes | Confirmation |
|---|---|---|---|---|
| 1 | Read-only telemetry | `GetMetricData`, `LookupEvents`, `GetTraceSummaries`, `ListServices`, `DescribeAlarms` | MCP server | None — runs freely |
| 2 | Suggested action (no execution) | "Create a 5xx alarm on this service", "Lower the SLO error budget threshold to 99.5%", "Add a CloudWatch dashboard" | Human, manually | N/A — the plugin only describes |
| 3 | Console deep-linked action | Modify alarm threshold, change log retention, edit SLO, rotate a secret, scale an ECS service | Human, in AWS console | The plugin builds a deep link and stops |
| 4 | MCP-executable with explicit approval | `PutMetricAlarm` (create-only), `TagResource` for an ownership tag, `StartQuery` for a custom Logs Insights query | MCP server, *after* user types "yes" in chat | PreToolUse hook gates every write verb |
| 5 | Disallowed | `Delete*` log groups, `Put*Retention` (lower), `Modify*` IAM, `DeleteAlarm`, anything that drops data, anything that grants/elevates permission | Never executed by the plugin | Always console deep-link instead |

### Tier 1 — read-only telemetry

The plugin's investigation workflows only need read APIs. Everything in this tier
runs through the four MCP servers without confirmation, because nothing leaves
your account, no state changes, and the result is simply observed. The
recommended IAM policy includes only Tier-1 verbs (see [SECURITY.md](SECURITY.md)).

Examples:

- `cloudwatch:GetMetricData`, `GetMetricStatistics`, `DescribeAlarms`, `ListMetrics`
- `application-signals:ListServices`, `GetServiceLevelObjective`, `ListServiceOperations`
- `xray:GetTraceSummaries`, `BatchGetTraces`, `GetServiceGraph`
- `logs:StartQuery`, `GetQueryResults`, `DescribeLogGroups`, `FilterLogEvents`
- `cloudtrail:LookupEvents`, `GetEventDataStore`
- `synthetics:GetCanary`, `GetCanaryRuns`

### Tier 2 — suggested action (no execution)

The model writes the recommendation into the artifact ("you should add a
LowDiskSpace alarm to ECS task ...") but the plugin does **not** call any API.
The user reads the suggestion and decides separately. Tier 2 is the default for
any prescription the model gives in a `Top Suspected Cause` artifact.

This tier is the expected output of every investigation skill: the artifact ends
in a "next step" or "remediation" section, but the steps are written, not run.

### Tier 3 — console deep-linked action

For changes that *should* happen in a UI with proper context (alarm pages,
deploy console, log retention settings, secret rotation), the plugin does not
attempt to execute. The `open-in-cloudwatch` skill builds a deep link with
service / operation / time-range / filter pre-populated and the user follows it.

This tier exists because a) the AWS console has built-in confirmation flows for
destructive changes, b) those flows show context (cost, blast radius, related
resources) the model would have to re-derive, and c) the human is closer to the
right authority for the change.

### Tier 4 — MCP-executable with explicit approval

Some MCP tools accept write verbs. The PreToolUse hook
(`hooks/scripts/confirm-write.sh`) intercepts every call whose name matches
any of:

```
Put*  Update*  Delete*  Modify*  Start*  Stop*  Create*
Remove*  Disable*  Enable*  Attach*  Detach*  Tag*  Untag*
```

…and pauses for the user to type confirmation in chat. Read verbs (`Get*`,
`List*`, `Describe*`, `Lookup*`, `BatchGet*`) pass through unmodified. The hook
is matcher-based on the tool name, not the AWS API name, so it covers any
future MCP servers wired into the plugin without code changes.

If you do not need write access at all (the recommended posture), grant
read-only IAM and Tier 4 becomes a no-op — the AWS API rejects writes before
the MCP server can issue them. See "Read-only recommended install" in
[SECURITY.md](SECURITY.md).

### Tier 5 — disallowed

The plugin will not execute the following classes of action under any
circumstance, even with confirmation:

- **Data loss**: `DeleteLogGroup`, lowering log retention, deleting metric data,
  deleting CloudTrail data stores, deleting X-Ray traces.
- **Permission changes**: any IAM mutation (`PutRolePolicy`, `AttachRolePolicy`,
  `CreateUser`, `UpdateAssumeRolePolicy`, `DeleteUserPolicy`, etc.).
- **Service teardown**: `DeleteService`, `DeleteAlarm`, `DeleteSlo`,
  `DeleteCanary`, `DeleteDashboard`.
- **Billing-impacting changes**: enabling Detailed Monitoring at scale,
  enabling X-Ray on all services, expanding CloudTrail data event coverage.

For these the model produces a Tier-3 console deep link with a brief note on
why it isn't executing the change directly.

## How the model picks a tier

The classification is a property of the **proposed action**, not the alert that
triggered it. Every workflow skill ends with a `Top Suspected Cause` artifact
whose remediation block is at most Tier 2. If the user requests an actual
remediation, the model:

1. Reads the verb. If it matches a Tier-5 pattern, output a Tier-3 deep link
   with explanation.
2. Otherwise, if it would mutate state, output a Tier-3 deep link unless the
   user has explicitly asked for execution and an MCP tool is available.
3. If executing via MCP, the PreToolUse hook gates the call (Tier 4).
4. If purely observational, run it (Tier 1).

The `investigation-validator` skill checks at the end of every workflow that no
mutation was executed without confirmation, and that any "next step" the
artifact prescribes is described, not performed.

## Why this model

- **Read-only by default** is the only posture compatible with handing the
  plugin an SSO role you also use for production.
- **Console deep links over MCP execution** for destructive actions keeps the
  plugin honest about its blast radius. The console shows confirmations, billing
  estimates, and relationships the model would otherwise have to reconstruct.
- **Hook-based gating, not policy-based gating** means the safety guarantee
  holds even if a future MCP server adds a new write verb the plugin author
  never anticipated. The matcher catches it.
- **Tiering by action class, not by skill** means every skill follows the same
  rules — there is no "trust this skill to write" carve-out.

See also: [SECURITY.md](SECURITY.md) for IAM policy examples and the threat
model, [ARCHITECTURE.md](ARCHITECTURE.md) for the orchestration boundary.
