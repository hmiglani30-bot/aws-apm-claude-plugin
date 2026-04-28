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
  version: "0.1.0"
---

# Incident Memory

Persist what each investigation found so the next investigation can start
from prior context instead of from zero. Lightweight, file-based, no DB —
JSON files under `.aws-apm/incidents/` in the working directory.

## When this activates

Two distinct phases:

1. **Pre-investigation read** — Before `slo-breach-investigation`,
   `latency-regression`, or `error-spike-triage` begins its workflow, check
   the incident directory for prior incidents on the same service. Surface
   any matches inline so the model and user can spot recurrences.

2. **Post-investigation write** — After any of the three investigation skills
   produces its final artifact (and after `investigation-validator` has
   passed), write a structured incident summary file.

## Storage layout

```
<repo-root>/.aws-apm/incidents/
├── 2026-04-27_payment-service.json
├── 2026-04-27_checkout-service.json
├── 2026-04-26_payment-service.json
└── ...
```

- Directory: `.aws-apm/incidents/` relative to the working directory. Create
  it if it does not exist (`mkdir -p`).
- Filename: `<YYYY-MM-DD>_<service-name>.json` using the breach start date
  in UTC. Service name is the Application Signals service name, lowercased,
  with non-alphanumerics replaced by `-`.
- If multiple incidents on the same service on the same day, append
  `_<HHMM>` to the filename (e.g. `2026-04-27_payment-service_1430.json`).

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
  "resolution": {
    "action": "Rollback via ECS UpdateService to prior task definition",
    "by": "user",
    "at": "2026-04-27T14:48:00Z",
    "verified": true
  },
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

Before any investigation workflow begins, run this lookup:

1. Resolve the service name (same name the investigation is about to use).
2. Glob `.aws-apm/incidents/*_<service-name>.json` and read the 5 most
   recent by `incident_started_at`.
3. Render a "Prior incidents on this service" block at the top of the
   investigation:

```markdown
### 📂 Prior incidents on `<service>` (last 5)

| Date | Trigger | Root cause | Confidence | Resolution |
|---|---|---|---|---|
| 2026-04-27 | SLO breach (checkout-availability) | Bad deploy — NullPointerException | High | Rollback |
| 2026-04-19 | Error spike (5xx) | Downstream RDS connection pool exhaustion | Medium | Pool size increased |
| ... |
```

4. If any prior incident's `root_cause.claim` matches the current trigger
   pattern (same exception class, same operation, same time-of-day), surface
   it as a **"Possible recurrence"** callout above the investigation. Do
   NOT skip the investigation — recurrences can have different root causes.

5. If no prior incidents exist, render a one-liner: "No prior incidents
   recorded for this service."

## Post-investigation: write the incident summary

After the investigation produces its final artifact and
`investigation-validator` passes:

1. Resolve the filename per the layout rules above.
2. Build the JSON object. Fields the model already has from the
   investigation:
   - `service`, `region`, `account` — from the metadata footer
   - `incident_started_at` — breach start time (SLO) or spike start (errors
     / latency)
   - `incident_detected_at` — when the user / alarm flagged it
   - `investigation_completed_at` — now
   - `severity` — derive: `critical` if SLO fast burn, `high` if SLO slow
     burn or 5xx spike >2× baseline, `medium` otherwise
   - `trigger` — one-line summary of why the investigation ran
   - `root_cause.claim` — the #1 ranked hypothesis
   - `root_cause.confidence` — the confidence assigned to that hypothesis
   - `root_cause.evidence_sources` — which kinds of evidence backed it
     (`metric`, `log`, `trace`, `cloudtrail`)
   - `key_metrics` — pull from the artifact (peak vs baseline, burn rate,
     error budget remaining)
   - `impacted_operations` — top contributors from the investigation
   - `correlated_changes` — CloudTrail events found
   - `tags` — model-assigned categorical labels (e.g. `bad-deploy`,
     `dependency-degradation`, `cold-start`, `secret-rotation`)
3. `resolution` is left null at write time — the user will fill it in
   later, or a follow-up `/cw-incident-resolve` command can update the
   file. Do not block on resolution to write the summary.
4. Write the JSON file. Use 2-space indentation, sorted keys, trailing
   newline.
5. Confirm the write inline:
   ```markdown
   📒 Incident summary saved: `.aws-apm/incidents/2026-04-27_payment-service.json`
   ```

## Rules

- **Never overwrite an existing incident file silently.** If the target
  filename already exists, append `_<HHMM>` and try again.
- **Never write incidents that lack a metadata footer in the source
  artifact.** The footer is the source of truth for `region`, `account`,
  `time window`. If `investigation-validator` failed and the footer is
  incomplete, do not write — the file would be misleading.
- **Do not write incidents for investigations the user aborted** (e.g. the
  user said "stop, this isn't the right service"). Only write when the
  investigation produced a final artifact.
- **Do not include PII or sensitive data** — log lines may contain user
  identifiers, request bodies, or secrets. The summary cites *patterns*
  and *exception classes*, not raw log lines or trace payloads. If a log
  pattern includes user data, redact before writing.
- **`.aws-apm/` should be gitignored by default** unless the user
  explicitly opts in to committing incident history. Surface this once on
  first write: "Incident memory writes to `.aws-apm/incidents/`. Add to
  `.gitignore` if you don't want incidents committed."

## Schema evolution

`schema_version` is `"1"` for now. When the schema changes, bump it and
keep the reader tolerant of older versions on read. Never silently
upgrade old files on the fly — that would obscure history.

## What this skill does NOT do

- Does not implement a search UI — globbing the directory is sufficient
  for the volumes expected (typically <100 incidents per service per year).
- Does not aggregate incidents across services — that is the
  `/cw-health-check` command's job, not this skill's.
- Does not call out to external incident management systems (PagerDuty,
  Incident.io). Integration with those is out of scope; this skill
  produces a local file the user can pipe to whatever system they prefer.
- Does not retroactively backfill older incidents from CloudTrail — only
  records what the model investigated in the current session.
