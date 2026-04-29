---
name: observability-gap-analysis
description: >
  Analyze a user's application codebase for observability gaps — structured
  logging, custom metrics emission, distributed tracing instrumentation,
  error handling patterns, and health endpoints — and produce a prioritized
  gap report with file-and-line citations and language-specific fix
  snippets. Multi-language: Python, Java, JavaScript / TypeScript, Go,
  Ruby, C# / .NET.
  Trigger phrases: "observability gap analysis", "observability gaps",
  "audit my code for logging", "missing instrumentation", "is my service
  observable", "what telemetry am I missing", "obs gaps", "instrumentation
  audit", "logging audit", "tracing audit", "metrics audit", "are my logs
  good", "do I have enough logging", "find missing telemetry", "review my
  observability", "am I CloudWatch-ready", "production-readiness for
  telemetry", or any request to evaluate whether a codebase is
  sufficiently instrumented.
metadata:
  version: "0.1.0"
---

# Observability Gap Analysis

Workflow for finding *what telemetry an application codebase is missing*
before it hits production. Reads source files directly, produces an
**Observability Gap Report** ranked by severity with a concrete fix
snippet for every gap.

## When this activates

- A user asks "what's missing from my observability?"
- A team is preparing a service for production cutover
- An on-call engineer wants to know why an investigation has no
  fingerprints (no traces, no structured logs, no custom metrics) and
  whether the cause is the codebase, not the AWS account
- A reviewer wants to enforce an observability bar on a new service

This skill **only reads source files**. It does not edit code, run code,
or call any AWS account API. Output is advisory.

## Required MCP servers

- `awslabs.aws-documentation-mcp-server` — citations for AWS best
  practices (CloudWatch Agent, EMF, Application Signals, X-Ray SDK).
  Optional but strongly recommended; without it, recommendations cite
  general patterns rather than canonical AWS docs.

The CloudWatch / Application Signals / CloudTrail MCP servers are **not**
required — the analysis runs entirely on the local codebase.

## Presentation

