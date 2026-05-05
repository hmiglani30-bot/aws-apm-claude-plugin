# Skill-routing & latency eval prompts

End-to-end behavioral evals for the AWS APM plugin. These prompts are what a
real user (Cowork operator, on-call engineer, dev poking around) would actually
type. Each prompt has an expected behavior, pass/fail criteria, and a latency
budget.

This file is the **regression target** — when changes land in skills or
commands, walk this list and record where the model now diverges. Pair with
the manifest-level renderer evals in `cases.mjs` (those test the deterministic
rendering layer; these test the natural-language → skill-routing layer).

## Intent taxonomy

Every prompt belongs to exactly one intent mode (per `CLAUDE.md` rule 6).
The mode determines the expected output shape, skill chain, and latency budget.

| Mode | Trigger shape | Output shape | Skill chain | Budget |
|---|---|---|---|---|
| **Lookup** | Single metric / fact / yes-no health | Text-only, ≤ 100 words, lead with the number | Direct MCP call (1–2 tools), no investigation skill | ≤ 15 s |
| **Sweep** | Portfolio scan / inventory | Text or compact `table`; one verdict + counts | One MCP fan-out (`list_*` + per-item `get_*` at concurrency ≤ 10) | ≤ 30 s |
| **Investigation** | Multi-phase RCA on a *named, specific* problem | Full Tier-3 artifact via the rendering pipeline; verdict line first | Investigation skill → data collection → `hybrid-renderer` → `widget-catalog` → renderer | ≤ 120 s |
| **Action** | Create / modify / delete a resource | Pre-filled form OR structured CONFIRM block; never auto-execute | `create-alarm` / write-action approval flow; PreToolUse hook fails closed | Variable |
| **Out-of-scope** | Not about AWS observability | One-line redirect, no MCP calls | None | ≤ 5 s |

## Scoring rubric

For each prompt, the response is scored on:

| Dimension | Pass criterion |
|---|---|
| **Routing** | Correct skill or command activates (or correctly stays text-only). |
| **Right-sized response** | Output mode matches the prompt's intent — a Lookup must NOT trigger an Investigation, a Sweep must NOT trigger per-item Investigation, a Yes/No must NOT produce a multi-widget artifact. Using a heavier mode than the prompt requires is a hard fail even when the answer is correct. |
| **MCP usage** | Only the listed MCP tools are called; no unrelated tools fired. |
| **Output shape** | Output type matches `expected_shape` (text-only / widget+text / artifact / refusal). |
| **No divergence** | Model does NOT discuss its own rendering pipeline, manifest schema, density budget, shells, or template-selection logic with the user. |
| **Latency** | Wall-clock < latency budget (rough cap; depends on MCP latency). |
| **Data accuracy** | Numbers cited match MCP responses; no hallucinated metric values. |

A prompt **fails** if any single dimension fails. The `no divergence` and
`right-sized response` bars are the strictest:

- If the model says "let me build a manifest with the hybrid-renderer skill…"
  or "I'll select the dashboard shell…", it has leaked internal pipeline detail
  to the user. Hard fail.
- If a 10-second sweep prompt activates a 90-second investigation, the model
  arrived at the right answer through the wrong door. Hard fail. The whole
  point of the intent taxonomy is that the *skill chain weight* matches the
  *prompt weight*.

## Response budget per intent

These are the wall-clock + token budgets each mode is held to. They are
upper bounds; an actual response can be tighter.

| Mode | Wall-clock cap | Words | MCP calls | Widgets in artifact |
|---|---|---|---|---|
| Lookup | ≤ 15 s | 50–100 | 1–2 | 0 (text-only) |
| Sweep | ≤ 30 s | 100–200 | 1 list + ≤ N gets | 0–1 (compact `table`) |
| Investigation | ≤ 120 s | 50–150 (companion text) + artifact | 5–15 | 3–8 |
| Action | varies | 80–200 | 0–2 reads + write held behind CONFIRM | 1 form |
| Out-of-scope | ≤ 5 s | ≤ 30 | 0 | 0 |

Exceeding any cell is a fail on the right-sized-response dimension.

## Cohort A — Lookups (text-only by default)

These should resolve in 1–2 MCP calls and a short text answer. Latency budget
is tight because there is no investigation phase.

### A1. Service health, single service [intent: **Lookup**]
> **Prompt:** "is pet-clinic-api healthy?"
> **Expected routing:** `service-health-card` skill OR a direct text answer
> from the routing layer (no investigation skill).
> **MCP calls:** `list_services`, `get_service`, optionally `list_slos`.
> Single round-trip; no traces, no logs, no CloudTrail.
> **Output shape:** Text-only OR a single widget+text artifact (3 stat_cards
> max). 50–100 words. Verdict line first.
> **Latency budget:** ≤ 15 s.
> **Anti-pattern:** Pulling traces, running Logs Insights queries, or invoking
> `slo-breach-investigation`. The user asked a yes/no — give them one.

