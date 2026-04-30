---
name: incident-memory
description: >
  Persist a structured incident summary after every investigation, and check
  prior incidents on the same service before starting a new one. Stores JSON
  files under `.aws-apm/incidents/` named by date and service. Surfaces "we
  saw this before" recurrences so the on-call doesn't re-investigate from
  scratch.
  Trigger phrases: "save incident", "record incident", "log this incident",
  "incident summary", "incident memory", "have we seen this before",
  "prior incidents", "past incidents on this service", "recurring issue",
  or invoked automatically before any investigation skill starts and after
  it produces a final artifact.
metadata:
  version: "0.2.0"
---

# Incident Memory

Persist what each investigation found so the next investigation can start
from prior context instead of from zero. Lightweight, file-based, no DB --
JSON files under `.aws-apm/incidents/` in the working directory.

## Context provider

Read these fields from the context provider (ARCHITECTURE.md context shape):

- `context.service` -- the Application Signals service name (used to glob incident files and write new ones)
- `context.region` -- AWS region (stored in incident JSON)
- `context.account` -- AWS account ID (stored in incident JSON)
- `context.time_window.start` / `.end` -- breach window (stored as `incident_started_at`)
- `context.environment` -- prod / staging / dev

## When this activates

Two distinct phases:

1. **Pre-investigation read** -- Before `slo-breach-investigation`,
   `latency-regression`, or `error-spike-triage` begins its workflow, check
   the incident directory for prior incidents on the same service.

2. **Post-investigation write** -- After any investigation skill produces
   its final artifact (and after `investigation-validator` has passed),
   write a structured incident summary file.

## MCP tool dependencies

None -- this skill uses local filesystem operations (Glob, Read, Write)
not MCP tools. All data comes from the investigation artifacts already
rendered in the session and from the context provider.

## Storage layout

```
<repo-root>/.aws-apm/incidents/
  2026-04-27_payment-service.json
  2026-04-27_checkout-service.json
  2026-04-26_payment-service.json
```

- Directory: `.aws-apm/incidents/` relative to the working directory. Create
  it if it does not exist (`mkdir -p`).
- Filename: `<YYYY-MM-DD>_<service-name>.json` using the breach start date
  in UTC. Service name is `context.service`, lowercased, with non-alphanumerics
  replaced by `-`.
- If multiple incidents on the same service on the same day, append
  `_<HHMM>` to the filename.

## Incident summary schema

Every file is a single JSON object with these fields:

```json
{
  "schema_version": "1",
  "service": "payment-service",
  "region": "us-east-1",
  "account": "123456789012",
  "incident_started_at": "2026-04-27T14:23:00Z",
  "incident_detected_at": "2026-04-27T14:31:00Z",
  "investigation_completed_at": "2026-04-27T14:48:00Z",
  "duration_minutes": 25,
  "severity": "high",
  "investigation_type": "slo-breach-investigation",
  "trigger": "checkout-availability SLO at 99.4% (target 99.9%)",
  "root_cause": {
    "claim": "Bad deploy at 14:18 UTC introduced a NullPointerException on POST /checkout",
    "confidence": "high",
    "evidence_sources": ["metric", "trace", "cloudtrail"]
  },
  "key_metrics": {
    "error_rate_peak_pct": 4.2,
    "error_rate_baseline_pct": 0.3,
    "p99_latency_ms_peak": 2400,
    "p99_latency_ms_baseline": 380,
    "burn_rate_1h": 28.4,
    "error_budget_remaining_pct": 12.0
  },
  "impacted_operations": ["POST /checkout", "POST /checkout/confirm"],
  "correlated_changes": [
    {
      "time": "2026-04-27T14:18:00Z",
      "event": "UpdateService",
      "principal": "deploy-bot",
      "resource": "arn:aws:ecs:us-east-1:123456789012:service/payment-service"
    }
  ],
  "resolution": null,
  "artifact_paths": {
    "slo_breach_explainer": "rendered inline in Claude Code session 2026-04-27"
  },
  "tags": ["bad-deploy", "slo-breach", "fast-burn"]
}
```

