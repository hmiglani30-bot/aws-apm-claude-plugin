---
name: aws-apm-setup
description: >
  Verify and set up the AWS APM plugin's MCP server connections — checks that
  uvx is installed, AWS credentials are configured, and the four awslabs MCP
  servers (CloudWatch, Application Signals, CloudTrail, AWS Documentation) are
  reachable. Walks the user through fixing any gap.
  Trigger phrases: "set up AWS APM plugin", "AWS APM not working", "MCP servers not connecting",
  "aws apm setup", "configure CloudWatch plugin", "configure aws apm",
  "AWS profile for plugin", "AWS region for plugin",
  or any error indicating the awslabs MCP servers are unreachable.
metadata:
  version: "0.1.0"
---

# AWS APM Plugin Setup

Verifies prerequisites and walks the user through any missing piece. Run this on first
install, or when any other skill reports an MCP connection error.

## Prerequisites checklist

1. **uv / uvx installed** — the four MCP servers are launched via `uvx`. If not present,
   instruct the user:
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
   (macOS / Linux. Windows: see https://docs.astral.sh/uv/getting-started/installation/.)

2. **AWS credentials configured** — check for `~/.aws/credentials` or `AWS_PROFILE` env
   var. If neither, instruct the user to run `aws configure` or set up SSO.

3. **AWS region set** — verify by reading `~/.aws/config` or asking the user. Default in
   `.mcp.json` is `us-east-1`; the user should change it via Claude Code settings or by
   editing the plugin's `.mcp.json` if their workloads are elsewhere.

4. **IAM permissions** — the user's role / user needs at minimum:
   - `cloudwatch:Get*`, `cloudwatch:List*`, `cloudwatch:Describe*`
   - `logs:StartQuery`, `logs:GetQueryResults`, `logs:DescribeLogGroups`
   - `xray:GetTrace*`, `xray:Get*`
   - `application-signals:List*`, `application-signals:Get*`
   - `cloudtrail:LookupEvents`, `cloudtrail:GetEventDataStore`
   - `synthetics:GetCanary`, `synthetics:GetCanaryRuns` (canary status)

   Write actions (`Put*`, `Update*`, etc.) are **not required** for read-only investigations.
   The plugin's confirmation gate hook prevents accidental writes regardless.

5. **Application Signals enabled** in the user's account — required for service-map,
   SLO, and operation tools to return data. Link them to:
   https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Intro.html

## Region and profile configuration

The four MCP servers each take `AWS_PROFILE` and `AWS_REGION` via env. Recommend the user
either:

- **Edit the plugin's `.mcp.json`** to set their profile / region (committed to plugin)
- **Override via Claude Code MCP settings** (per-user, not committed)

Region must be consistent across all four MCP servers. The `aws-documentation-mcp-server`
does not need credentials; the other three do.

## Verification

Once configured, verify by running these read-only probes:

1. CloudWatch: `list_metrics` for namespace `AWS/EC2` (returns immediately if creds work)
2. Application Signals: `list_services` for the configured region
3. CloudTrail: `lookup_events` for the last 5 minutes (max 1 result)

If any probe fails, surface the error verbatim — do not retry silently.

## Common errors

- **`uvx: command not found`** → uv not installed (Step 1)
- **`Unable to locate credentials`** → no AWS creds (Step 2)
- **`AccessDenied`** → IAM perms (Step 4) — surface the exact action denied
- **`No services found`** → Application Signals not enabled (Step 5), or wrong region
- **`ThrottlingException`** → AWS API rate limit. Surface the exact API + operation
  rather than retrying silently; the user may need to lower investigation cadence or
  request a quota increase
- **`Connection refused` to MCP** → MCP server failed to launch; check `FASTMCP_LOG_LEVEL=DEBUG`

### Service-name resolution

If the user names a service that returns **multiple matching services** from
`list_services` (e.g. "checkout" matches `checkout-api` and `checkout-worker`), do not
guess. Show the candidates with their environments / ARNs and ask the user to pick one
before continuing. If the name is ambiguous and `list_services` returns zero matches,
treat it as the "wrong region" case above.

## What this skill does NOT do

- Does not write to `~/.aws/credentials` or `~/.aws/config` automatically.
- Does not enable Application Signals — that's an account-level action requiring console
  access; deep-link the user there.
- Does not request new IAM permissions — those need an admin.
