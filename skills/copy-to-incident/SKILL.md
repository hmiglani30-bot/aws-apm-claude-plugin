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
  version: "0.2.0"
---

# Copy-to-Incident

During a live incident, the on-call engineer types the same facts into:

- the incident Slack channel,
- a status update for the incident commander,
- a customer-facing status page or email,
- the postmortem doc starting to be drafted,
- an exec summary for the leadership thread.

Each of those audiences expects a different shape, length, and tone. This
skill takes the data from a completed investigation and emits all five
formats at once, ready to paste.

## Context provider

Read these fields from the context provider (ARCHITECTURE.md context shape):

- `context.service` -- service name for all outputs
- `context.region` -- AWS region
- `context.account` -- AWS account ID
- `context.time_window.start` / `.end` -- breach window for timeline
- `context.environment` -- prod / staging / dev

## When this activates

- An investigation has produced an artifact and the user wants to share it.
- An incident is in progress and the user asks for "a Slack update" or "a
  customer update."
- An incident has resolved and the user asks for the postmortem skeleton.

This skill is invoked at the **end** of the workflow skills
(`slo-breach-investigation`, `latency-regression`, `error-spike-triage`,
`alarm-response`) when the user signals they want to share findings.

## Required inputs

Read from the context provider (ARCHITECTURE.md context shape):
- `context.service` -- service name
- `context.region` -- AWS region
- `context.account` -- AWS account ID
- `context.time_window.start` / `.end` -- breach window

