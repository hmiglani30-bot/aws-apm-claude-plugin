---
name: slo-breach-explainer
description: >
  Render the canonical "SLO Breach Explainer" artifact — burn rate, error budget
  remaining, breach window, top impacted operations, correlated deploys, and ranked
  hypotheses, with a fixed layout.
  Trigger phrases: "SLO Breach Explainer", "render SLO breach card", "summarize SLO breach",
  "format SLO breach output", or invoked as the final artifact of `slo-breach-investigation`.
metadata:
  version: "0.1.0"
---

# SLO Breach Explainer (Tier 3 Artifact)

This is a **canonical artifact** — same investigation produces the same shape every time.
Do not reinvent the layout. Fill the known shape with MCP data.

## Context provider

This artifact skill receives its data from the parent `slo-breach-investigation` skill. The following context fields are used in the metadata footer:

- `context.service` -- the Application Signals service name
- `context.slo` -- SLO name or ID
- `context.region` -- AWS region (rendered in metadata footer)
- `context.account` -- AWS account ID (rendered in metadata footer)
- `context.time_window.start` / `.end` -- breach window

## MCP tool dependencies

None -- this is a rendering skill. Data is collected by the parent `slo-breach-investigation` skill.

## Required inputs

The parent skill (`slo-breach-investigation`) must have already collected:

- SLO name, target, time window
- Current attainment, error budget remaining (raw + percent)
- Burn rate over 1h / 6h / 24h
- Breach start time + duration
- Top 3 impacted operations with % contribution
- Top 3 correlated CloudTrail events in the breach window
- Ranked hypotheses (use `top-suspected-cause` for that section)

If any of these are missing, do not render — return to the parent skill to gather them.

## Canonical layout

```markdown
## 🚨 SLO Breach Explainer — `<SLO name>`

**Status:** <Fast burn | Slow burn | Recovered, budget depleted>
**Breach started:** <ISO timestamp> (<duration> ago)
**SLO target:** <target>% over <window> · **Current:** <current>%
**Error budget remaining:** <X>% (<raw value> events / minutes)

### Burn rate
| Window | Rate | Multiplier vs normal |
|---|---|---|
| 1h | <rate> | <Nx> |
| 6h | <rate> | <Nx> |
| 24h | <rate> | <Nx> |

> <One-sentence interpretation. e.g.: "1h burn at 28× will exhaust remaining budget in ~6 hours.">

### Top impacted operations
| Operation | Bad events | % of breach | p99 latency | Error rate |
|---|---|---|---|---|
| <op> | <n> | <pct> | <ms> | <%> |
| <op> | <n> | <pct> | <ms> | <%> |
| <op> | <n> | <pct> | <ms> | <%> |

### Correlated changes (CloudTrail, breach window ± 30m)
| Time | Event | Resource | Principal |
|---|---|---|---|
| <ts> | UpdateService | <arn> | <user> |
| <ts> | RegisterTaskDefinition | <arn> | <user> |

### Ranked hypotheses
<insert Top Suspected Cause artifact here>

### Open in CloudWatch
- [SLO detail](<deep-link>)
- [Service map at breach start](<deep-link>)
- [Logs Insights for breach window](<deep-link>)
- [CloudTrail event search](<deep-link>)

---
**Source:** `awslabs_cloudwatch-applicationsignals-mcp-server`
**Time range:** `<start>` → `<end>` (UTC)
**MCP tools called:** `<list_slos>`, `<get_slo>`, `<list_top_contributors>`, `<list_traces>`, `<lookup_events>`
**Queries used:** see Logs Insights deep link above
**Confidence in causal explanation:** <Low | Medium | High>
```

## Layout rules

- **Always lead with status + breach start.** This is the on-call's first question.
- **Burn rate table comes before operations.** Burn rate determines urgency.
- **Operations are ranked by % contribution, not by name.** Top contributor first.
- **Correlated changes table is omitted** if zero CloudTrail events match; replace with a
  one-liner: "No CloudTrail changes in window."
- **Deep links go below content, never inline** — keeps the artifact readable.
- **Metadata footer is mandatory** — this is the trust surface (Q11.2 in the scope).

## What to do if data is incomplete

If burn rate cannot be computed (insufficient samples), say so explicitly in the burn rate
section. Do **not** fabricate values. The footer's `confidence` field exists exactly for
this case.

## HTML artifact template

For Cowork (or any surface that renders HTML artifacts), use the artifact template at
`artifacts/slo-breach-explainer.html` and populate the `{{PLACEHOLDERS}}` with actual
data collected during the investigation. The template encodes the layout:
hero verdict at the top (severity icon, one-line summary, top hypothesis,
confidence, recommended next action), then burn-rate bars, error-budget gauge,
impacted-operation table, ranked hypotheses, first-class "Considered and ruled out"
section, action-grouped deep links (Verify · Investigate vs Act · Configure · Share),
suggested next commands, metadata footer, and a persistent "Open in CloudWatch"
footer bar. Do not redesign it per investigation.