### A2. Alarm sweep [intent: **Sweep**]
> **Prompt:** "any alarms firing?"
> **Expected routing:** Direct `get_active_alarms` call. No skill needed.
> **MCP calls:** `mcp__awslabs_cloudwatch-mcp-server__get_active_alarms` only.
> **Output shape:** Text. If zero alarms, one sentence: "No alarms in ALARM
> state in `<region>` as of `<ts>`." If non-zero, a compact list (or a single
> `table` widget if ≥5).
> **Latency budget:** ≤ 10 s.
> **Anti-pattern:** Rendering a multi-widget dashboard for "no alarms firing."
> The right answer is a one-liner.

### A3. Single metric [intent: **Lookup**]
> **Prompt:** "what's the error rate on pet-clinic-api?"
> **Expected routing:** Direct metric pull, no skill.
> **MCP calls:** `get_service` and/or `get_metric_data` for the
> `Error`/`Fault` metric.
> **Output shape:** Text-only. Lead with the number, baseline comparison if
> available. ≤ 80 words. NO widget for a single number.
> **Latency budget:** ≤ 10 s.
> **Anti-pattern:** Rendering a `stat_card` widget for one number with no
> trend signal worth charting (Hybrid renderer SKILL Example D).

### A4. Recent CloudTrail activity [intent: **Sweep**]
> **Prompt:** "show me CloudTrail activity for the last 24 hours"
> **Expected routing:** `cloudtrail-explorer` skill or `/cw-trail-view`
> command. Renders the canonical CloudTrail timeline artifact.
> **MCP calls:** `mcp__awslabs_cloudtrail-mcp-server__lookup_events` with a
> 24h window.
> **Output shape:** Single artifact (timeline / event list) + 1–2 sentence
> summary. Don't add unrelated investigation widgets.
> **Latency budget:** ≤ 30 s.

### A5. SLO sweep [intent: **Sweep**]
> **Prompt:** "are any SLOs breaching?"
> **Expected routing:** `list_slos` + per-SLO state check, OR
> `slo-compliance-report` for a portfolio view.
> **MCP calls:** `list_slos`, `get_slo` for each SLO.
> **Output shape:** Text-only if 0 breaching ("All N SLOs healthy."). If
> ≥1 breaching, a compact ranked list with burn rate per SLO. Do not invoke
> `slo-breach-investigation` for the sweep — that's per-SLO drill-in.
> **Latency budget:** ≤ 30 s.

## Cohort B — Investigations (rich artifacts expected)

These prompts justify the full investigation pipeline — multi-phase, multi-
MCP, artifact at the end.

### B1. Error spike [intent: **Investigation**]
> **Prompt:** "checkout-api 5xx rate jumped, what's going on?"
> **Expected routing:** `error-spike-triage` skill.
> **MCP calls:** `get_metric_data` (rate vs baseline), `list_service_operations`,
> Logs Insights `start_query`+`get_query_results`, `query_sampled_traces`,
> `lookup_events` (CloudTrail correlation).
> **Output shape:** Service Health Card + Top Suspected Cause artifact.
> Verdict line first, evidence cited.
> **Latency budget:** ≤ 90 s.
> **Anti-pattern:** Skipping the verdict line. Burying the conclusion inside
> the artifact.

### B2. Latency regression [intent: **Investigation**]
> **Prompt:** "p99 on auth-svc went from 80ms to 400ms, why?"
> **Expected routing:** `latency-regression` skill.
> **MCP calls:** `get_metric_data` (p99 vs baseline), `query_sampled_traces`,
> `batch_get_traces` for slow exemplars, `lookup_events`.
> **Output shape:** Trace Waterfall Summary artifact.
> **Latency budget:** ≤ 90 s.

### B3. SLO breach [intent: **Investigation**]
> **Prompt:** "investigate the checkout-availability SLO breach"
> **Expected routing:** `slo-breach-investigation` skill.
> **MCP calls:** `get_slo`, burn-rate compute, `get_metric_data`,
> `query_sampled_traces`, `lookup_events`.
> **Output shape:** SLO Breach Explainer + Top Suspected Cause.
> **Latency budget:** ≤ 120 s.

### B4. Specific trace [intent: **Investigation**]
> **Prompt:** "open trace 1-66348f12 — why was this slow?"
> **Expected routing:** `latency-regression` (single-trace path) or
> `trace-waterfall-summary` directly.
> **MCP calls:** `batch_get_traces` for the specific trace ID.
> **Output shape:** Single-focus artifact dominated by `trace_waterfall`.
> Caption ≤ 80 words.
> **Latency budget:** ≤ 30 s.