Required fields: `schema_version`, `service`, `region`, `account`,
`incident_started_at`, `investigation_type`, `trigger`, `root_cause`,
`key_metrics`. Everything else is best-effort.

## Pre-investigation: read prior incidents

### Step 1: Resolve and glob

Use the Glob tool to find prior incident files:

```
Glob pattern: .aws-apm/incidents/*_<service-name-lowercased>*.json
```

If the directory does not exist, output "No prior incidents recorded for
this service (incident memory not yet enabled)." and continue.

### Step 2: Read and sort

Read each matched JSON file. Parse `incident_started_at` (ISO 8601).
Sort descending. Take the 5 most recent.

### Step 3: Recurrence detection

For each prior incident, compare `root_cause.claim` against the current
trigger:

- Same exception class (e.g., both `NullPointerException`)? --> MATCH
- Same operation (e.g., both `POST /checkout`)? --> MATCH
- Same time-of-day pattern (+/- 2 hours)? --> WEAK MATCH

If any MATCH found, render a CALLOUT:

```
Possible recurrence: incident on 2026-04-19 had the same
NullPointerException on POST /checkout. Root cause was downstream RDS
connection pool exhaustion (Medium confidence). Check whether the same
pool is saturated now.
```

Do NOT skip the investigation -- recurrences can have different causes.

### Step 4: Render prior incidents table

```markdown
### Prior incidents on `<service>` (last 5)

| Date | Trigger | Root cause | Confidence | Resolution |
|---|---|---|---|---|
| 2026-04-27 | SLO breach | Bad deploy -- NullPointerException | High | Rollback |
| 2026-04-19 | Error spike (5xx) | RDS connection pool exhaustion | Medium | Pool size increased |
```

If no prior incidents exist, render: "No prior incidents recorded for
this service."

## Post-investigation: write the incident summary

### First-write opt-in (Sec5)

Incident memory is **opt-in on first write**. Before creating
`.aws-apm/incidents/` for the first time in this working directory,
render this consent block and wait for explicit user approval:

```
Incident memory -- opt-in required (first write)

This is the first time this plugin is about to persist an incident
summary in this working directory. Before any file is written, please
review:

- Path: <absolute path>/.aws-apm/incidents/
- Will be created if you approve
- Stores: structured JSON per investigation
- Lifecycle: append-only, never modified by Claude after write
- Git: `.aws-apm/` is in `.gitignore` by default

Type ENABLE INCIDENT MEMORY to allow this and all future writes in
this directory. Any other reply skips persistence for this incident.
```

**How to detect "first write":** Check for `.aws-apm/incidents/.opted-in`
sentinel file. If it exists, consent was already given. If not, prompt.

### Write procedure (after consent)

#### Step 1: Resolve filename

Compute filename per the layout rules: `<YYYY-MM-DD>_<service-name>.json`.
If that filename already exists, append `_<HHMM>`.

#### Step 2: Build the JSON object

Extract fields from the investigation artifact and context provider:

| Field | Source |
|---|---|
| `service` | `context.service` |
| `region` | `context.region` |
| `account` | `context.account` |
| `incident_started_at` | `context.time_window.start` |
| `incident_detected_at` | Alarm fire time or user report time |
| `investigation_completed_at` | Current time (ISO 8601) |
| `severity` | `critical` if SLO fast burn, `high` if SLO slow burn or 5xx >2x baseline, `medium` otherwise |
| `trigger` | One-line summary from the verdict line |
| `root_cause.claim` | #1 ranked hypothesis from Top Suspected Cause |
| `root_cause.confidence` | Confidence assigned to that hypothesis |
| `root_cause.evidence_sources` | Array of: `metric`, `log`, `trace`, `cloudtrail` as applicable |
| `key_metrics` | Peak vs baseline values from the artifact |
| `impacted_operations` | Top contributors list |
| `correlated_changes` | CloudTrail events array |
| `tags` | Model-assigned: `bad-deploy`, `dependency-degradation`, `cold-start`, etc. |

#### Step 3: Write the file

