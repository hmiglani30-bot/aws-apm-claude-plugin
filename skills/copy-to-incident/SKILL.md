---
name: copy-to-incident
description: >
  Generate paste-ready outputs from an investigation artifact — Slack incident
  channel update, incident commander summary, customer-facing status update,
  postmortem skeleton, and executive summary. Reuses the investigation-summary
  artifact's data so the on-call engineer doesn't have to retype the same facts
  in five different formats during a live incident.
  Trigger phrases: "copy to incident", "Slack update for this", "give me a
  status post", "draft a customer update", "write the postmortem skeleton",
  "exec summary", "incident commander summary", "paste-ready", "share to
  incident channel", "post this to status page", "format for postmortem",
  or any request to reformat investigation findings into a target audience's
  expected shape.
metadata:
  version: "0.1.0"
---

# Copy-to-Incident

During a live incident, the on-call engineer types the same facts into:

- the incident Slack channel,
- a status update for the incident commander,
- a customer-facing status page or email,
- the postmortem doc starting to be drafted,
- an exec summary for the leadership thread.

Each of those audiences expects a different shape, length, and tone. This
skill takes the data from a completed investigation (typically the
`investigation-summary` artifact, but also Service Health Card / SLO Breach
Explainer / Top Suspected Cause) and emits all five formats at once,
ready to paste.

## When this activates

- An investigation has produced an artifact and the user wants to share it.
- An incident is in progress and the user asks for "a Slack update" or "a
  customer update."
- An incident has resolved and the user asks for the postmortem skeleton.
- An exec or stakeholder has pinged the user and they need a one-screen
  summary.

This skill should be invoked at the **end** of the workflow skills
(`slo-breach-investigation`, `latency-regression`, `error-spike-triage`,
`alarm-response`) when the user signals they want to share findings, OR
explicitly after `/cw-verify-recovery` when writing the postmortem.

## Required inputs

Reuses data from the most recent investigation artifact in the session.
Specifically pulls:

- Service name, region, account
- Verdict line (the one-liner above the artifact)
- Timeline: breach start, mitigation time, recovery time (if available)
- Top hypothesis + confidence
- Customer impact estimate (from blast radius — see workflow skills)
- Owner / on-call contact (from `service-ownership` skill)
- Deep links (from `open-in-cloudwatch` skill)

If the data isn't available in session, ask the user which investigation
artifact to use as the source. Do not fabricate facts.

## Outputs (five formats)

Render all five in a single response, each in its own collapsible block,
with a one-click "Copy this" header so the user can grab the right
format without scrolling.

### 1. Slack incident channel update

Audience: engineers in the incident channel. Density: high. Tone: terse,
factual. Length: ≤6 lines.

```
🔴 [INC-1234] checkout-availability SLO breaching
• Started: 14:18 UTC · ~8 min ago
• Symptom: 5xx rate 14× baseline on POST /checkout
• Top hypothesis: bad deploy at 14:18 UTC (High confidence)
• Owner: @example/checkout-team · oncall: @jane.doe
• Action: rolling back deploy, ETA 2 min
🔗 SLO Breach Explainer · 🔗 Top Suspected Cause
```

Always include:
- The verdict color emoji + INC ID + service name on line 1
- Started time and elapsed
- One-line symptom description
- Top hypothesis with confidence
- Owner / on-call handle (from `service-ownership`)
- Current action being taken
- Two deep links — usually the primary artifact and the trace / metric

