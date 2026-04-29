---
description: Analyze the user's codebase for missing logging, metrics, tracing, error handling, and health-check coverage and produce a prioritized observability gap report
argument-hint: [path] [language]
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - "mcp__awslabs.aws-documentation-mcp-server__*"
---

# /cw-obs-gaps

Run the **codebase observability gap analysis** workflow against the
repository the user is working in. Produces an **Observability Gap
Report** artifact that lists missing or weak instrumentation by severity,
with file-and-line citations and concrete code-level recommendations.

The user invoked this with: `$ARGUMENTS`

## Instructions

1. Parse `$ARGUMENTS`:
   - First arg = path to analyze (default: current working directory)
   - Second arg = primary language hint (`python`, `java`, `js`, `ts`, `go`,
     `ruby`, `csharp`). If absent, detect from manifest files
     (`pyproject.toml`, `pom.xml`, `package.json`, `go.mod`, `Gemfile`,
     `*.csproj`).
2. If the path does not look like an application codebase (no
   recognizable manifest, no source files), ask the user to confirm the
   path before continuing.
3. Activate the `observability-gap-analysis` skill and follow its full
   6-phase workflow:
   1. Detect stack — language, framework, AWS SDK, existing observability libs
   2. Audit logging — structured logging, levels, correlation IDs, PII risk
   3. Audit metrics — custom metrics, EMF / OpenTelemetry / CloudWatch
      Agent emission, RED-metric coverage
   4. Audit tracing — OpenTelemetry / X-Ray SDK, span creation, propagation,
      attribute richness
   5. Audit error handling and health checks — try/except patterns, retry
      logic, `/health`, `/ready`, dependency health
   6. Rank gaps by severity and produce the **Observability Gap Report**
4. The report must include, per gap: file path + line range, what is
   missing, why it matters in production, and a concrete fix snippet in
   the detected language.
5. Use `mcp__awslabs.aws-documentation-mcp-server__*` only to cite AWS
   best-practice references (CloudWatch agent config, EMF, Application
   Signals enablement, X-Ray SDK setup) — the actual codebase analysis
   is done by reading files directly.

## Action safety

This command is **read-only** against the local codebase and the AWS
documentation MCP server. It does not edit files, push code, or call any
AWS account API. Recommendations are surfaced as code snippets the user
applies themselves.

## Examples

```
/cw-obs-gaps
/cw-obs-gaps ./services/checkout
/cw-obs-gaps ./services/checkout python
/cw-obs-gaps . go
```