Use 2-space indentation, sorted keys, trailing newline. Write using the
Write tool.

#### Step 4: Confirm inline

```markdown
Incident summary saved: `.aws-apm/incidents/2026-04-27_payment-service.json`
```

## Error handling

| Error | Detect | Behavior |
|---|---|---|
| Directory does not exist (pre-investigation) | Glob returns empty, no directory | Output "No prior incidents recorded" and continue. |
| Directory does not exist (post-investigation) | First write, no `.opted-in` sentinel | Render consent block. Wait for ENABLE INCIDENT MEMORY. |
| User declines consent | Any reply other than exact phrase | Skip write entirely. Do not write a declined marker. Note in investigation summary that memory is disabled. |
| Target filename already exists | File with same date + service exists | Append `_<HHMM>` to filename and retry. |
| Investigation-validator failed | Metadata footer incomplete | Do NOT write. Incomplete data would be misleading. |
| User aborted investigation | No final artifact produced | Do NOT write. |
| JSON file from older schema version | `schema_version` != "1" | Read tolerantly. Parse fields that exist, ignore unknown ones. Never upgrade old files in place. |

## Few-shot examples

### Example 1: Pre-investigation with recurrence detected

**Context:** Investigating `checkout-service` for a NullPointerException spike.

**Prior incident file found:** `2026-04-19_checkout-service.json`
```json
{
  "schema_version": "1",
  "service": "checkout-service",
  "root_cause": {
    "claim": "NullPointerException in CheckoutService.process due to RDS connection pool exhaustion",
    "confidence": "medium",
    "evidence_sources": ["metric", "trace"]
  }
}
```

**Output:**
```markdown
### Prior incidents on `checkout-service` (last 5)

| Date | Trigger | Root cause | Confidence | Resolution |
|---|---|---|---|---|
| 2026-04-19 | Error spike (5xx) | NullPointerException -- RDS pool exhaustion | Medium | Pool size increased |

> **Possible recurrence:** incident on 2026-04-19 had the same NullPointerException on POST /checkout. Root cause was downstream RDS connection pool exhaustion (Medium confidence). Check whether the same pool is saturated now.

Proceeding with full investigation -- recurrences can have different root causes.
```

### Example 2: Post-investigation write

**Context:** Investigation completed for `payment-service` SLO breach.

**Written file:** `.aws-apm/incidents/2026-04-28_payment-service.json`
```json
{
  "schema_version": "1",
  "service": "payment-service",
  "region": "us-east-1",
  "account": "123456789012",
  "incident_started_at": "2026-04-28T14:23:00Z",
  "investigation_completed_at": "2026-04-28T14:48:00Z",
  "severity": "high",
  "investigation_type": "slo-breach-investigation",
  "trigger": "payment-availability SLO at 99.4% (target 99.9%)",
  "root_cause": {
    "claim": "Bad deploy at 14:18 UTC introduced auth token validation failure",
    "confidence": "high",
    "evidence_sources": ["metric", "trace", "cloudtrail"]
  },
  "key_metrics": {
    "error_rate_peak_pct": 3.8,
    "error_rate_baseline_pct": 0.2,
    "burn_rate_1h": 22.0,
    "error_budget_remaining_pct": 18.0
  },
  "tags": ["bad-deploy", "slo-breach", "fast-burn"]
}
```

## Rules

- **Opt-in on first write is mandatory.** Never create `.aws-apm/incidents/`
  without explicit user consent via the opt-in block.
- **Never overwrite an existing incident file silently.**
- **Never write incidents that lack a metadata footer in the source artifact.**
- **Do not write incidents for investigations the user aborted.**
- **Do not include PII or sensitive data.** Apply redaction rules from the
  source workflow skill before writing.
- **`.aws-apm/` is gitignored by default.**

## Schema evolution

`schema_version` is `"1"` for now. When the schema changes, bump it and
keep the reader tolerant of older versions on read.

## What this skill does NOT do

- Does not implement a search UI.
- Does not aggregate incidents across services.
- Does not call external incident management systems.
- Does not retroactively backfill older incidents from CloudTrail.
