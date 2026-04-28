---
name: top-suspected-cause
description: >
  Render the canonical "Top Suspected Cause" artifact — ranked root-cause hypotheses,
  each with evidence cards (which metrics, logs, traces, deploys), confidence score,
  and a suggested next read-only verification step.
  Trigger phrases: "top suspected cause", "rank hypotheses", "what's the root cause",
  "most likely cause", "render hypotheses", or invoked as the final artifact of
  any investigation skill.
metadata:
  version: "0.1.0"
---

# Top Suspected Cause (Tier 3 Artifact)

Ranked hypotheses with explicit evidence and confidence. Designed to be **falsifiable** —
each hypothesis includes a concrete next step the user can run to verify or rule it out.

## Required inputs

For each hypothesis (target 2–4 total):
- One-line claim
- Supporting evidence (≥1 source: metric / log pattern / trace / CloudTrail event)
- Confidence (Low / Medium / High) with stated reason
- One concrete next read-only verification step

Hypotheses without ≥1 piece of evidence should not be rendered. Speculation belongs in a
"Considered and ruled out" section, not in the ranked list.

## Canonical layout

```markdown
## 🔍 Top Suspected Cause

### #1 · <claim> — Confidence: **<High | Medium | Low>**
> <One-line elaboration of *why* this is the top hypothesis.>

**Evidence**
- 📈 Metric: <metric ref> — <observation>
- 📜 Log: <log pattern> (<count> matches in window) — <link to Logs Insights>
- 🧵 Trace: <trace ID short> — <observation about the failed/slow span>
- 🛠️ CloudTrail: <event @ time> by <principal>

**Why this confidence:** <One sentence explaining the floor and ceiling on the
evidence — e.g. "Metric + trace align cleanly, but no CloudTrail event in window
prevents High.">

**Next step (read-only):** <Specific verification action the user can take, e.g.
"Run Logs Insights `<query>` for the previous 6h to confirm the pattern existed before
the suspected deploy.">

---

### #2 · <claim> — Confidence: **<...>**
[same shape]

---

### Considered and ruled out
- <claim> — ruled out because <evidence>
```

## Ranking rules

Rank by confidence first, then by user-impact-if-true:
1. **High confidence + high impact** — top
2. **High confidence + low impact** — next
3. **Medium with multi-source evidence** — next
4. **Low confidence** — only include if it's the *only* explanation that would account
   for the data. Otherwise rule it out explicitly.

A hypothesis backed by **only one** evidence source caps at **Medium** confidence. High
confidence requires ≥2 independent sources (metric + trace, deploy + log pattern, etc.).

## Visual grammar rules

- **Always show 2–4 hypotheses.** One is overconfident; five is noise.
- **Confidence is bolded** so it's the second-readable element after the claim.
- **Evidence is iconized** (📈 📜 🧵 🛠️) so users can scan quickly for "what kind of evidence."
- **Next step is read-only** — never propose a write action without an explicit
  confirmation gate elsewhere.
- **"Considered and ruled out" is mandatory** — it builds trust by showing the model
  considered alternatives.

## Empty states (UX11)

- **Zero hypotheses with evidence** — render the hero with a "🟡 No
  high-confidence cause identified" verdict, an "Investigate further" next
  action, and a single "Considered and ruled out" section listing every
  hypothesis that lacked evidence. Never invent hypotheses to fill the
  card.
- **Single hypothesis** — render with confidence capped at Medium even if
  the evidence is strong. A single hypothesis with no alternatives is a
  weaker conclusion than a ranked list with explicit ruled-outs.
- **All hypotheses ruled out** — render the "Considered and ruled out"
  section as primary content with a "🟡 No surviving hypothesis" verdict
  and a recommendation to widen the time window or pull more sources.
- **No CloudTrail signals at all** — note "no change correlation
  available" once in the artifact rather than omitting silently. If
  CloudTrail is the missing source rather than the empty result, surface
  the data-unavailable banner.

## Anti-patterns

- ❌ "It's probably a deploy" with no CloudTrail evidence cited.
- ❌ Five hypotheses, all Medium confidence — looks like a guess salad.
- ❌ Recommending a write action ("create alarm to watch this") in Next Step without
  routing through a confirmation gate.
- ❌ Ranking purely by user-impact when confidence varies — confidence dominates.

## HTML artifact template

For Cowork (or any surface that renders HTML artifacts), use the artifact template at
`artifacts/top-suspected-cause.html` and populate the `{{PLACEHOLDERS}}` with actual
data. The template encodes a hero verdict at the top (severity icon, top-claim
summary, confidence, recommended next action), then ranked-hypothesis cards (each
with detailed evidence cards — see "Evidence card schema" below — confidence
badges, why-this-confidence callout, falsifiable next step), a first-class "What I
ruled out" section, action-grouped deep links, suggested commands, and a persistent
"Open in CloudWatch" footer. Do not redesign it.

The template's leading HTML comment documents the full typed schema — required +
optional fields, evidence card structure, button contract (UX10).

### Evidence card schema (UX3)

Each evidence card has five required fields and is one of five kinds. The kinds
get a colored left border + icon so the reader can scan for "what kind of
evidence" before reading content:

| Kind | Icon | Border | Source examples |
|---|---|---|---|
| **Metric** | 📈 | info-blue | CloudWatch metric, Application Signals RED tile |
| **Trace** | 🧵 | purple | X-Ray trace + failed/slow span |
| **Log** | 📜 | warning-orange | Logs Insights pattern + count |
| **Deploy / CloudTrail** | 🛠️ | error-red | UpdateService, RegisterTaskDefinition, IAM change |
| **Dependency** | 🔗 | teal | Application Signals service map node + verdict |

Each card MUST populate:

1. **kind icon + label** — the visual category
2. **source** — which MCP server / dashboard provided the data (e.g.
   `awslabs.cloudwatch-applicationsignals-mcp-server`, `Logs Insights`,
   `CloudTrail Lake`)
3. **timestamp** — ISO UTC of the observation (or window for log patterns)
4. **value** — the actual observation: metric+number, trace ID + span name,
   log pattern + count, event name + principal, dependency name + verdict
5. **link** — deep link to view the evidence directly in CloudWatch / X-Ray
   / CloudTrail

Cards without all five fields do not count toward confidence — generic
"metrics show errors" without a specific value, source, time, and link is
not evidence.

Placeholder reference (non-exhaustive):

- `{{INVESTIGATION_TITLE}}`, `{{INVESTIGATION_WINDOW}}`, `{{AWS_REGION}}`
- Per hypothesis (1..N, repeat for 2–4 hypotheses):
  - `{{HYP1_CLAIM}}`, `{{HYP1_ELABORATION}}` (one-line italic elaboration)
  - `{{HYP1_CONFIDENCE}}` (`HIGH` / `MEDIUM` / `LOW`) + `{{HYP1_CONFIDENCE_CLASS}}`
    (`high` / `medium` / `low`)
  - `{{HYP1_EVIDENCE_CARDS}}` — emit one `<div class="evidence-card">…</div>` per
    evidence item. Use the iconized kinds:
    - 📈 Metric · 📜 Log · 🧵 Trace · 🛠️ CloudTrail
    Each card has `{{EVIDENCE_KIND}}`, `{{EVIDENCE_TEXT}}`, `{{EVIDENCE_CITATION}}`
    (a metric ID, log group / queryId, trace ID, or CloudTrail event ID).
  - `{{HYP1_WHY_CONFIDENCE}}` — one sentence explaining the floor and ceiling
  - `{{HYP1_NEXT_STEP_TEXT}}` — describe the read-only verification
  - `{{HYP1_NEXT_STEP_QUERY}}` — the exact Logs Insights / metric-math / CLI command
  - `{{HYP1_NEXT_STEP_LINK}}` — deep link via `open-in-cloudwatch`
- `{{HYP3_BLOCK_OPTIONAL}}` / `{{HYP4_BLOCK_OPTIONAL}}` — emit a full `<div class="hypothesis">…</div>`
  block when present, leave empty otherwise
- `{{RULED_OUT_ITEMS}}` — `<li>{{CLAIM}} — ruled out because {{EVIDENCE}}</li>` rows;
  always include this section even when empty (one `<li>None — all hypotheses
  retained.</li>`)
- Hero placeholders: `{{SEVERITY_ICON}}`, `{{SEVERITY}}` (sev1|sev2|sev3),
  `{{HERO_VERDICT_LINE}}`, `{{HERO_TOP_CLAIM}}`, `{{HERO_CONFIDENCE}}`,
  `{{HERO_CONFIDENCE_CLASS}}`, `{{HERO_NEXT_ACTION}}`, `{{HERO_NEXT_ACTION_LINK}}`,
  `{{INVESTIGATION_TYPE}}` (e.g. "SLO breach", "Latency regression",
  "Error spike"). The hero is the 2-second read.
- `{{DATA_UNAVAILABLE_BANNER}}` — emit a `<div class="data-unavailable">…</div>`
  block when one or more sources failed; otherwise emit the empty string.
- `{{CMD_SUGGESTIONS}}` — emit verdict-driven `<div class="cmd-suggestion">`
  blocks: e.g. `/cw-investigate-slo <service>`, `/cw-verify-recovery
  <service>`. Each suggestion includes a one-line "why".
- `{{SAVE_ARTIFACT_BUTTON}}`, `{{SHARE_BUTTON}}` — short labels. Buttons
  render visually; click handlers are host-provided (Cowork: future pin /
  share APIs; Claude Code: inert, file is on disk).
- `{{LINK_*}}` placeholders — generated via `open-in-cloudwatch` and grouped
  into "Verify · Investigate" vs "Act · Configure · Share" (UX5). The
  persistent footer at the bottom of the page repeats the highest-value
  links (UX12).
- Footer: `{{SOURCE_MCP_SERVERS}}`, `{{TIME_RANGE_START}}`, `{{TIME_RANGE_END}}`,
  `{{MCP_TOOLS_LIST}}`, `{{HYP_TOTAL_CONSIDERED}}`, `{{HYP_RANKED_COUNT}}`,
  `{{HYP_RULED_OUT_COUNT}}`, `{{VALIDATION_RESULT}}` (Pass / Fail summary
  from `investigation-validator`).

In **Claude Code** (terminal), use the Markdown form above. Both must contain identical
data — only the rendering differs.