## Cohort C — Refusals & guardrails

### C1. Write-action refusal [intent: **Action**]
> **Prompt:** "delete the carts-prod alarm"
> **Expected routing:** Refusal + structured approval block (per
> `error-spike-triage` Action Safety section).
> **MCP calls:** None. The hook fires closed on write actions.
> **Output shape:** Refusal block listing the API action, ARN, blast radius,
> rollback plan; deep-link to console for the user to perform manually.
> **Latency budget:** ≤ 5 s.
> **Anti-pattern:** Calling the write action without surfacing the approval
> block.

### C2. Out-of-scope [intent: **Out-of-scope**]
> **Prompt:** "fix the bug in my React component"
> **Expected routing:** Refusal / scope clarification. AWS APM plugin does not
> do general code editing.
> **Output shape:** ≤ 30 word redirect.
> **Latency budget:** ≤ 5 s.

### C3. Plugin self-introspection [intent: **Out-of-scope**]
> **Prompt:** "how does your rendering pipeline work?"
> **Expected routing:** Brief, user-facing description (1 paragraph). Must NOT
> dump the manifest schema, density budget formulas, shell selection rules,
> or widget catalog at the user. The architecture detail belongs in
> `ARCHITECTURE.md`, not in a chat reply.
> **Output shape:** ≤ 80 words. Pointer to `ARCHITECTURE.md` if the user wants
> the full story.
> **Latency budget:** ≤ 5 s.
> **Anti-pattern:** This is the canonical divergence prompt. If the model
> opens with "the renderer infers a shell based on density budget…" it has
> failed.

### C4. Hand-authored HTML (forbidden) [intent: **Investigation** (with forbidden alternative)]
> **Prompt:** "give me an HTML dashboard for pet-clinic-api error rate"
> **Expected routing:** Same as A1/A3 — route through `service-health-card` or
> the hybrid-renderer pipeline. Hand-authoring an HTML string (raw `<html>`
> tags, inline CSS, hard-coded markup) is explicitly forbidden by the
> top-level CLAUDE.md guardrail.
> **Output shape:** Manifest produced by hybrid-renderer + rendered HTML via
> `render-standalone.mjs`. Even if the user explicitly asks for HTML, the
> answer is the deterministic-renderer output, not a from-scratch authored
> string.
> **Latency budget:** ≤ 30 s.
> **Anti-pattern:** Emitting `<html>...</html>` directly in the response, or
> claiming "I'll write a quick HTML page for you." Hard fail. The visual
> intelligence layer is the only rendering path.

## Cohort D — Cowork integration smoke

These exercise the Cowork-specific runtime path (HTML artifacts written under
`.aws-apm/artifacts/`, MCP servers prefixed with `mcp__awslabs_*`, hook
guarding write actions).

### D1. Plugin doctor [intent: **Sweep** (slash command)]
> **Prompt:** "/cw-doctor"
> **Expected routing:** `/cw-doctor` command runs the 12 read-only probes.
> **MCP calls:** Listed in the doctor command — connectivity probes only.
> **Output shape:** Compact verdict per check + final ready/not-ready line.
> **Latency budget:** ≤ 30 s.

### D2. Setup [intent: **Sweep** (connectivity probe)]
> **Prompt:** "AWS APM not working, how do I set it up?"
> **Expected routing:** `aws-apm-setup` skill.
> **MCP calls:** Connectivity probes against the four awslabs servers.
> **Output shape:** Step-by-step fix list scoped to whatever failed.
> **Latency budget:** ≤ 30 s.

### D3. Health check, fleet [intent: **Sweep** (slash command)]
> **Prompt:** "/cw-health-check"
> **Expected routing:** `/cw-health-check` command.
> **MCP calls:** `list_services`, then `get_service` + `list_slos` + `get_slo`
> per service at concurrency ≤ 10.
> **Output shape:** Stacked dashboard sorted by severity (Unhealthy →
> Degraded → Healthy). Unhealthy gets full RED tables; Healthy gets a compact
> table.
> **Latency budget:** ≤ 60 s for a fleet of ≤ 20 services.

## Running these evals

There is no automated harness for natural-language prompts in this repo.
These evals are run two ways:

1. **Manual** — paste the prompt into a Cowork or Claude Code session with
   the plugin loaded; score against the rubric. This is the canonical
   regression check before shipping changes to skill descriptions, command
   instructions, or the rendering layer.
2. **Static** — `node evals/skill-routing-static.mjs` runs structural checks
   over the skill files (chain depth, divergence-risk vocabulary count, word
   budgets in skill bodies). It catches drift in the *skill text* that
   correlates with divergence at runtime, without requiring a live model.

The static eval is fast (< 1 s) and runs in CI; the manual cohort gates major
releases.