1. **Show reasoning before each phase.** Before each phase, write a
   one-line thought ("Detecting language and framework first so the
   logging audit can match idiomatic patterns rather than generic
   regexes.").
2. **Label tool calls in human-readable terms.** Prefix `Glob` / `Grep`
   / `Read` calls with a plain-English label ("Scanning for log calls in
   `services/checkout/`…", "Counting structured-logger imports vs raw
   `print` calls…").
3. **Track phases with `TodoWrite`.** One todo per phase (Detect stack,
   Logging audit, Metrics audit, Tracing audit, Error handling and health,
   Rank and report). Exactly one phase `in_progress` at a time.

## Workflow

### Phase 1 — Detect stack

Detect the application's language, framework, AWS SDK version, and
existing observability libraries. The audit phases below need this so
their recommendations are *idiomatic* — not "use a logger" but "switch
from `logging.info` to `structlog` with `add_log_level` and `JSONRenderer`."

Detection signals:

| Signal | What it tells you |
|---|---|
| `pyproject.toml`, `requirements.txt`, `Pipfile` | Python — check for `boto3`, `aws-lambda-powertools`, `structlog`, `opentelemetry-*` |
| `pom.xml`, `build.gradle` | Java — check for `aws-sdk-java`, `micrometer`, `opentelemetry-api`, `log4j2` / `logback` |
| `package.json` | Node — check for `@aws-sdk/*`, `pino`, `winston`, `@opentelemetry/*`, `aws-lambda-powertools` |
| `go.mod` | Go — check for `aws-sdk-go-v2`, `zap`, `zerolog`, `go.opentelemetry.io/otel` |
| `Gemfile` | Ruby — check for `aws-sdk`, `lograge`, `opentelemetry-sdk` |
| `*.csproj`, `Directory.Packages.props` | C# / .NET — check for `AWSSDK.*`, `Serilog`, `OpenTelemetry` |
| `Dockerfile` | Container runtime, base image, entrypoint hints |
| `serverless.yml`, `template.yaml`, `cdk.json`, `terraform/` | Lambda / ECS / EKS / EC2 deployment surface — affects which observability path is canonical |

Record the detected stack in a "Stack" section at the top of the final
report. If detection is ambiguous (e.g. monorepo with both Python and
Go), proceed per detected language and produce one report section per
language.

### Phase 2 — Logging audit

What to look for, by language. The goal is to verify that **every log
line is structured, leveled, and correlatable to a request**.

Universal checks:

1. **Structured logging in use?** — JSON or key-value, not plain
   `print` / `console.log` / `System.out.println` / `fmt.Println`.
2. **Log levels used correctly?** — `ERROR` for actionable failures,
   `WARN` for recoverable, `INFO` for state changes, `DEBUG` gated.
3. **Correlation IDs?** — `traceId`, `requestId`, `tenantId`, or
   equivalent, propagated through every log line in a request scope.
4. **PII / secrets risk?** — flag any log call that includes a request
   body, headers, or a field literally named `password`, `token`,
   `secret`, `authorization`, `ssn`, `email` without redaction.
5. **Exception logging?** — exceptions logged with stack trace, not
   silently swallowed (`except: pass`, `catch (Exception e) {}`,
   `_ = err`).

Per-language patterns to grep for:

| Language | Anti-pattern (gap) | Idiomatic fix |
|---|---|---|
| Python | `print(`, `logging.info("foo " + str(x))` | `structlog` / `aws-lambda-powertools.Logger` with `extra={}` |
| Java | `System.out.println`, `e.printStackTrace()` | SLF4J + Logback JSON encoder, `MDC` for correlation IDs |
| JS / TS | `console.log`, string-concat messages | `pino` / `winston` JSON; `aws-lambda-powertools` for Lambda |
| Go | `fmt.Println`, `log.Printf` | `zap` / `zerolog` with structured fields, context-scoped logger |
| Ruby | `puts`, `Rails.logger.info "x #{y}"` | `lograge` JSON, `Rails.logger.tagged` |
| C# / .NET | `Console.WriteLine`, string-concat | `Serilog` structured properties, `ILogger<T>` scope |

Each gap entry must include: file path + line range, the exact bad
pattern, why it matters (e.g. "Logs Insights cannot index unstructured
strings — pattern detection in `error-spike-triage` will fail on this
service."), and a 5–10 line idiomatic fix snippet.

### Phase 3 — Metrics audit

Are custom application metrics being emitted, and how?

1. **Emission path.** Detect one of:
   - **EMF** (Embedded Metric Format) — log lines with `_aws.CloudWatchMetrics`
   - **CloudWatch Agent** scraping a `/metrics` Prometheus endpoint
   - **OpenTelemetry SDK** with OTLP exporter to ADOT collector
   - **PutMetricData direct call** — works but expensive, flag as a smell
     for high-volume services
   - **Application Signals auto-instrumentation** — check Lambda layer
     or ADOT operator manifests
   - **None of the above** — gap.
2. **Coverage of RED metrics.** For each handler / endpoint / Lambda
   function, is there at least one custom metric for:
   - Request count
   - Error count (or success/failure)
   - Latency (or timing histogram)
3. **Cardinality discipline.** Flag metrics dimensioned by user ID,
   request ID, or any unbounded value — these blow up CloudWatch billing
   and break dashboards.
4. **Naming and units.** Flag metrics without explicit units in the
   name or in EMF metadata (`Milliseconds`, `Count`, `Bytes`).
5. **Business metrics.** Note (don't fail) services that emit only
   technical metrics with no domain signal (orders processed, items
   shipped, payments succeeded). This is the difference between an
   observable service and a *useful* one.

If the service is a Lambda or ECS task with Application Signals
auto-instrumentation enabled, RED metrics are mostly free — verify the
manifest and downgrade gap severity for items the auto-instrumentation
covers.

### Phase 4 — Tracing audit

Distributed tracing — coverage, propagation, attribute richness.

1. **SDK present?** OpenTelemetry SDK or AWS X-Ray SDK imported and
   initialized. For Lambda / ECS with Application Signals
   auto-instrumentation, the SDK is injected — verify the deployment
   manifest enables it.
2. **Span coverage.** Spot-check the top-level handler and any
   downstream call (HTTP, AWS SDK, DB driver). Each should be a span:
   - HTTP server span at the entry point
   - HTTP client span for each outbound call
   - AWS SDK span (instrumentation should be auto-wired if SDK is
     instrumented)
   - DB driver span (`@opentelemetry/instrumentation-pg`,
     `aws-xray-sdk` patches, etc.)
3. **Context propagation.** For HTTP clients, verify trace headers
   (`traceparent`, `X-Amzn-Trace-Id`) are propagated outward. For async
   work (queues, Step Functions, EventBridge), verify the producer
   attaches trace context and the consumer extracts it — this is the
   most common silent gap.
4. **Span attributes.** Beyond defaults, are domain attributes attached
   to spans (`tenant.id`, `order.id`, `user.tier`)? Without these, the
   `trace-to-code` skill cannot map a slow trace to a concrete request
   class.
5. **Sampling.** Flag head-based sampling at <10% with no tail-sampler
   in front — high-error / high-latency traces will be dropped exactly
   when needed.

For each gap, name the file (initialization site if SDK is missing,
call site if a span is missing) and a fix snippet showing the imports
plus a 3–5 line span-creation block.

### Phase 5 — Error handling and health checks

1. **Try / catch boundaries.**
   - Top-level handlers must catch and log exceptions before returning
     a 5xx (don't let the runtime swallow the trace).
   - Downstream calls should distinguish *expected* errors (404 from
     dependency, throttling) from *unexpected* (timeouts, 5xx, parse
     failures).
   - Flag bare `except:` / `catch (Exception e) {}` / `_ = err` — they
     hide root-cause signal.
2. **Retries and backoff.** AWS SDK retries are usually adequate; flag
   custom retry loops with no backoff or no max-attempts cap (these
   amplify outages).
3. **Health endpoints.**
   - **Liveness** (`/health`, `/healthz`) — process is up. Should be
     cheap, no dependencies.
   - **Readiness** (`/ready`, `/readyz`) — process can serve traffic.
     Should check dependencies (DB, downstream) but with a short
     timeout and not page-able by itself.
   - For Lambda, "health" is per-invocation; flag the absence of a
     warmup or smoke-test path only if the service is latency-sensitive.
4. **Graceful shutdown.** For long-running services, verify SIGTERM
   handling — drain in-flight requests, flush log/metric buffers, close
   trace exporter. Without this, the *last* signal before a deploy
   incident is the one that gets dropped.
5. **Dependency health surfaced.** If the service has named downstreams
   (DB, cache, downstream API), is failure of each surfaced as a
   distinct error class / metric, or are they all coalesced into a
   generic 500? The latter blocks `error-spike-triage` from clustering.

### Phase 6 — Rank and report

1. **Severity rubric.** Each gap is one of:
   - 🔴 **Critical** — blocks a core investigation flow. Examples: no
     structured logging anywhere; no tracing on the Lambda handler;
     bare `except: pass` swallowing the only error path; PII logged in
     plain text.
   - 🟡 **Important** — degrades an investigation but does not block
     it. Examples: traces present but no domain attributes; latency
     metric without explicit unit; readiness check missing on a
     long-running service.
   - 🔵 **Recommended** — nice-to-have hardening. Examples: missing
     business metrics; sampling rate <50% with no tail-sampler; warm
     paths not separated from cold.
2. **Group by area** (Logging, Metrics, Tracing, Error handling, Health).
3. **For each gap, surface:**
   - File path + line range
   - The exact pattern detected (1–2 line excerpt, redacted)
   - Why it matters in production, framed in terms of the investigation
     skills (`error-spike-triage`, `latency-regression`,
     `slo-breach-investigation`) that would degrade
   - A 5–10 line idiomatic fix snippet in the detected language
   - A citation to AWS docs (via the AWS docs MCP) when available, or
     to a canonical OpenTelemetry / language-stdlib doc when not
4. **Top-of-report scorecard.** Render an at-a-glance scorecard:
   ```
   Logging:       🟡 partially structured (24 / 41 call sites)
   Metrics:       🔴 no custom metrics emitted
   Tracing:       🟢 OTel + ADOT, full coverage
   Error handling: 🟡 3 bare except blocks
   Health checks:  🔴 no /ready endpoint
   ```
5. **Top 3 fixes.** Above the full table, lead with the three highest
   leverage fixes — each one a 1-line summary plus the file to start
   with. The user should be able to read just those three lines and
   know what to do today.

## Final artifact

Render the **Observability Gap Report** using the template at
`artifacts/observability-gap-report.html`. Populate every
`{{PLACEHOLDER}}` with real data; if a placeholder cannot be filled,
write `Not detected` rather than fabricating.

The report must include:
- Stack detection block (language, framework, observability libs found)
- Scorecard (Logging / Metrics / Tracing / Error handling / Health)
- Top 3 fixes (1-line each, ranked by leverage)
- Per-area sections with gap rows: file:line, pattern, why-it-matters,
  fix snippet
- AWS docs citations where applicable
- Metadata footer (path analyzed, languages detected, # files scanned,
  generation timestamp)

**Lead with a one-line verdict** before the artifact:

> 🔴 **3 critical gaps in `services/checkout`** — no structured
> logging, no custom metrics, no `/ready` endpoint. Top fix: switch
> `print()` calls in `app/handlers/*.py` to `aws-lambda-powertools.Logger`.

The verdict must name (1) the worst severity present, (2) the
directory or service analyzed, and (3) the top fix.

## Degraded analysis handling

| Gap | Detect | Behavior |
|---|---|---|
| Path not a recognizable codebase | No manifest file, no source files | Refuse to run; ask user to specify a code path |
| Only generated / vendored code present | All source files match `vendor/` `node_modules/` `dist/` `__pycache__/` | Report empty result with explanation |
| Language detection ambiguous | Multiple manifests | Run analysis per language; report split by language |
| AWS docs MCP unavailable | Tool calls return errors | Continue without citations; note "AWS doc citations unavailable" in footer |
| Repo too large to scan in full | >5,000 candidate source files | Sample top 200 by recent git activity; note sampling in footer |

## Action safety

Read-only against the local codebase. The skill never writes files,
never runs the user's code, and never calls AWS account APIs. The AWS
documentation MCP is read-only.

## Redaction

When excerpting code lines into the report, redact:

- String literals that look like credentials, tokens, secrets,
  connection strings, or API keys — replace with `<redacted>`
- Hostnames in private domains the user hasn't shown elsewhere —
  replace with `<internal-host>` if uncertain
- File paths that include user home directory — render as relative to
  the analyzed root

The report's value is in the *shape* of the gap, not the literal
secret. If you can't tell whether a substring is sensitive, redact.

## Empty states and edge cases

- **Greenfield project, only scaffolding** — surface as "Codebase has
  no application logic yet; nothing to audit. Re-run after the first
  endpoint is implemented."
- **Already excellent** — surface a 🟢 verdict and a "What good looks
  like" recap so the user can use this report as evidence in a
  production-readiness review. Do not invent gaps to fill space.
- **Mixed monorepo** — produce one section per detected service, each
  with its own scorecard. Do not collapse them into a global average.

## What this skill does NOT do

- Does not audit infrastructure-as-code (Terraform, CDK, CloudFormation)
  for monitoring resources — that's `alerting-design`.
- Does not check existing CloudWatch alarms or metrics in the AWS
  account — that's `alerting-design`.
- Does not edit code or open PRs — recommendations are surfaced as
  snippets the user applies.
- Does not enforce a style guide or non-observability lint rules.
- Does not run the user's code, tests, or build.
