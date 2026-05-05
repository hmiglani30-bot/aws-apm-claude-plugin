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

## Cohort F — Phrase variants (intent-routing breadth)

The 12 prompts in cohorts A–D are illustrative; users phrase the same
intent many ways. Cohort F is a wider sweep of variant phrasings that
must route to the same intent mode as their canonical equivalent.
Failure to match the listed mode is a hard fail on the
**Right-sized response** dimension (per the rubric above).

Each variant is graded only on intent + routing — output-shape
specifics live with the cohort A–D entry it mirrors.

### F1. Sweep variants (must NOT activate investigation skills)

| # | Variant prompt | Mode | Routes to | Mirrors |
|---|---|---|---|---|
| F1.a | "alarm count?" | Sweep | `get_active_alarms` | A2 |
| F1.b | "show alarm status" | Sweep | `get_active_alarms` (or `describe_alarms` for inventory) | A2 |
| F1.c | "SLO scoreboard" | Sweep | `slo-compliance-report` (or `list_slos` + per-SLO `get_slo`) | A5 |
| F1.d | "which SLOs are red?" | Sweep | `slo-compliance-report` | A5 |
| F1.e | "how many services unhealthy?" | Sweep | `/cw-health-check` (compact summary) | D3 |

**Anti-pattern for F1.\***: any of these activating
`alarm-response`, `slo-breach-investigation`, or `error-spike-triage`
is a fail. The activation guards on those skills must redirect.

### F2. Lookup variants (must NOT render multi-widget artifacts)

| # | Variant prompt | Mode | Routes to | Mirrors |
|---|---|---|---|---|
| F2.a | "is checkout okay?" | Lookup | `service-health-card` text-only branch | A1 |
| F2.b | "show me errors for checkout" | Lookup | Direct `get_metric_data` / `get_service` | A3 |
| F2.c | "open this trace" | Lookup | Single-focus widget pass with `trace_waterfall` | B4 (read-only variant) |

**Anti-pattern for F2.\***: rendering a 5-stat-card dashboard for
"is checkout okay?" or running the 6-phase error-spike-triage
workflow on F2.b. F2.c must NOT activate `trace-to-code`.

### F3. Investigation variants (delta + cause-finding intent)

| # | Variant prompt | Mode | Routes to | Mirrors |
|---|---|---|---|---|
| F3.a | "checkout is failing, explain why" | Investigation | `error-spike-triage` | B1 |
| F3.b | "checkout failed after deploy, investigate" | Investigation | `error-spike-triage` (with deploy correlation in Phase 4) | B1 |
| F3.c | "map this trace to code" | Investigation | `trace-to-code` | (new) |

**Pass criterion:** F3.a / F3.b activate `error-spike-triage` and produce
the Service Health Card + Top Suspected Cause artifact. F3.c specifically
activates `trace-to-code` (NOT `trace-waterfall-summary`) — its activation
guard distinguishes "show me the trace" (lookup) from "map to code"
(investigation with fix plan).

### F4. Out-of-scope variants

| # | Variant prompt | Mode | Routes to | Mirrors |
|---|---|---|---|---|
| F4.a | "can you fix my app code?" | Out-of-scope | One-line redirect (CLAUDE.md rules 5 + 6) | C2 |

**Pass criterion:** ≤ 30-word redirect, no MCP calls, no skills activated.
Any attempt to actually open the user's repo or start writing code is a
hard fail.

### Cohort F scoring

Cohort F has 12 variants. Score against the rubric in the same way as
A–D, but the manual reviewer specifically checks:

1. The skill chain weight (lookup / sweep / investigation) matches the
   variant's mode column.
2. No heavy investigation skill activates on F1.\* or F2.\*.
3. F3.c distinguishes itself from a plain trace display (F2.c) — the
   `trace-to-code` activation guard is the only thing standing between
   them.
4. F4.a does not invoke any plugin workflow.

These twelve variants are the breadth check; the cohort A–D twelve are
the depth check.

## Cohort E — Product claim validation

These evals score the artifact *itself*, not whether it was routed to.
They check three product-level claims the plugin makes:

1. **Artifact necessity** — does the model render an artifact only when
   the prompt actually warrants one?
2. **Shareability** — can the rendered artifact stand alone without the
   conversation context?
3. **Deep-link correctness** — do the embedded "Open in CloudWatch"
   links go where they say they go?

These are scored on the same 7-dimension rubric as cohorts A–D, plus
the cohort-specific checks below.

### E1. Artifact necessity

| Scenario | Expected artifact? | Pass criterion |
|---|---|---|
| **A1 / A3 (lookups)** | NO | Response is text-only. No HTML file created under `.aws-apm/artifacts/`. No manifest authored. |
| **A2 / A5 (sweeps with 0 hits)** | NO | One-line text answer ("No alarms in ALARM in `<region>`"). No multi-widget render. |
| **A2 / A5 (sweeps with ≥ 5 hits)** | YES (compact) | A single `table` widget, ≤ 200 words of text. Not the full investigation artifact shape. |
| **B1–B4 (investigations)** | YES (full) | Tier-3 artifact via `hybrid-renderer` → `render-standalone.mjs`. Verdict line above the artifact. |
| **C1 (write action)** | YES (form) | A single `action_form` widget pre-filled with the proposed write, plus the structured CONFIRM `<ToolName>` block. No execution before confirmation. |
| **C2 (out-of-scope)** | NO | One-line redirect, no MCP calls, no artifact. |
| **C3 (self-introspection)** | NO | ≤ 80-word text answer. Pointer to `ARCHITECTURE.md`. |
| **D3 (fleet health check)** | YES | Stacked-dashboard artifact; sorted by severity; Unhealthy gets full RED tables, Healthy gets a compact table. |