The template's leading HTML comment documents the full typed schema — required +
optional fields, button contract (UX10), empty-state expectations.

Placeholder reference (non-exhaustive — open the file for the full list):

- `{{SLO_NAME}}`, `{{BREACH_START_ISO}}`, `{{BREACH_DURATION}}`, `{{AWS_REGION}}`
- `{{BURN_CLASSIFICATION}}` — Fast burn / Slow burn / Recovered, budget depleted
- `{{SLO_TARGET_PCT}}`, `{{CURRENT_ATTAINMENT_PCT}}`, `{{BUDGET_REMAINING_PCT}}`,
  `{{BUDGET_REMAINING_RAW}}`
- `{{BURN_1H_RATE}}` / `{{BURN_1H_MULTIPLIER}}` / `{{BURN_1H_PCT}}` (similar for 6h, 24h).
  `{{BURN_*_PCT}}` is the bar fill width — clamp to 0–100.
- `{{IMPACTED_OPERATIONS_ROWS}}` — `<tr><td>op</td><td class="numeric">n</td>…</tr>`
- `{{CORRELATED_EVENTS_ROWS}}` — same shape, or one `<tr><td colspan="4">No CloudTrail
  changes in window.</td></tr>` if empty
- `{{RANKED_HYPOTHESES_BLOCK}}` — inline the `top-suspected-cause` artifact body here
- Deep-link placeholders: `{{LINK_SLO_DETAIL}}`, `{{LINK_SERVICE_MAP}}`,
  `{{LINK_LOGS_INSIGHTS}}`, `{{LINK_CLOUDTRAIL}}` — generated via `open-in-cloudwatch`
- Hero placeholders: `{{SEVERITY_ICON}}`, `{{SEVERITY}}` (sev1|sev2|sev3|recovered),
  `{{HERO_VERDICT_LINE}}`, `{{HERO_TOP_HYPOTHESIS}}`, `{{HERO_CONFIDENCE}}`,
  `{{HERO_CONFIDENCE_CLASS}}`, `{{HERO_NEXT_ACTION}}`, `{{TIME_TO_EXHAUST}}`,
  `{{TOP_CONTRIBUTOR_NAME}}`, `{{TOP_CONTRIBUTOR_PCT}}` — populate from
  Phase 1 (frame the breach) and Phase 5 (ranked hypotheses).
- `{{DATA_UNAVAILABLE_BANNER}}` — emit a `<div class="data-unavailable">…</div>`
  block when CloudTrail / Logs Insights / X-Ray returned errors; otherwise
  emit the empty string. The banner names the failed source and the impact
  on confidence.
- `{{RULED_OUT_ITEMS}}` — first-class "Considered and ruled out" section.
  Emit `<li>` items each with `<span class="ro-because">Ruled out because:
  …</span>`. If empty, emit a single placeholder line.
- `{{CMD_SUGGESTIONS}}` — emit verdict-driven `<div class="cmd-suggestion">`
  blocks. For fast burn → `/cw-investigate-errors <service>` and
  `/cw-investigate-latency <service>`. For recovered → `/cw-verify-recovery
  <service>`. Each suggestion includes a one-line "why".
- `{{SAVE_ARTIFACT_BUTTON}}`, `{{SHARE_BUTTON}}` — short labels ("Save
  artifact", "Share"). The buttons render visually; click handlers are
  host-provided (Cowork: future pin / share APIs; Claude Code: inert,
  file is on disk). See the template's leading comment for the UX10
  contract.
- `{{LINK_*}}` placeholders — generated via `open-in-cloudwatch` and
  grouped into "Verify · Investigate" vs "Act · Configure · Share"
  (UX5). The persistent footer at the bottom of the page repeats the
  highest-value links so they are always within reach (UX12).
- Footer: `{{SOURCE_MCP_SERVERS}}`, `{{TIME_RANGE_START}}`, `{{TIME_RANGE_END}}`,
  `{{MCP_TOOLS_LIST}}`, `{{QUERIES_USED}}`, `{{CAUSAL_CONFIDENCE}}`,
  `{{VALIDATION_RESULT}}` (Pass / Fail summary from
  `investigation-validator`).

In **Claude Code** (terminal), the Markdown form above is the default. Both surfaces
must contain identical data — only the rendering differs. Never fabricate values to fill
a placeholder; if a value is unknown, render the placeholder with an explicit
"unavailable" string and mark it in the metadata footer's `confidence` field.
