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
  version: "0.1.0"
---

# Trace-to-Code

Developer-workflow skill. Bridges the gap between "I'm looking at a failing /
slow trace in Application Signals" and "I know which file, function, and
commit to change." Most APM tools stop at the trace; this skill walks the
last mile to the diff.

## When this activates

- Developer is staring at a failing or slow trace and wants to know where
  in the code to look.
- A recent investigation (`slo-breach-investigation`, `latency-regression`,
  `error-spike-triage`) named a bad span but didn't say which class /
  method.
- An on-call engineer hands a trace ID to a developer and asks "is this
  yours?"
- Pre-fix: developer wants to confirm they're editing the right code path.
- Post-fix: developer wants to confirm new instrumentation will close the
  gap surfaced here.

## Required inputs

- A trace ID, OR a span name + service + time window.
- Read access to the service's source repo (typically the working
  directory the developer has open in Claude Code).

## Required MCP servers

- `awslabs.cloudwatch-applicationsignals-mcp-server` — trace + span data,
  including Application Signals' `aws.local.operation` /
  `aws.local.service` annotations and runtime-emitted `code.function` /
  `code.namespace` attributes when present.
- `awslabs.cloudwatch-mcp-server` — log lines correlated to the trace
  (often where stack traces live, even when spans don't carry them).

## Roadmap commands this skill supports

Several `/cw-*` commands are planned to dispatch into this skill from
specific entry points. They aren't all built yet, but this skill is the
shared workflow they'll converge on:

- `/cw-map-trace-to-code <trace-id>` — full trace-to-code mapping for
  every span on the trace path that has source attribution.
- `/cw-explain-span <trace-id> <span-name>` — focused explanation of one
  span (what code ran, what it called, where it spent time).
- `/cw-add-otel-instrumentation <service> <span-or-file>` — generates the
  OTel / ADOT instrumentation snippet to close an opaque-span gap.
- `/cw-create-fix-plan <trace-id>` — turns the analysis into a step-by-step
  fix plan (file / function / change / test).
- `/cw-validate-fix-with-telemetry <service> <commit-sha>` — after the fix
  ships, re-pulls traces in the new deploy window to confirm the bad
  span pattern is gone.

If the user invokes one of those commands and it's not yet wired up, fall
back to running this skill with the relevant phase emphasized.

## Workflow

### Phase 1 — Pull the trace and span structure

1. Resolve the trace ID. If only a span name + service + time window was
   given, search for representative traces first and pick one
   (preferring one with a captured exception or a duration outlier — the
   "interesting" trace, not the average one).
2. For every span on the trace, record:
   - Span name
   - Service / operation
   - Duration + self-time
   - Status (ok / error)
   - All `code.*` and `aws.*` attributes (especially `code.function`,
     `code.namespace`, `code.filepath`, `code.lineno` if present)
   - Exception info (`exception.type`, `exception.message`,
     `exception.stacktrace`)
3. Tag each span as **annotated** (has class.method / file info),
   **partially annotated** (has only operation name), or **opaque**
   (only a name like `HTTP GET` with no source attribution).

### Phase 2 — Span-to-code mapping

For every annotated span, walk the local repo to confirm the code
exists and resolve the actual file path. Application Signals provides
`code.namespace` (Java package or Python module) and `code.function`
(method name) on supported runtimes; treat those as authoritative when
present. When absent:

1. Search the repo for the span name as an OTel / ADOT instrumentation
   string, e.g. `tracer.start_as_current_span("checkout.process")`,
   `Tracer.startSpan("checkout.process")`, `@WithSpan("checkout.process")`.
2. Search for HTTP / RPC handlers matching the span's
   `http.route` / `rpc.method`.
3. Search the repo for the exception class + message to triangulate the
   throwing line.
4. Surface the top 2–3 file:line candidates with a confidence per
   candidate (High = exact OTel string match, Medium = handler match,
   Low = exception class match alone).

The output is a per-span block:

```
checkout.process — OK
  code.namespace: com.example.checkout.CheckoutService
  code.function:  process
  resolved file:  src/main/java/com/example/checkout/CheckoutService.java:142
  confidence:     High (exact code attribute match)
```

### Phase 3 — Recent commits correlation

1. For each resolved file, run `git log --oneline -10 -- <file>` (and
   `--since=<window-start - 7 days>` to scope).
2. Surface commits that touched the implicated file or function in the
   last 7 days. Highlight the one closest to the trace timestamp.
3. If a deploy timestamp from CloudTrail (Phase 4 of the parent
   investigation) is known, prefer commits that landed in the deploy
   window.
4. For the most likely commit, render the diff snippet that touched the
   resolved function. Cap at ±20 lines to keep output readable.

### Phase 4 — Instrumentation gaps

For every **opaque** span tagged in Phase 1, write a one-liner naming
what info is missing and how to add it:

- Span has no `code.function` → recommend adding `@WithSpan` (Java),
  `@tracer.start_as_current_span` (Python decorator), `tracer.startSpan`
  (Node), or `otel.Tracer.Start` (Go) on the relevant function.
- Span has no `exception.stacktrace` despite status=error → ensure
  `Span.recordException(e)` (or runtime equivalent) is called in the
  catch block.
- HTTP span has no `http.route` — likely a manual handler that bypasses
  the auto-instrumented framework. Recommend the auto-instrumentation
  agent or add the attribute manually.

For each gap, render a copy-paste-ready snippet for the service's
runtime. **Do not auto-edit** the code — the developer should review the
snippet and apply it via their normal workflow.

### Phase 5 — Fix plan

Synthesize Phases 2–4 into a single fix plan block:

1. **What to change** — file:line, function, summary of the diff.
2. **Why** — one sentence linking to the trace evidence (failing span,
   slow span, exception class).
3. **Tests to add or update** — name the test file by repo convention
   (e.g. `CheckoutServiceTest.testProcess_handlesNullCart`). Don't write
   the test for the developer; just point at the file.
4. **How to validate post-deploy** — the telemetry queries the developer
   should run after their change ships, expressed as `/cw-*` commands.
5. **Instrumentation to add (if any)** — the snippets from Phase 4,
   surfaced as a separate sub-list so they can be picked up
   independently of the bug fix.

### Phase 6 — Validation queries

End the artifact with the exact validation commands. These are the post-
deploy "did my fix work" queries:

- `/cw-investigate-errors <service>` — re-pull error rate after deploy.
- `/cw-verify-recovery <service> <deploy-time-iso>` — formal recovery
  verification.
- `/cw-explain-span <new-trace-id> <span-name>` — confirm the fix
  produced traces that no longer show the bad pattern.
- A focused Logs Insights query string for the exception class. Render
  the query verbatim so the developer can paste it.

## Final output

Render as a single artifact with the per-span span-to-code blocks at the
top, the recent-commits correlation in the middle, the instrumentation
gaps in a callout, and the fix plan + validation queries at the bottom.
End with a metadata footer: source MCP servers, trace ID, time window,
git revision, confidence.

**Lead with a one-line verdict** — e.g.:

> 🟠 **Trace points at `CheckoutService.process` line 142** — null cart
> handling regressed in commit `abc1234` (12 min before trace
> timestamp). Confidence: High (exact code attribute match + commit
> proximity).

If span-to-code mapping is impossible (every span is opaque), the
verdict should say so explicitly:

> ⚠️ **Cannot map trace to code — every span is opaque.** No
> `code.function` attributes captured by Application Signals. Add OTel
> instrumentation on this service before re-running. See instrumentation
> gaps below.

## Action safety

Read-only by default. The skill reads traces, reads logs, reads the local
repo. It does NOT:

- Write to files in the repo (instrumentation snippets are surfaced for
  the developer to apply manually).
- Run `git` write operations (`commit`, `push`, `checkout` of
  destructive form).
- Call any AWS write action.

If the user explicitly asks "go ahead and apply the instrumentation
snippet to file X," that is an Edit / Write operation and goes through
the plugin's normal write-confirmation gate.

## What this skill does NOT do

- Does not write the fix for the developer. The fix plan is a guide; the
  developer authors the diff. Auto-fixing without review is unsafe for
  production code.
- Does not run tests. The fix plan names which tests to update; running
  them is the developer's call (different test runners, different CI).
- Does not investigate cross-service issues. If the trace shows the bug
  is in a downstream service, hand off to that service's repo —
  trace-to-code is single-repo by design.
- Does not replace the parent investigation skills. Run
  `slo-breach-investigation` / `latency-regression` /
  `error-spike-triage` first to know which trace is interesting; then
  run trace-to-code to map it to a fix.
