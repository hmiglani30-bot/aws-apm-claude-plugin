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

## Anti-patterns

- ❌ "It's probably a deploy" with no CloudTrail evidence cited.
- ❌ Five hypotheses, all Medium confidence — looks like a guess salad.
- ❌ Recommending a write action ("create alarm to watch this") in Next Step without
  routing through a confirmation gate.
- ❌ Ranking purely by user-impact when confidence varies — confidence dominates.
