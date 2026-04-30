---
name: trace-to-code
description: >
  Map a production trace or span back to the code that ran — extract class.method
  from Application Signals span annotations, correlate with recent commits in the
  service repo, identify instrumentation gaps where the span is opaque, and produce
  a fix plan plus a list of /cw-* commands to validate the fix with telemetry once
  it ships.
  Trigger phrases: "map trace to code", "what code threw this", "where in code is
  this span", "find the function for this trace", "span to source", "which commit
  caused this", "instrumentation gap", "missing span", "opaque span",
  "no class info on span", "fix plan from trace", "developer view of this trace",
  "what file is this", "translate trace to code change",
  or any developer-facing request that turns a trace / span into a code-level fix.
metadata:
  version: "0.2.0"
---

# Trace-to-Code

Developer-workflow skill. Bridges the gap between "I'm looking at a failing /
slow trace in Application Signals" and "I know which file, function, and
commit to change."

## Context provider

Read these fields from the context provider (ARCHITECTURE.md context shape):

- `context.service` -- the Application Signals service name
- `context.region` -- AWS region (pass to all MCP calls)
- `context.account` -- AWS account ID
- `context.time_window.start` / `.end` -- time window for trace retrieval
- `context.data_sources_available.xray` -- check before calling trace tools

## When this activates

- Developer is staring at a failing or slow trace and wants to know where
  in the code to look.
- A recent investigation named a bad span but didn't say which class / method.
- An on-call engineer hands a trace ID to a developer.
- Pre-fix: developer wants to confirm they're editing the right code path.
- Post-fix: developer wants to confirm new instrumentation closes the gap.

## Required inputs

- A trace ID, OR a span name + service + time window.
- Read access to the service's source repo (typically the working
  directory the developer has open in Claude Code).

## MCP tool dependencies

- `awslabs.cloudwatch-applicationsignals-mcp-server` -- trace + span data
- `awslabs.cloudwatch-mcp-server` -- log lines correlated to the trace

## Workflow

### Phase 1 -- Pull the trace and span structure

#### MCP tool call sequence

1. If trace ID provided:
   Call `batch_get_traces(trace_ids=[<trace-id>])` --> full trace with all segments and subsegments.

2. If only span name + service + time window given:
   Call `get_trace_summaries(start_time=<context.time_window.start>, end_time=<context.time_window.end>, filter_expression='service("<service>") AND responseTime > 1', sampling=true)` --> pick trace with captured exception or duration outlier.
   Then call `batch_get_traces(trace_ids=[<selected-id>])` for the full trace.

#### Per-span extraction

Apply to every span in the trace:

```json
{
  "span_name": "checkout.process",
  "service": "checkout-api",
  "duration_ms": 1840,
  "self_time_ms": 220,
  "status": "error",
  "code_function": "com.example.checkout.CheckoutService.process",
  "code_filepath": null,
  "exception_type": "NullPointerException",
  "exception_message": "cart is null",
  "annotation_level": "annotated"
}
```

Self-time = span duration minus sum of direct child span durations. Never
use total time for ranking -- it double-counts children.

Tag each span as:
- **annotated** -- has `code.function` / `code.namespace` / `code.filepath`
- **partially annotated** -- has only operation name
- **opaque** -- only a name like `HTTP GET` with no source attribution

### Phase 2 -- Span-to-code mapping

For every annotated span, walk the local repo to confirm the code exists.

#### Search strategy (in priority order)

1. **Exact code attribute match:** Use `code.namespace` + `code.function` to
   derive file path (e.g., `com.example.checkout.CheckoutService` -->
   `src/main/java/com/example/checkout/CheckoutService.java`). Search with
   Grep for the class/module name.

2. **OTel instrumentation string match:** Search repo for the span name as
   an instrumentation string:
   ```
   Grep pattern: 'tracer.start_as_current_span("checkout.process")'
   Grep pattern: 'Tracer.startSpan("checkout.process")'
   Grep pattern: '@WithSpan("checkout.process")'
   ```

3. **HTTP/RPC handler match:** Search for handlers matching the span's
   `http.route` or `rpc.method`.

4. **Exception class match:** Search repo for the exception class + message
   to triangulate the throwing line.

#### Per-span output format

```
checkout.process -- ERROR
  code.namespace: com.example.checkout.CheckoutService
  code.function:  process
  resolved file:  src/main/java/com/example/checkout/CheckoutService.java:142
  confidence:     High (exact code attribute match)
```

Confidence per candidate:
- **High** -- exact OTel string match or `code.*` attribute match
- **Medium** -- handler match (HTTP route / RPC method)
- **Low** -- exception class match alone

### Phase 3 -- Recent commits correlation

#### Tool call sequence

For each resolved file, run:
```bash
git log --oneline -10 --since="<context.time_window.start minus 7 days>" -- <file>
```

#### Commit-to-trace correlation

1. Surface commits that touched the implicated file or function in the
   last 7 days. Highlight the one closest to the trace timestamp.
2. If a deploy timestamp from CloudTrail (Phase 4 of the parent
   investigation) is known, prefer commits that landed in the deploy
   window.
3. For the most likely commit, render the diff snippet that touched the
   resolved function. Cap at +/-20 lines.

#### Handling edge cases

- **Local repo is not the service's repo:** Output "Warning: current
  working directory may not contain the source for `<service>`. Verify
  the repo before acting on commit correlations."
- **No git history available:** Output "No git history available. Commit
  correlation skipped."
- **No commits in window:** Output "No commits touching `<file>` in the
  last 7 days."

### Phase 4 -- Instrumentation gaps

