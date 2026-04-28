---
name: service-ownership
description: >
  Resolve who owns a service — checks AWS resource tags (Owner, Team, CostCenter),
  AWS Service Catalog, repo CODEOWNERS, GitHub team membership, PagerDuty escalation
  policies, and Slack channel configuration to produce a "Likely owner" line and
  "Suggested page" target. Used by every investigation artifact so the on-call
  engineer knows who to escalate to.
  Trigger phrases: "who owns this service", "service owner", "who do I page",
  "escalation target", "who's on-call for X", "team for service", "service runbook
  owner", "owner for this", "who is responsible", "find the owning team",
  "CODEOWNERS for this service", "PagerDuty for service",
  or any request that needs to map a service or resource to a human / team.
metadata:
  version: "0.1.0"
---

# Service Ownership Resolution

Resolves the owner of an AWS service or resource by looking it up across the
sources teams typically register ownership in. The output is a
**"Likely owner"** line and a **"Suggested page"** target that get embedded
in the metadata footer of investigation artifacts (Service Health Card, SLO
Breach Explainer, Top Suspected Cause, Trace Waterfall Summary).

## When this activates

- Any investigation skill produces an artifact and needs an owner field.
- An on-call engineer asks "who do I escalate this to" or "who owns
  service X."
- A degraded downstream dependency is identified and the user needs to
  know whose problem to make.
- A `/cw-alarm-response` resolves to a service the on-call engineer
  doesn't recognize.

## Required inputs

- A service name OR a resource ARN OR an Application Signals service
  identifier.

## Sources, in priority order

The skill walks each source until it has high-confidence ownership, OR
until it has consulted all sources and assembles the best aggregate.
Higher-priority sources win conflicts but lower-priority sources are
still surfaced as cross-references.

### 1. AWS resource tags

Check tags on the underlying resource (ECS service, Lambda function, EKS
deployment, etc.):
- `Owner` / `owner`
- `Team` / `team`
- `CostCenter` / `cost-center`
- `oncall` / `pagerduty-service` / `slack-channel`

Tag conventions vary across orgs. Capture every key that looks
ownership-shaped, normalize to lowercase, and keep the raw values.

### 2. AWS Service Catalog

If the resource was provisioned via Service Catalog, the product /
provisioning record often carries owner metadata. Look up the
provisioned product by resource ID and surface its owner.

### 3. CODEOWNERS in the service's source repo

If a repo is associated with the service (via tag, Service Catalog, or
naming convention), grep `.github/CODEOWNERS` (or `CODEOWNERS` at root)
for the entries matching the service's primary directories.

A `CODEOWNERS` entry like `/services/checkout/ @example/checkout-team`
means the GitHub team `@example/checkout-team` owns the checkout
service's source. Surface both the team handle and the human members if
known.

### 4. GitHub teams

If a CODEOWNERS team is found, optionally resolve its membership (only if
the user has provided GitHub access — do not assume). Surface the team
name + a count of members + the team's URL. Do not paste the full member
list into the artifact unless the user asks; that's information density
that doesn't pay rent in a triage artifact.

### 5. PagerDuty escalation policy

Look up the service in PagerDuty by name OR by `pagerduty-service` tag.
Surface:
- The service's escalation policy name
- The current on-call user (top of the policy)
- The escalation steps (1st level, 2nd level)