**Necessity fail modes:**
- Rendering a multi-widget artifact for a yes/no question (A1).
- Rendering a `stat_card` for a single-number lookup (A3).
- Auto-rendering a per-SLO investigation artifact for a portfolio sweep (A5).
- Authoring an HTML file under `.aws-apm/artifacts/` for an out-of-scope prompt (C2).

### E2. Shareability checks

A rendered artifact must be self-contained. If the user copies the HTML
file and pastes it into Slack, email, or a postmortem doc, every cell
below must hold without the conversation context. Score each rendered
artifact against the checklist:

| # | Check | Pass criterion |
|---|---|---|
| S1 | **Title** | Hero / `<title>` names the service, the SLO, or the trace ID. Not "Service Health Card" by itself. |
| S2 | **Timestamp** | ISO-8601 UTC `generated_at` plus the *data window* the artifact covers (e.g. "last 30 min vs 24h baseline"). Both, not one. |
| S3 | **Account + region** | Both rendered in the metadata footer. Pulled from `context.account` / `context.region`. Required for multi-account / multi-region setups. |
| S4 | **Source MCP servers** | Footer lists the MCP servers that produced the data (e.g. `awslabs_cloudwatch-applicationsignals-mcp-server`). Required to attribute and to debug data divergence. |
| S5 | **MCP tools called** | Footer lists the specific tools (e.g. `list_slos`, `get_slo`, `lookup_events`) so the artifact is reproducible. |
| S6 | **Confidence** | Low / Medium / High with one-sentence justification. Capped at Medium when any data source was unavailable. |
| S7 | **"Open in CloudWatch" link block** | At least one deep link is present, and it works (see E3). |
| S8 | **Renders standalone** | Open the HTML file with the browser, no internet, no other tabs. CSS, fonts, status icons all render. The renderer ships its own CSS — there is no external CDN dependency. |
| S9 | **No `{{PLACEHOLDER}}` strings** | No unfilled template placeholders survive into the output. Treat any `{{` / `}}` in rendered HTML as a fail. |
| S10 | **Copyable summary** | The verdict + key finding lines are plain text inside the artifact (not baked into an SVG / image). The user can select-copy them into a Slack message. |
| S11 | **No sensitive data leaked** | PII (emails, user IDs, customer IDs, account numbers), tokens, JWTs, and IP addresses in user contexts are redacted to `<redacted-*>` per `error-spike-triage` Redaction section. The artifact must NOT contain anything that would harm a customer if forwarded. |
| S12 | **No conversation context required** | The artifact does not contain phrases like "as I mentioned earlier", "see above", "the user asked", or "earlier in this conversation". Every claim is self-explanatory. |

**Shareability fail modes:**
- Hero says "Healthy" but the metadata footer is empty.
- Generated_at is "now" with no data window — reader cannot tell what window the numbers cover.
- Region is in the URL of one deep link but missing from the footer.
- A raw user email or `requestId` appears in a log sample.

### E3. Deep-link correctness

Every "Open in CloudWatch" link the artifact emits must satisfy:

| # | Check | Pass criterion |
|---|---|---|
| L1 | **Link target matches anchor text** | An anchor labelled "SLO detail — checkout-availability" must point at the SLO detail page for that exact SLO, not the SLO list. Anchor labelled "Trace 1-66348f12" must point at that exact trace in X-Ray. |
| L2 | **Region in URL = region in footer** | The `region=` query param (or path segment) on every link must equal `context.region`. A link to us-east-1 in an artifact tagged `us-west-2` is a fail. |
| L3 | **Time window preserved** | For surfaces that take a time range (Logs Insights query links, metric graph links, alarm history links), the URL embeds the artifact's `time_window.start` / `.end` — never `now-15m` substituted at click time. |
| L4 | **Surface-appropriate target** | Alarm link → CloudWatch Alarms detail. SLO link → Application Signals SLO detail. Trace link → X-Ray Trace detail. Logs link → Logs Insights with the query pre-filled. CloudTrail link → CloudTrail Event search. Wrong target type is a fail. |
| L5 | **Human-readable anchor** | Anchor text describes the surface, not the URL. "SLO detail — `<name>`" or "Logs Insights for `<window>`" — not bare URLs. |
| L6 | **No "now" views in investigation links** | An investigation artifact's links must point at the *frozen* incident window, not "the past 1h relative to viewing time". Otherwise the link rots the moment the investigation ends. |

These checks run against the deep-link generators in the
`open-in-cloudwatch` skill — every artifact-rendering skill is
required to use that skill rather than concatenating URLs by hand.
The `open-in-cloudwatch` skill handles region embedding, time-window
preservation, and surface-routing centrally.

**Deep-link fail modes:**
- Anchor "SLO detail — checkout-availability" → URL points at `/slo` (the list, not the detail).
- Region missing from URL — link defaults to the user's last-used console region instead of the data's region.
- Time window relativized — `start=now-1h` instead of the absolute window.
- Trace link points at the X-Ray service map instead of the trace itself.

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