For every **opaque** span tagged in Phase 1, write a one-liner naming
what info is missing and a copy-paste-ready fix snippet:

| Gap | Fix |
|---|---|
| No `code.function` | Add `@WithSpan` (Java), `@tracer.start_as_current_span` (Python), `tracer.startSpan` (Node), `otel.Tracer.Start` (Go) |
| No `exception.stacktrace` despite status=error | Add `Span.recordException(e)` in the catch block |
| HTTP span has no `http.route` | Add auto-instrumentation agent or set attribute manually |

**Do not auto-edit** the code. Surface snippets for the developer to
apply manually.

### Phase 5 -- Fix plan

Synthesize Phases 2-4 into a single fix plan block:

1. **What to change** -- file:line, function, summary of the diff.
2. **Why** -- one sentence linking to the trace evidence.
3. **Tests to add or update** -- name the test file by repo convention.
4. **How to validate post-deploy** -- telemetry queries as `/cw-*` commands.
5. **Instrumentation to add (if any)** -- snippets from Phase 4.

### Phase 6 -- Validation queries

End the artifact with exact validation commands:

- `/cw-investigate-errors <service>` -- re-pull error rate after deploy
- `/cw-verify-recovery <service> <deploy-time-iso>` -- formal recovery verification
- `/cw-explain-span <new-trace-id> <span-name>` -- confirm fix produced clean traces
- A focused Logs Insights query string for the exception class (render verbatim)

## Error handling

| Error | Detect | Behavior |
|---|---|---|
| `batch_get_traces` returns empty | Trace expired (>30 days) or invalid ID | Output "Trace `<id>` not found -- may have expired (>30 day retention). Ask the user for a recent trace ID." |
| `get_trace_summaries` returns empty | No traces match filter in window | Output "No traces matching `<service>` in `<window>`. Widen window or verify service name." |
| `get_trace_summaries` ThrottlingException | X-Ray rate limit | Retry once with 2s backoff. On second failure, output "X-Ray throttled. Try again in 30s or provide a specific trace ID." |
| All spans are opaque | No `code.*` attributes on any span | Lead verdict with "Cannot map trace to code -- every span is opaque." Render Phase 4 instrumentation gaps as primary output. |
| No repo in working directory | No source files found | Output "No source code in working directory. Open the service repo first, then re-run." |
| Git not available | `git log` fails | Skip Phase 3. Note "Git unavailable -- commit correlation skipped." |
| `data_sources_available.xray` is false | Context provider says no X-Ray | Output "X-Ray not available for this service. Cannot retrieve traces. Enable X-Ray instrumentation first." |

## Few-shot examples

### Example 1: Trace with annotated spans and commit correlation

**Input:** "Map trace 1-66348f12 to code"

**Output:**
```
[orange] Trace points at `CheckoutService.process` line 142 -- null cart
handling regressed in commit `abc1234` (12 min before trace timestamp).
Confidence: High (exact code attribute match + commit proximity).

### Span-to-code mapping

checkout.process -- ERROR
  code.namespace: com.example.checkout.CheckoutService
  code.function:  process
  resolved file:  src/main/java/com/example/checkout/CheckoutService.java:142
  confidence:     High (exact code attribute match)
  exception:      NullPointerException: cart is null

auth.verify -- OK
  code.namespace: com.example.auth.AuthService
  code.function:  verify
  resolved file:  src/main/java/com/example/auth/AuthService.java:58
  confidence:     High (exact code attribute match)

### Recent commits on implicated file

abc1234 (2026-04-28 14:06) Remove null check in processOrder
def5678 (2026-04-25 10:30) Add cart validation logging

### Fix plan
1. What to change: CheckoutService.java:142 -- restore null check for cart parameter
2. Why: NullPointerException thrown on every request where cart is not pre-loaded
3. Tests: CheckoutServiceTest.testProcess_handlesNullCart
4. Validate post-deploy: /cw-investigate-errors checkout-service
5. Instrumentation: none needed (spans are fully annotated)
```

### Example 2: Trace with all opaque spans

**Input:** "What code is behind span HTTP GET on payment-service?"

**Output:**
```
[warning] Cannot map trace to code -- every span is opaque. No
`code.function` attributes captured by Application Signals. Add OTel
instrumentation on this service before re-running. See instrumentation
gaps below.

### Instrumentation gaps

| Span | Gap | Fix snippet |
|---|---|---|
| HTTP GET | No code.function | Add @WithSpan("payment.getStatus") on the handler method |
| HTTP POST /charge | No code.function | Add @WithSpan("payment.charge") on the handler method |
| HTTP GET | No exception.stacktrace (status=error) | Add Span.recordException(e) in the catch block |

### Recommended: Add OpenTelemetry auto-instrumentation

For Java services, add the ADOT agent as a JVM argument:
  -javaagent:/opt/aws-opentelemetry-agent.jar
This will automatically annotate HTTP spans with code.function and code.namespace.
```

## Final output

Lead with a one-line verdict:

> [orange] **Trace points at `CheckoutService.process` line 142** -- null cart
> handling regressed in commit `abc1234`. Confidence: High.

If span-to-code mapping is impossible:

> [warning] **Cannot map trace to code -- every span is opaque.** Add OTel
> instrumentation first. See instrumentation gaps below.

## Action safety

Read-only by default. The skill reads traces, reads logs, reads the local
repo. It does NOT:
- Write to files in the repo
- Run `git` write operations
- Call any AWS write action

If the user explicitly asks to apply a snippet, route through the normal
write-confirmation gate.

## What this skill does NOT do

- Does not write the fix for the developer.
- Does not run tests.
- Does not investigate cross-service issues.
- Does not replace the parent investigation skills.
