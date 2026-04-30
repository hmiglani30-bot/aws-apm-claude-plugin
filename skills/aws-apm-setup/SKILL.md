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

## Context provider

This setup skill initializes the context provider. After setup completes, the following fields are populated:

- `context.region` -- AWS region (derived from `~/.aws/config` or user input)
- `context.account` -- AWS account ID (derived from credentials)
- `context.data_sources_available` -- populated by verifying each MCP server connection

## MCP tool dependencies

Tests connectivity to all four MCP servers:
- `awslabs.cloudwatch-mcp-server` -- `describe_alarms` (connectivity test)
- `awslabs.cloudwatch-applicationsignals-mcp-server` -- `list_services` (connectivity test)
- `awslabs.cloudtrail-mcp-server` -- `lookup_events` (connectivity test)
- `awslabs.aws-documentation-mcp-server` -- `search_documentation` (connectivity test)

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

## App Signals Enablement for Lambda (ADOT Layer)

To get App Signals data from a Lambda function, add the AWS Distro for OpenTelemetry
(ADOT) Lambda layer. This instruments the function automatically — no code changes needed.

### Required Lambda configuration

1. **Add the ADOT Lambda layer** (AWS-managed, region-specific):
   ```
   arn:aws:lambda:<region>:901920570463:layer:aws-otel-python-amd64-ver-1-25-0:1
   ```
   Replace `<region>` with your deployment region. For other runtimes (Node.js, Java, .NET),
   see https://aws-otel.github.io/docs/getting-started/lambda

2. **Set environment variables** on the Lambda:
   | Variable | Value | Purpose |
   |----------|-------|---------|
   | `AWS_LAMBDA_EXEC_WRAPPER` | `/opt/otel-handler` | Runs ADOT bootstrap before handler |
   | `OTEL_SERVICE_NAME` | `<your-service-name>` | Name shown in App Signals console |
   | `OTEL_PROPAGATORS` | `xray` | Trace context propagation format |
   | `OTEL_TRACES_EXPORTER` | `otlp` | Export traces via ADOT collector |
   | `OTEL_AWS_APPLICATION_SIGNALS_ENABLED` | `true` | Enable App Signals metric export |
   | `OTEL_RESOURCE_ATTRIBUTES` | `service.name=<your-service-name>` | Resource identification |

3. **Enable X-Ray active tracing** on the Lambda (`TracingConfig.Mode: Active`)

4. **IAM permissions** — the Lambda execution role needs:
   - `AWSXRayDaemonWriteAccess` (managed policy)
   - `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` (managed policy)

### CloudFormation snippet

```yaml
MyFunction:
  Type: AWS::Lambda::Function
  Properties:
    # ... your existing function config ...
    Layers:
      - !Sub 'arn:aws:lambda:${AWS::Region}:901920570463:layer:aws-otel-python-amd64-ver-1-25-0:1'
    TracingConfig:
      Mode: Active
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-handler
        OTEL_SERVICE_NAME: my-service-name
        OTEL_PROPAGATORS: xray
        OTEL_TRACES_EXPORTER: otlp
        OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'true'
        OTEL_RESOURCE_ATTRIBUTES: service.name=my-service-name
```

The Lambda execution role must include:
```yaml
ManagedPolicyArns:
  - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
  - arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy
```

### Verification

After deploying, invoke the Lambda a few times, then check:
- **X-Ray traces**: should appear within 1-2 minutes
- **App Signals service list**: `list_services` should return the service after 5-10 minutes
- **App Signals console**: deep link to `#application-signals:services/<service-name>`

If `list_services` returns empty after 10 minutes, verify:
1. The ADOT layer ARN matches your region and runtime
2. `AWS_LAMBDA_EXEC_WRAPPER` is set to `/opt/otel-handler`
3. The Lambda role has both X-Ray and App Signals managed policies
4. App Signals is enabled in the account (account-level setting)

## What this skill does NOT do

- Does not write to `~/.aws/credentials` or `~/.aws/config` automatically.
- Does not enable Application Signals — that's an account-level action requiring console
  access; deep-link the user there.
- Does not request new IAM permissions — those need an admin.
