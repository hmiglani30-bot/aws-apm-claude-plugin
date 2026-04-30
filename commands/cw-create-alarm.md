---
description: Generate a prefilled CloudWatch alarm configuration form (action_form widget) plus a copy-paste `aws cloudwatch put-metric-alarm` CLI command, with thresholds derived from the current investigation context
argument-hint: <metric-or-namespace> [service-name]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs.cloudwatch-mcp-server__*"
  - "mcp__awslabs.cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-create-alarm

Produce a **Create Alarm** artifact: an `action_form` widget prefilled
with a recommended CloudWatch alarm configuration plus a ready-to-paste
`aws cloudwatch put-metric-alarm` CLI command. The artifact does **not**
create the alarm — applying the change is a deliberate user step
(console deep link or CLI paste) so this command stays inside the
plugin's read-only posture.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - First arg = metric name (e.g. `Errors`, `Duration`, `5XXError`)
     OR a fully-qualified `Namespace/Metric` (e.g. `AWS/Lambda/Errors`).
   - Second arg = service or resource name (e.g. `checkout-api`).
   - If both are missing, ask the user which metric and resource the
     alarm should cover. Don't guess.
2. Activate the `create-alarm` skill and follow its 4-phase workflow:
   1. **Resolve metric and dimensions** — confirm the metric exists in
      this region and bind it to the right resource dimensions.
   2. **Pull baseline** — fetch the last `7d` of metric data to compute
      a recommendation (median, p95, p99, max). Surface the baseline
      window explicitly in the form.
   3. **Recommend threshold** — apply the rules in the skill (e.g.
      `2× baseline` for error counts, `p99 + 20%` for latency). Prefer
      datapoints-to-alarm 2 and treat-missing-data `notBreaching` as
      defaults; document overrides in the form.
   4. **Render the artifact** — emit a `hybrid-renderer` manifest with
      one `action_form` widget. Include `cli_command`, `deep_link`, the
      tier-4 safety block, and `source: "create-alarm recommendation"`
      on every prefilled field.
3. **Do not call any `Put*`, `Update*`, `Create*`, or `Delete*` MCP
   tool.** The artifact is the deliverable. Tell the user that to apply
   the alarm they should either:
   - Click the **Open in CloudWatch console** button (deep link), or
   - Copy the CLI command and run it from a shell with appropriate IAM.

## Action safety

This command is **read-only** against the AWS account. The output is a
prefilled form, not an executed write. See
[ACTION-SAFETY-MODEL.md](../ACTION-SAFETY-MODEL.md):

- The recommended posture is Tier 3 — **deep-link to the console**.
- The CLI command is shown for transparency, not auto-executed.
- If the user explicitly asks the model to call `PutMetricAlarm` via
  MCP, the `confirm-write.sh` PreToolUse hook gates the call (Tier 4)
  and the user must type the explicit confirmation phrase. Prefer the
  console / CLI path.

## Examples

```
/cw-create-alarm Errors checkout-api
/cw-create-alarm AWS/Lambda/Duration checkout-api
/cw-create-alarm 5XXError checkout-api
/cw-create-alarm Throttles
```