If the user does not have a PagerDuty integration configured, skip this
source silently (don't fail the skill on missing integrations) but note
"PagerDuty not configured" in the source list.

### 6. Slack channel configuration

Check for a Slack channel referenced in:
- The service's `slack-channel` AWS tag
- A `RUNBOOK.md` / `README.md` in the service's repo
- The PagerDuty service's notes / runbook URL

Surface the canonical channel handle (e.g. `#checkout-oncall`).

## Output structure

Render the resolution as a compact block embeddable into investigation
artifacts. There are two output modes:

### Mode A — Inline (default)

For embedding into an existing artifact's metadata footer or a "Who to
escalate" block:

```markdown
**Likely owner:** `@example/checkout-team` (CODEOWNERS) · also tagged
`Owner=checkout-platform`
**Suggested page:** PagerDuty `checkout-availability` policy · current
on-call: `<user>` · Slack: `#checkout-oncall`
**Sources consulted:** AWS tags ✅ · Service Catalog ⚠️ (no record) ·
CODEOWNERS ✅ · GitHub team ✅ · PagerDuty ✅ · Slack ✅
**Confidence:** High (3 sources agree)
```

### Mode B — Standalone

When invoked directly as "who owns service X," produce a fuller artifact
with each source's findings as its own subsection. Include conflict
resolution if any source disagrees:

```markdown
## 👤 Service Ownership: `checkout-service`

**Likely owner:** `@example/checkout-team`
**Suggested page:** PagerDuty `checkout-availability` policy
**Confidence:** High

### Source-by-source

#### AWS tags
- `Owner = checkout-platform`
- `oncall = checkout-team`
- `slack-channel = #checkout-oncall`

#### Service Catalog
No record found. (Service may have been provisioned outside Service
Catalog, e.g. via Terraform.)

#### CODEOWNERS
- `/services/checkout/` → `@example/checkout-team`

#### GitHub team
- `@example/checkout-team` — 8 members · https://github.com/orgs/example/teams/checkout-team

#### PagerDuty
- Escalation policy: `checkout-availability`
- Current on-call: `jane.doe@example.com`
- 2nd-level: `@example/checkout-team` rotation

#### Slack
- `#checkout-oncall` (from AWS tag)

### Conflicts
None — all sources point to the checkout-team.

---

**Sources consulted:** 5/6 — Service Catalog returned no record.
**Confidence:** High — 3 independent sources agree on `@example/checkout-team`.
```

## Confidence rule

- **High** — ≥2 independent sources agree (e.g. CODEOWNERS + AWS tag, or
  PagerDuty + Service Catalog).
- **Medium** — exactly 1 source has a clear answer; other sources are
  silent.
- **Low** — no source has a clear answer; the best guess is from naming
  convention or a single weakly-trusted tag (e.g. `costcenter` only).
- **Unknown** — no source returned ownership info. Surface the gap and
  suggest the user add ownership tags or a CODEOWNERS entry. Do NOT
  guess from a service name; it's better to say "unknown" than to
  misdirect the page.

## Embedding into other skills

The investigation skills (`slo-breach-investigation`, `latency-regression`,
`error-spike-triage`, `alarm-response`, `service-health-card`) should
invoke this skill once per investigation, after the affected service has
been identified, and embed the Mode A output in:

- The Service Health Card metadata footer
- The SLO Breach Explainer "Who to escalate" block
- The Top Suspected Cause "Suggested next action" — if the action is
  "page the team that owns service X," include the page target inline.

The investigation-summary artifact has a placeholder for the owner block
— populate it from this skill's output rather than leaving the
placeholder blank.

## Action safety

Read-only across all sources. The skill reads:
- AWS resource tags (read-only AWS APIs)
- Service Catalog provisioned products (read-only AWS APIs)
- The local repo's CODEOWNERS file
- GitHub teams (read-only GitHub API, only if user has provided access)
- PagerDuty escalation policies (read-only PagerDuty API, only if user
  has integration configured)
- Slack channel handles (read from runbook docs only — does not call
  Slack APIs)

It does NOT page anyone, post anywhere, or modify ownership records.
"Suggested page" is exactly that — a suggestion the user must act on
manually.

## What this skill does NOT do

- Does not auto-page. "Suggested page" surfaces the target; the on-call
  engineer initiates the page through PagerDuty / Opsgenie / their own
  workflow.
- Does not auto-DM Slack channels or PR-comment GitHub teams.
- Does not enforce ownership conventions. If your org tags
  inconsistently, this skill surfaces the inconsistency, but doesn't
  fix it.
- Does not store or cache ownership data. Every invocation re-reads the
  sources. (Cache is the ownership system's job, not this skill's.)
