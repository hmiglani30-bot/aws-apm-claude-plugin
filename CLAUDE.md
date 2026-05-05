# AWS APM plugin — agent steering rules

These rules apply to any agent (Claude Code, Cowork, or otherwise) that has
this plugin loaded. They take precedence over the agent's own defaults
whenever the user is acting on AWS APM data.

---

## 1. Visual intelligence layer is the ONLY rendering path

This plugin ships a deterministic visual intelligence layer:

```
investigation skill  →  data collection  →  hybrid-renderer  →  widget-catalog  →  render-standalone.mjs  →  HTML artifact
```

- **ALWAYS** route visual artifacts through `hybrid-renderer` and `widget-catalog`. They decide WHICH widgets fit the data and emit a JSON manifest; the deterministic renderer (`render-standalone.mjs`) turns it into HTML.
- **NEVER** hand-author HTML, paste HTML strings, or generate raw `<html>...</html>` markup yourself. Even if the user explicitly asks for HTML, the answer is the manifest + the deterministic-renderer output.
- **NEVER** invent your own JSON manifest format, widget type, or shell — they are defined in `schemas/manifest.schema.json` and the widget catalog. If the data doesn't fit the catalog, render text-only or the closest-fitting widgets and let the renderer degrade gracefully. Do not extend the schema in-line.

The pipeline is mandatory for every visual artifact — Service Health Cards, SLO Breach Explainers, Trace Waterfall Summaries, dashboards, fleet views, error-spike triage outputs, and any artifact emitted by a `/cw-*` command.

If a query does NOT need a visual artifact (text-only lookups, refusals, simple Q&A), follow Gate 4 of the `hybrid-renderer` skill — don't author a widget you don't need. Text-only IS a valid output of the pipeline; what is forbidden is bypassing the pipeline by hand-authoring HTML.

## 2. Do not narrate the pipeline at the user

The user does not care about manifest schemas, density budgets, shell selection rules, slot overflow, or the catalog of widget types. That is internal pipeline detail. Use it; do not explain it.

- **NEVER** open a response with phrases like "I'll build a manifest…", "selecting the dashboard shell…", "the renderer will infer…", "the density budget is…".
- **NEVER** dump the widget catalog or list the seven widget types in a chat reply.
- If the user asks meta-questions ("how does your rendering work?"), answer in ≤ 80 words and point them at `ARCHITECTURE.md`. Do not paste internals into chat.

This rule is what stops the agent from "discussing rendering philosophy instead of using the established pipeline." If you find yourself writing about the pipeline rather than using it, stop and route through the skills.

## 3. Match output shape to query weight

Latency is the second failure mode. The pipeline supports text-only, widget+text, and widget-only output — pick the lightest shape that answers the question.

| Query | Shape | Skills involved |
|---|---|---|
| "is X healthy?" / "what's the p99?" / "any alarms firing?" | Text-only (50–100 words) | Direct MCP call, no investigation skill, no `hybrid-renderer` round-trip |
| `/cw-*` investigation, error spike, latency regression, SLO breach | Widget + text (50–150 words of prose) | Investigation skill → `hybrid-renderer` → renderer |
| "show me the trace", "render the dashboard" | Widget-only or widget-dominant | `hybrid-renderer` → renderer |

When in doubt about which shape, run the four gates in `skills/hybrid-renderer/SKILL.md` *silently*. Don't narrate the gating logic at the user.

## 4. The skill chain is the contract

The investigation skills are the canonical entry points for investigation queries — they pull data, produce a verdict, and **delegate rendering to `hybrid-renderer`**. They do NOT author HTML, do NOT narrate the pipeline, and do NOT skip steps.

```
user prompt
  → investigation skill (error-spike-triage / latency-regression / slo-breach-investigation / alarm-response)
  → MCP data collection (CloudWatch, App Signals, CloudTrail)
  → hybrid-renderer (decides shape: text-only vs widget+text)
  → widget-catalog (picks components when shape is widget+text)
  → render-standalone.mjs (deterministic HTML)
  → artifact written to ${CLAUDE_PROJECT_DIR}/.aws-apm/artifacts/
  → metadata footer surfaced to user (manifest path + HTML path)
```

If you skip a step, you've broken the contract. Don't.

## 5. Where to find things

- `ARCHITECTURE.md` — full pipeline architecture, context provider shape.
- `schemas/manifest.schema.json` — manifest contract enforced by the renderer.
- `evals/eval-prompts.md` — natural-language regression prompts.
- `evals/skill-routing-static.mjs` — static eval that fails CI when these rules drift.
- `evals/cases.mjs` + `evals/run-evals.mjs` — manifest-level renderer evals.