Do NOT include:
- Full hypothesis ranking (Slack readers don't scroll)
- Metadata footer (link to the artifact instead)
- Speculation about secondary causes

### 2. Incident commander summary

Audience: incident commander running the response. Density: medium.
Tone: structured. Length: ~10 lines.

```
[INC-1234] checkout-availability — IC summary

Status: 🔴 Active · Severity: SEV2 (estimated)
Started: 14:18 UTC · Duration: 8 min

What's happening:
  - Symptom: 5xx rate up 14× on POST /checkout
  - Customer impact: ~3.4% of checkout requests failing (est. 1,200 users)
  - SLO at risk: checkout-availability burning at 28× normal

What we know:
  - Top hypothesis: deploy at 14:18 UTC (High confidence — code change
    matched failed span exception class)
  - Considered + ruled out: dependency degradation (payment-service is
    healthy), capacity (no traffic spike)

What we're doing:
  - Rolling back deploy (ETA 2 min)
  - On-call engineer: @jane.doe (checkout-team)

What we need from IC:
  - Approve customer-facing status update (draft below)
  - Decide whether to page payment-team for awareness (no impact yet)
```

Include "What we need from IC" — the IC's job is to unblock decisions.
List the pending ones explicitly.

### 3. Customer-facing update

Audience: end users / customers. Density: low. Tone: empathetic,
non-technical. Length: 2–3 sentences.

**Default — no marketing speak, no minimization, no internal jargon.**

```
We're investigating elevated errors on checkout starting at 14:18 UTC.
A subset of customers may experience failed checkout attempts. Our team
is rolling back a recent change and expects recovery within 5 minutes.
Updates: status.example.com.
```

Variations to also produce:

- **Recovery posted update** — short, confirms recovery and apologizes:
  > "Checkout has fully recovered as of 14:26 UTC. The issue affected
  > approximately 6% of checkout attempts during the 8-minute window.
  > We apologize for the disruption and are conducting a postmortem."
- **Sustained issue update** — for incidents lasting >30 min:
  > "We are continuing to investigate elevated errors on checkout. Our
  > engineering team has identified the cause and is implementing a
  > fix. We will update again at <next-time> UTC."

Always:
- Use UTC times (or the user's configured timezone if set in session).
- Quantify impact ("a subset" / "approximately 6%") — do NOT say
  "minimal impact" without a number.
- Avoid finger-pointing at internal teams or vendors in customer copy.

### 4. Postmortem skeleton

Audience: postmortem doc that will be filled in over the next 24-48
hours. Density: structured outline. Tone: factual.

```markdown
# Postmortem: [INC-1234] checkout-availability SLO breach

**Date:** 2026-04-28
**Duration:** 14:18–14:26 UTC (8 min)
**Severity:** SEV2 (proposed)
**Author:** <fill in>
**Reviewed by:** <fill in>

## Summary
<2-3 sentence summary; pull from the verdict line + impact estimate>

## Impact
- Affected service: checkout-service
- Affected region(s): us-east-1
- Failed requests: ~1,200 (3.4% of checkout traffic)
- SLO consumption: 12% of monthly error budget consumed in 8 min
- Customer-facing: <description from the customer-facing update>

## Timeline (UTC)
- 14:18 — deploy `checkout-service@abc1234` lands; 5xx rate begins climbing
- 14:20 — alarm `checkout-5xx-high` fires; on-call paged
- 14:21 — investigation begun (slo-breach-investigation skill)
- 14:24 — top hypothesis identified: bad deploy
- 14:24 — IC approval to rollback
- 14:26 — rollback complete; recovery confirmed (cw-verify-recovery)
- 14:30 — incident declared resolved

## Root cause
<fill in based on top hypothesis from Top Suspected Cause artifact>

## What went well
- <fill in: alerting fired within 2 min of breach>
- <fill in: investigation produced top hypothesis within 6 min>

## What didn't go well
- <fill in: the change passed CI but had no canary window>
- <fill in: customer status page updated 4 min after detection>

## Action items
| # | Action | Owner | Due | Priority |
|---|---|---|---|---|
| 1 | <fill in> | <fill in> | <fill in> | <P0/P1/P2> |

## Supporting artifacts
- SLO Breach Explainer: <link>
- Top Suspected Cause: <link>
- Trace Waterfall Summary: <link>
- Recovery verification: <link>
```

Pre-fill the timeline, impact, and supporting artifacts from the
investigation data. Leave root cause / lessons learned / action items
with `<fill in>` markers — those are human judgment calls.

### 5. Executive summary

Audience: VP / leadership thread. Density: very low. Tone: business
impact first, technical detail last. Length: 3-5 lines + a bullet.

```
**[INC-1234] checkout availability incident — RESOLVED**

8-minute outage on checkout (14:18-14:26 UTC). ~1,200 customer checkouts
failed (3.4% of window traffic, ~$45K est. revenue impact). Caused by a
bad deploy that was rolled back as soon as the on-call engineer
identified the change correlation. SLO budget hit but not exhausted;
12% of monthly budget consumed.

Postmortem in progress; action items will land in the team's planning
doc by EOD Friday.
```

Always:
- Lead with status (RESOLVED / ACTIVE / MONITORING).
- Quantify customer + revenue impact if possible (use the blast radius
  estimate from the workflow skill).
- Name the proximate cause in plain English (no `NullPointerException`).
- End with what's next (postmortem, action item delivery, etc.).

## Output structure

Render all 5 formats in a single response. Use clear section headers and
ensure each block is self-contained and copy-pasteable. Do NOT mix
formats or assume the reader will scroll between them.

```markdown
## 📋 Copy-to-Incident — [INC-1234] checkout-availability

### 1. Slack incident channel update
<copyable code block>

### 2. Incident commander summary
<copyable code block>

### 3. Customer-facing update
<copyable code block — variants for active / recovered / sustained>

### 4. Postmortem skeleton
<copyable code block>

### 5. Executive summary
<copyable code block>

---

**Source artifact:** `investigation-summary.html` (or whichever)
**Generated at:** <ISO ts UTC>
**Investigation by:** <user / on-call>
```

## Confidence and edge cases

- **Customer impact unknown** — if blast radius wasn't computed, do NOT
  fabricate a number. Use "<fill in: customer impact>" in the customer-
  facing update and exec summary, and surface in the response that the
  user should run the workflow skill's blast radius step before sharing.
- **Top hypothesis confidence is Low** — soften the customer-facing
  update accordingly. "Investigating" instead of "Caused by." Don't
  publish a Low-confidence root cause externally.
- **Incident still active** — postmortem skeleton's "Resolved" timeline
  entry should be `<TBD>`. Recovery time should be `<TBD>`.
- **No incident ID known** — placeholder `[INC-XXXX]` and prompt the
  user to fill it in. Don't guess.

## Action safety

Read-only and pure transformation. The skill consumes investigation data
and emits formatted text. It does NOT:

- Post to Slack channels.
- Send emails.
- Update status pages.
- Create or modify postmortem docs in any system.
- Page anyone.

The user copies the output into wherever it belongs.

## What this skill does NOT do

- Does not generate the investigation. Run `slo-breach-investigation` /
  `latency-regression` / `error-spike-triage` / `alarm-response` first.
- Does not write the actual postmortem narrative. The skeleton is a
  scaffold; the postmortem author fills in the analysis.
- Does not decide severity. SEV1/SEV2/SEV3 calls go through the
  on-call engineer's runbook, not this skill — proposed severity is a
  suggestion.
- Does not translate to non-English languages. If the customer-facing
  update needs translation, that's a separate workflow.