Read from the investigation artifact rendered in this session:
- Verdict line (the one-liner above the artifact -- extract verbatim)
- Top hypothesis claim + confidence (from Top Suspected Cause #1)
- Blast radius section (callers, severity label, estimated failed requests)
- Owner + suggested page (from service-ownership skill output)
- Deep links (from open-in-cloudwatch skill output)

If ANY of these are missing, render the corresponding field as
`<fill in: [field name]>` rather than omitting or fabricating. Explicitly
tell the user which fields need manual completion.

#### Example data extraction

```
From investigation artifact:
  verdict = "5xx rate up 14x since 14:20 UTC on POST /checkout"
  top_hypothesis = "bad deploy at 14:18 UTC"
  confidence = "High"
  blast_radius.severity = "SEV2"
  blast_radius.failed_requests = "~1,200"
  owner = "@example/checkout-team"
  oncall = "jane.doe@example.com"
```

## MCP tool dependencies

None -- this skill does not call MCP tools. It reads data from the
investigation artifacts already rendered in the current session.

## Outputs (five formats)

Render all five in a single response. Each block MUST be self-contained
and copy-pasteable. Use clear delimiters between formats.

### Output format specification

Each format uses these exact delimiters:

```
---BEGIN SLACK UPDATE---
<content>
---END SLACK UPDATE---

---BEGIN IC SUMMARY---
<content>
---END IC SUMMARY---

---BEGIN CUSTOMER UPDATE---
<content>
---END CUSTOMER UPDATE---

---BEGIN POSTMORTEM SKELETON---
<content>
---END POSTMORTEM SKELETON---

---BEGIN EXEC SUMMARY---
<content>
---END EXEC SUMMARY---
```

### 1. Slack incident channel update

Audience: engineers in the incident channel. Density: high. Tone: terse,
factual. Length: 6 lines or fewer.

**Required fields** (every Slack update MUST include all of these):
- Line 1: verdict color emoji + INC ID + service name
- Line 2: started time and elapsed
- Line 3: one-line symptom description
- Line 4: top hypothesis with confidence
- Line 5: owner / on-call handle
- Line 6: current action being taken + two deep links

**Do NOT include:** full hypothesis ranking, metadata footer, speculation.

### 2. Incident commander summary

Audience: IC running the response. Density: medium. Tone: structured.
Length: approximately 10 lines.

**Required sections:**
- Status line (active/resolved + severity)
- "What's happening" (symptom + customer impact + SLO state)
- "What we know" (top hypothesis + what was ruled out)
- "What we're doing" (current action + on-call)
- "What we need from IC" (pending decisions -- always include this)

### 3. Customer-facing update

Audience: end users / customers. Density: low. Tone: empathetic,
non-technical. Length: 2-3 sentences.

**Rules:**
- Use UTC times
- Quantify impact with a number ("approximately 6%"), never say "minimal impact" without data
- Never name internal teams or vendors
- Produce three variants: active, recovered, sustained (>30 min)

### 4. Postmortem skeleton

Audience: postmortem doc. Density: structured outline. Tone: factual.

**Pre-fill** from investigation data: timeline, impact section, supporting artifact links.
**Leave as `<fill in>`:** root cause narrative, what went well, what didn't go well, action items.

### 5. Executive summary

Audience: VP / leadership thread. Density: very low. Tone: business
impact first, technical detail last. Length: 3-5 lines.

**Required structure:**
- Lead with status (RESOLVED / ACTIVE / MONITORING)
- Quantify customer + revenue impact
- Name proximate cause in plain English (no exception class names)
- End with what's next (postmortem, action item delivery)

## Error handling

| Condition | Behavior |
|---|---|
| No investigation artifact in session | Ask the user which investigation to use as source. Do not fabricate. |
| Customer impact unknown (blast radius not computed) | Use `<fill in: customer impact>`. Surface warning that blast radius step should be run first. |
| Top hypothesis confidence is Low | Soften customer-facing update: use "Investigating" instead of "Caused by." |
| Incident still active (no recovery time) | Set recovery timeline entries to `<TBD>`. |
| No incident ID known | Use placeholder `[INC-XXXX]` and prompt user to fill in. |
| Owner / on-call unknown | Use `<fill in: owner>` and note that `service-ownership` skill should be run first. |

## Few-shot examples

### Example 1: Active SEV2 incident with full data

**Input context:**
```
service = "checkout-service"
region = "us-east-1"
verdict = "5xx rate up 14x since 14:20 UTC on POST /checkout"
top_hypothesis = "bad deploy at 14:18 UTC"
confidence = "High"
severity = "SEV2"
failed_requests = "~1,200 (3.4% of checkout traffic)"
owner = "@example/checkout-team"
oncall = "jane.doe@example.com"
```

**Slack update output:**
```
[red circle] [INC-1234] checkout-availability SLO breaching
[bullet] Started: 14:18 UTC . ~8 min ago
[bullet] Symptom: 5xx rate 14x baseline on POST /checkout
[bullet] Top hypothesis: bad deploy at 14:18 UTC (High confidence)
[bullet] Owner: @example/checkout-team . oncall: @jane.doe
[bullet] Action: rolling back deploy, ETA 2 min
[link] SLO Breach Explainer . [link] Top Suspected Cause
```

### Example 2: Incident with incomplete data

**Input context:**
```
service = "payment-service"
region = "us-east-2"
verdict = "p99 latency up 3x on GET /status"
top_hypothesis = "downstream RDS connection pool exhaustion"
confidence = "Medium"
severity = "<fill in: severity>"
failed_requests = "<fill in: customer impact>"
owner = "<fill in: owner>"
```

**Exec summary output:**
```
**[INC-XXXX] payment-service latency incident -- ACTIVE**

Latency regression on payment-service (p99 up 3x) since <fill in: start time> UTC.
Customer impact: <fill in: customer impact -- run blast radius step>.
Likely cause: downstream database connection issue (Medium confidence --
further investigation in progress). Owner: <fill in: owner -- run
service-ownership skill>.

Next: investigating root cause; will update in 15 min.
```

## Action safety

Read-only and pure transformation. The skill consumes investigation data
and emits formatted text. It does NOT:
- Post to Slack channels
- Send emails
- Update status pages
- Create or modify postmortem docs
- Page anyone

The user copies the output into wherever it belongs.

## What this skill does NOT do

- Does not generate the investigation. Run an investigation skill first.
- Does not write the actual postmortem narrative.
- Does not decide severity. Proposed severity is a suggestion.
- Does not translate to non-English languages.
