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
  version: "0.2.0"
---

# Service Ownership Resolution

Resolves the owner of an AWS service or resource by looking it up across the
sources teams typically register ownership in. The output is a
**"Likely owner"** line and a **"Suggested page"** target that get embedded
in the metadata footer of investigation artifacts (Service Health Card, SLO
Breach Explainer, Top Suspected Cause, Trace Waterfall Summary).

## Context provider

Read these fields from the context provider (ARCHITECTURE.md context shape):

- `context.service` -- the Application Signals service name to resolve ownership for
- `context.region` -- AWS region (pass to all MCP calls)
- `context.account` -- AWS account ID (include in output metadata)
- `context.environment` -- prod / staging / dev (affects which ownership tags to prioritize)
- `context.data_sources_available` -- check before calling each source

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

## MCP tool dependencies

- `awslabs.cloudwatch-applicationsignals-mcp-server` -- `list_services` (to resolve service name to resource ARN)
- `awslabs.cloudwatch-mcp-server` -- `list_tags_for_resource` (to read AWS resource tags)

## Sources, in priority order

The skill walks each source until it has high-confidence ownership, OR
until it has consulted all sources and assembles the best aggregate.
Higher-priority sources win conflicts but lower-priority sources are
still surfaced as cross-references.

### 1. AWS resource tags

#### MCP tool call sequence

1. Call `list_services` with `region=context.region` to find the service by name. Extract `key_attributes` for the resource ARN.
2. Call `list_tags_for_resource` with `resource_arn=<extracted ARN>` to retrieve all tags.
3. Scan for tags matching (case-insensitive): `Owner`, `Team`, `CostCenter`, `oncall`, `pagerduty-service`, `slack-channel`.

If no ownership tags found, record "AWS tags: no ownership tags" and continue to source 2.

#### Example MCP call sequence

```
Step 1: list_services(region="us-east-2") -> find service by name -> extract key_attributes for resource ARN
Step 2: list_tags_for_resource(resource_arn="arn:aws:ecs:us-east-1:123456:service/checkout-api") -> scan for ownership tags
Step 3: Filter tags matching Owner, Team, CostCenter, oncall, pagerduty-service, slack-channel
```

#### Example output

```
AWS tags on arn:aws:ecs:us-east-1:123456:service/checkout-api:
  Owner = checkout-platform
  oncall = checkout-team
  slack-channel = #checkout-oncall
Confidence contribution: +1 source (tags present and consistent)
```

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
the user has provided GitHub access -- do not assume). Surface the team
name + a count of members + the team's URL. Do not paste the full member
list into the artifact unless the user asks.

### 5. PagerDuty escalation policy

Look up the service in PagerDuty by name OR by `pagerduty-service` tag.
Surface:
- The service's escalation policy name
- The current on-call user (top of the policy)
- The escalation steps (1st level, 2nd level)

If the user does not have a PagerDuty integration configured, skip this
source silently but note "PagerDuty not configured" in the source list.

### 6. Slack channel configuration

Check for a Slack channel referenced in:
- The service's `slack-channel` AWS tag
- A `RUNBOOK.md` / `README.md` in the service's repo
- The PagerDuty service's notes / runbook URL

Surface the canonical channel handle (e.g. `#checkout-oncall`).

## Output structure

Render the resolution as a compact block embeddable into investigation
artifacts. There are two output modes:

### Mode A -- Inline (default)

For embedding into an existing artifact's metadata footer:

```markdown
**Likely owner:** `@example/checkout-team` (CODEOWNERS) . also tagged
`Owner=checkout-platform`
**Suggested page:** PagerDuty `checkout-availability` policy . current
on-call: `<user>` . Slack: `#checkout-oncall`
**Sources consulted:** AWS tags (check) . Service Catalog (warning) (no record) .
CODEOWNERS (check) . GitHub team (check) . PagerDuty (check) . Slack (check)
**Confidence:** High (3 sources agree)
```

### Mode B -- Standalone

When invoked directly as "who owns service X," produce a fuller artifact
with each source's findings as its own subsection. Include conflict
resolution if any source disagrees.

## Confidence rule

- **High** -- 2 or more independent sources agree (e.g. CODEOWNERS + AWS tag, or
  PagerDuty + Service Catalog).
- **Medium** -- exactly 1 source has a clear answer; other sources are
  silent.
- **Low** -- no source has a clear answer; the best guess is from naming
  convention or a single weakly-trusted tag (e.g. `costcenter` only).
- **Unknown** -- no source returned ownership info. Surface the gap and
  suggest the user add ownership tags or a CODEOWNERS entry. Do NOT
  guess from a service name; it's better to say "unknown" than to
  misdirect the page.

## Error handling

| Error | Detect | Behavior |
|---|---|---|
| `list_services` returns empty | No services in region | Surface "No Application Signals services in `<region>`. Confirm region or run `aws-apm-setup`." |
| `list_tags_for_resource` AccessDenied | IAM permission missing | Note "AWS tags: AccessDenied -- cannot read tags. Ask admin for `tag:GetResources` permission." Skip to source 2. |
| `list_tags_for_resource` returns empty | Resource exists but no tags | Record "AWS tags: no tags on resource." Continue to source 2. |
| Multiple services match name | Ambiguous input | List all matches with ARNs. Ask the user to pick one. Do NOT guess. |
| PagerDuty integration not configured | No PagerDuty MCP or API error | Skip silently. Note "PagerDuty not configured" in sources list. |
| GitHub access not available | No GitHub token or API error | Skip silently. Note "GitHub teams: no access" in sources list. |
| All sources return empty | No ownership data anywhere | Set confidence to Unknown. Render explicit recommendation to add ownership tags. |

## Few-shot examples

### Example 1: Service with rich ownership data

**Input:** "Who owns checkout-api?"

**Output:**
```markdown
**Likely owner:** `@example/checkout-team` (CODEOWNERS) . also tagged `Owner=checkout-platform`
**Suggested page:** PagerDuty `checkout-availability` policy . current on-call: `jane.doe@example.com` . Slack: `#checkout-oncall`
**Sources consulted:** AWS tags (check) . Service Catalog (warning)(no record) . CODEOWNERS (check) . GitHub team (check)(8 members) . PagerDuty (check) . Slack (check)
**Confidence:** High (3 sources agree on checkout-team)
```

### Example 2: Service with no ownership data

**Input:** "Who owns legacy-batch-processor?"

**Output:**
```markdown
**Likely owner:** Unknown
**Suggested page:** Unknown -- no escalation target found
**Sources consulted:** AWS tags (x)(no ownership tags) . Service Catalog (x)(no record) . CODEOWNERS (x)(no repo associated) . GitHub team (x)(skipped) . PagerDuty (x)(no matching service) . Slack (x)(no channel found)
**Confidence:** Unknown -- no source returned ownership data

**Recommendation:** Add an `Owner` tag to the resource at `arn:aws:ecs:us-east-1:123456:service/legacy-batch-processor` and create a CODEOWNERS entry in the service repo. Without ownership metadata, escalation during incidents is manual.
```

## Embedding into other skills

The investigation skills (`slo-breach-investigation`, `latency-regression`,
`error-spike-triage`, `alarm-response`, `service-health-card`) invoke
this skill once per investigation, after the affected service has
been identified, and embed the Mode A output in:

- The Service Health Card metadata footer
- The SLO Breach Explainer "Who to escalate" block
- The Top Suspected Cause "Suggested next action"

## Action safety

Read-only across all sources. The skill reads:
- AWS resource tags (read-only AWS APIs)
- Service Catalog provisioned products (read-only AWS APIs)
- The local repo's CODEOWNERS file
- GitHub teams (read-only GitHub API, only if user has provided access)
- PagerDuty escalation policies (read-only PagerDuty API, only if configured)
- Slack channel handles (read from runbook docs only)

It does NOT page anyone, post anywhere, or modify ownership records.

## Empty states

- **No services in region** -- "No Application Signals services in `<region>`. Confirm region or run `aws-apm-setup`."
- **No ownership data from any source** -- Set confidence to Unknown. List all sources checked with their empty result. Recommend adding `Owner` tag.
- **Conflicting ownership across sources** -- Surface the conflict explicitly. Use the higher-priority source as the "Likely owner" but show the disagreement.

## What this skill does NOT do

- Does not auto-page or DM anyone.
- Does not modify ownership records or tags.
- Does not enforce ownership conventions.
- Does not store or cache ownership data.
