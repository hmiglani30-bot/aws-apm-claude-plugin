---
name: investigation-validator
description: >
  Self-validation checklist the model runs on its own investigation output before
  presenting it. Verifies metadata footer, evidence citations, deep links,
  considered-and-ruled-out section, burn-rate / error-budget math, and confidence
  levels. Catches the omissions that erode trust before the user sees them.
  Trigger phrases: "validate this investigation", "self-check", "self-validate",
  "review my output", "check my investigation", "is this investigation complete",
  "audit this artifact", "did I miss anything", or invoked automatically as the
  final step of `slo-breach-investigation`, `latency-regression`, and
  `error-spike-triage` before any artifact is presented to the user.
metadata:
  version: "0.1.0"
---

# Investigation Self-Validation Checklist

Run this **on your own output** after producing any Tier 3 artifact (SLO Breach
Explainer, Trace Waterfall Summary, Service Health Card, Top Suspected Cause)
and before presenting it to the user. The point is to catch the omissions that
silently erode trust — missing metadata footers, hypotheses without cited
evidence, deep links pointing at "now," confidence claims that don't match the
evidence base.

## Context provider

This validation skill reads context fields to verify they appear in the artifact's metadata footer:

- `context.region` -- must appear in metadata footer
- `context.account` -- must appear in metadata footer
- `context.time_window.start` / `.end` -- must be explicit ISO timestamps in the artifact, not relative ("last hour")

## MCP tool dependencies

None -- this skill validates investigation output. It does not call MCP tools.

## When this activates

- As the **final step** of every investigation skill (`slo-breach-investigation`,
  `latency-regression`, `error-spike-triage`) before the artifact is presented.
- On explicit user request to validate or audit prior output.
- When the user asks "did I miss anything" or "is this complete."

If a check fails, **fix the artifact first, then re-validate**. Do not present
a partially-validated artifact with caveats — fix it.

## The checklist

Walk every check in order. For each, answer Pass / Fail / N/A with a one-line
reason. Do not skip checks silently.

### 1. Metadata footer present and complete

The artifact MUST end with a metadata block containing:

- [ ] **Source MCP server(s)** — e.g. `awslabs_cloudwatch-applicationsignals-mcp-server`
- [ ] **Time window** — explicit ISO start → end in UTC, not "last hour"
- [ ] **Region** — the AWS region the data came from
- [ ] **Account** — AWS account ID or account alias if multi-account
- [ ] **MCP tools called** — list of tool names (e.g. `list_slos`, `get_trace`)
- [ ] **Confidence in causal explanation** — Low / Medium / High

Fail if any field is missing. The footer is the trust surface; an artifact
without it cannot be acted on safely.

### 2. Every hypothesis cites specific evidence

For each hypothesis in the **Top Suspected Cause** section:

- [ ] At least one **specific** evidence reference: a log line (with timestamp
      or pattern + count), a metric value (with metric name + value + window),
      or a trace ID (with the failed/slow span called out).
- [ ] Generic claims like "metrics show errors increased" do NOT count — the
      specific metric, value, and window must be cited.
- [ ] If a CloudTrail event is cited, it includes event time, event name,
      principal, and target resource.

Fail any hypothesis that lacks specific evidence. Either upgrade the evidence
or move the hypothesis to "Considered and ruled out."

### 3. Deep links for every CloudWatch surface referenced

For every CloudWatch surface mentioned in the artifact (SLOs, service map,
operations, traces, logs, alarms, CloudTrail events):

- [ ] A deep link is present (via the `open-in-cloudwatch` skill).
- [ ] The deep link includes an explicit time range — never link to a "now"
      view of an investigation window.
- [ ] The region in the URL matches the region in the metadata footer.
- [ ] Anchor text is descriptive (e.g. "SLO detail — checkout-availability"),
      not a bare URL.

Fail if any referenced surface is missing a deep link, or if any link points
to a "now" view without time range.

### 4. "Considered and ruled out" section is present

The **Top Suspected Cause** artifact requires a "Considered and ruled out"
section. Verify:

- [ ] The section exists.
- [ ] It contains at least one hypothesis the model considered and ruled out,
      with the specific evidence used to rule it out.
- [ ] If genuinely no alternatives were considered, state that explicitly —
      do not silently omit the section.

This is mandatory because it builds trust by showing the model considered
alternatives rather than anchoring on the first hypothesis.

### 5. Burn rate / error budget calculation

For SLO-related investigations:

- [ ] Burn rate is computed for at least 1h, 6h, and 24h windows.
- [ ] Burn rate is expressed as a multiplier vs normal (e.g. "28× normal"),
      not just a raw rate.
- [ ] Error budget remaining is shown both as a percent and as a raw value
      (events or minutes).
- [ ] Time-to-exhaustion is computed and stated explicitly when burn rate
      is sustained (e.g. "1h burn at 28× will exhaust remaining budget in
      ~6 hours").

For non-SLO investigations (latency regression, error spike with no SLO):

- [ ] State explicitly that no SLO is configured, rather than omitting the
      section.

Fail if burn rate is shown as a single window only, or if the multiplier-vs-
normal interpretation is missing.

### 6. Confidence levels follow the single-source rule

For every confidence claim in the artifact:

- [ ] Confidence is explicitly stated as Low / Medium / High.
- [ ] The reason for the confidence is given in one sentence.
- [ ] **A hypothesis backed by only ONE evidence source caps at Medium.** High
      confidence requires ≥2 independent sources (e.g. metric + trace, deploy
      event + log pattern). Independent means different MCP servers OR different
      data types — two metrics from CloudWatch is one source, not two.
- [ ] No hypothesis is rendered without a confidence level.

Fail if any High-confidence hypothesis is backed by a single source. Either
downgrade to Medium or surface the second source explicitly.

#### Plain-English confidence explanation

Every confidence claim must be expressed in a way the on-call can audit in one
read. The pattern is:

> **Confidence: <Low | Medium | High>** because <what we have> + but / and
> <what we are missing or what reinforces it>.

Worked examples — copy the shape, not the words:

- **High confidence** because we have a metric anomaly (5XXError 4.2% vs 0.3%
  baseline) **and** a matching trace exception (`NullPointerException` in
  `CheckoutService.processOrder`) **and** a correlated CloudTrail deploy at
  14:18 UTC, three minutes before the spike.
- **Medium confidence** because we have a metric + trace alignment, **but** no
  CloudTrail event in the window — could be a non-deploy-driven cause we have
  not yet ruled out.
- **Medium confidence** because we have a metric anomaly + log pattern, **but**
  the log pattern was not previously baselined for this service, so we cannot
  rule out that it is endemic.
- **Low confidence** because we have only a metric anomaly. No trace, no log
  pattern, no deploy correlated. Ranked as a hypothesis only because no other
  signal explains the data.
- **Medium (capped)** because CloudTrail Lake was unavailable (AccessDenied),
  so change correlation could not run. Confidence cannot exceed Medium without
  the missing source. State this in the data-unavailable banner.

If a confidence cannot be justified in this shape, it is not a confidence —
it is a guess. Downgrade and re-write.

## Role modes

The same investigation artifact serves multiple audiences, and each
prioritizes different fields. Before validating, infer the **role mode**
the user is operating in (or ask if ambiguous), then weight the checks
accordingly. Role mode does not skip checks — it raises priority on the
ones the audience most depends on, and softens the verdict on the ones
they ignore.

### SRE mode (default for live incidents)

Audience: on-call engineer in the middle of a page.

- Prioritize: verdict line (must be readable in <5 seconds), blast
  radius, top hypothesis with confidence, owner / suggested page, deep
  links to console.
- Soften: postmortem-grade narrative. SREs don't need a polished story
  during a live incident; they need actionable signals.
- Hard-fail if: verdict line is missing, blast radius is empty, owner is
  "unknown" without acknowledgment.

### Developer mode

Audience: developer on the team that owns the affected service.

- Prioritize: span-to-code mapping, recent commits correlation, fix
  plan, instrumentation gaps (delegated to `trace-to-code` skill).
- Soften: customer impact framing, severity proposal — those are SRE
  / IC concerns, not the developer's first lookup.
- Hard-fail if: a code-level hypothesis is presented without a file:line
  or commit reference, OR if `trace-to-code` was applicable but not run.

### Manager mode

Audience: engineering manager / TPM checking on the incident.

- Prioritize: customer impact estimate, severity label, expected
  recovery time, owner team, "what's blocking resolution" callout.
- Soften: stack traces, exception classes, raw query strings — managers
  don't read them.
- Hard-fail if: no quantified impact (e.g. "~1,200 failed requests")
  OR no owner team named.

### Reliability review mode

Audience: reliability / platform team doing a postmortem-quality review
of the artifact (often days after the incident).

- Prioritize: timeline accuracy with explicit timestamps, every
  hypothesis cites independent sources (≥2 for High confidence),
  considered-and-ruled-out section is non-empty, false-positive checks
  ran and their results are recorded, degraded-telemetry gaps are
  surfaced.
- Soften: live-incident urgency framing.
- Hard-fail if: confidence claims violate the single-source rule OR
  considered-and-ruled-out is missing OR any check from the workflow
  skills' false-positive / degraded-telemetry sections was skipped
  silently.

### How to detect the mode

- Explicit user signal — "I'm on-call," "I'm the IC," "writing the
  postmortem," "reviewing this for reliability week" — wins.
- Default when invoked from `/cw-alarm-response`, `/cw-investigate-*`:
  SRE mode.
- Default when invoked from `trace-to-code` or `/cw-explain-span`:
  Developer mode.
- Default when invoked after `/cw-verify-recovery`: Reliability review
  mode (we're past the live phase).
- When uncertain, ask one question — "Are you on-call right now,
  writing this up later, or reviewing for the postmortem?" — then
  proceed.

Render the chosen mode at the top of the self-validation block so the
user knows which lens was applied. If the artifact passes for one mode
but fails for another (e.g. SRE-grade complete but reliability-review
incomplete), say so — don't pick the more lenient mode silently.

## How to apply the checklist

Render the checklist results inline as a self-audit block (collapsed by
default in Cowork, expandable for verification). In Claude Code, render as:

```markdown
<details>
<summary>Self-validation: <Pass | Fail (N issues fixed)> · Mode: <SRE | Developer | Manager | Reliability review></summary>

Mode applied: SRE (live incident — prioritized verdict, blast radius, owner)
1. Metadata footer — ✅ all six fields present
2. Hypothesis evidence — ✅ all 3 hypotheses have ≥1 specific source
3. Deep links — ✅ 5 surfaces, 5 links, all with time ranges
4. Considered and ruled out — ✅ 2 alternatives ruled out with evidence
5. Burn rate / error budget — ✅ 1h/6h/24h with multipliers
6. Confidence rule — ✅ no single-source High; 1 downgraded from High → Medium

If a different mode would change the result, note it: e.g.
"Reliability-review mode would Fail this — false-positive checks not
recorded explicitly."
</details>
```

If any check fails, **fix the artifact first**, then re-render. The user
should see only the corrected artifact plus the self-validation block — never
a "Fail" result that wasn't acted on.

## What this skill does NOT do

- Does not validate AWS API correctness — that is the MCP servers' job.
- Does not validate the *truth* of evidence (e.g. whether a cited log line
  actually exists in the user's account) — that requires re-running queries.
  This skill validates that the artifact is internally consistent and complete.
- Does not replace user review — it catches structural omissions, not
  reasoning errors.

## Anti-patterns

- ❌ Skipping the checklist when "obviously fine" — most omissions look fine
  in isolation. The checklist catches the cumulative drift.
- ❌ Presenting the checklist with failures un-fixed and asking the user
  whether to proceed. Fix first; the checklist is for the model, not the user.
- ❌ Marking a check as Pass when the underlying artifact field is empty or
  placeholder text. Empty `<region>` or `<TODO>` is a Fail.
