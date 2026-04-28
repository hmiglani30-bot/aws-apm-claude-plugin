# AWS APM — Claude Code & Cowork plugin

> SLO breach investigation, latency regression analysis, error spike triage, CloudWatch
> alarm response, fleet health checks, and portfolio-wide SLO reporting on top of AWS
> CloudWatch, Application Signals, and CloudTrail — with curated Tier 3 artifact
> components, post-investigation self-validation, and persistent incident memory.

This plugin extends the AWS Observability workflow content (originally built as a Kiro
power) to Anthropic's plugin surfaces: **Claude Code** (terminal / IDE / web) and
**Cowork** (desktop). It wires the four AWS-maintained MCP servers from
[`awslabs/mcp`](https://github.com/awslabs/mcp) and layers workflow skills, slash
commands, action-safety hooks, and Tier 3 artifact components on top.

**Current version:** `0.2.1`

## What you get

### Workflow skills (auto-triggered by context)

The model invokes these based on what the user describes — no command needed.

| Skill | Triggers when… |
|---|---|
| `slo-breach-investigation` | An Application Signals SLO is breaching (fast or slow burn) |
| `latency-regression` | A service or operation got slower than baseline |
| `error-spike-triage` | Error rate or fault rate jumps above baseline |
| `alarm-response` | A CloudWatch alarm fires (PagerDuty / OpsGenie / direct page) |
| `slo-compliance-report` | Non-incident reporting — "weekly SLO report", "audit SLOs", "which SLOs are at risk" |

### Slash commands (user-invoked)

| Command | What it does |
|---|---|
| `/cw-investigate-slo [service-or-slo]` | Full SLO breach workflow → SLO Breach Explainer artifact |
| `/cw-investigate-latency <service> [window]` | Latency regression → Trace Waterfall Summary + Top Suspected Cause |
| `/cw-investigate-errors <service> [window]` | Error spike triage → Service Health Card + Top Suspected Cause |
| `/cw-alarm-response <alarm-name-or-arn>` | Triage a fired CloudWatch alarm → Service Health Card + Top Suspected Cause |
| `/cw-health-check [service-name-pattern]` | Fleet-level dashboard across all Application Signals services in the region |
| `/cw-slo-report` | Portfolio-wide SLO compliance report ranked by risk, with recommendations |

### Tier 3 artifact components (consistent visual grammar)

Every investigation produces the same canonical shape, with a **metadata footer** (source
metric, time range, queries, MCP tools called, confidence) so you can verify the model's
reasoning before acting.

- 🚨 **SLO Breach Explainer** — burn rate, error budget, impacted operations, correlated deploys, ranked hypotheses
- ⏱️ **Trace Waterfall Summary** — top slow spans by self-time, dependency contribution, span-to-code, Mermaid gantt
- 🟢 **Service Health Card** — RED metrics (5m + 24h baseline), SLO status, top dependencies, recent CloudTrail changes
- 🔍 **Top Suspected Cause** — ranked hypotheses with evidence cards (metric / log / trace / deploy), confidence, falsifiable next step
- 🔗 **Open in CloudWatch** — deep links into the AWS console with service / operation / time range / filters preserved

Tier 3 components render as rich **HTML artifacts** in Cowork (sparklines, waterfall
SVGs, Cloudscape design tokens) and as Markdown in Claude Code.

### Quality + safety primitives

- **`investigation-validator`** — runs as the final step of every workflow skill before
  output is shown. A 6-check self-audit: metadata footer present, every claim cited to
  evidence, deep links work, considered-and-ruled-out section present, burn-rate / error-
  budget math correct, confidence levels stated. Catches the omissions that erode trust.
- **`incident-memory`** — persists a structured incident summary as JSON under
  `.aws-apm/incidents/` (keyed by date + service) after every investigation, and checks
  for prior incidents on the same service before starting a new one. Surfaces "we saw
  this before" recurrences so on-call doesn't re-investigate from scratch.
- **PreToolUse write-safety hook** — intercepts AWS write actions (`Put*`, `Update*`,
  `Delete*`, `Modify*`, `Start*`, `Stop*`, `Create*`, `Remove*`, `Disable*`, `Enable*`,
  `Attach*`, `Detach*`, `Tag*`, `Untag*`) before they execute and requires explicit user
  confirmation. Read operations pass through unmodified.

## Installation

### Prerequisites

1. **`uv` / `uvx`** — the four MCP servers launch via `uvx`
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. **AWS credentials** configured (`aws configure`, AWS SSO, or env vars)
3. **Application Signals enabled** in your AWS account ([docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Intro.html))
4. **IAM permissions** — minimum read-only set:
   ```
   cloudwatch:Get*, cloudwatch:List*, cloudwatch:Describe*
   logs:StartQuery, logs:GetQueryResults, logs:DescribeLogGroups
   xray:GetTrace*, xray:Get*
   application-signals:List*, application-signals:Get*
   cloudtrail:LookupEvents, cloudtrail:GetEventDataStore
   synthetics:GetCanary, synthetics:GetCanaryRuns
   ```
   The action-safety hook prevents accidental writes regardless of IAM, but giving the
   plugin write permissions is **not required** for any read-only investigation.

### Claude Code

```bash
# Add this marketplace, then install the plugin
/plugin marketplace add https://github.com/hmiglani30/aws-apm-claude-plugin
/plugin install aws-apm@aws-apm-plugins
```

Or, for local development:

```bash
git clone https://github.com/hmiglani30/aws-apm-claude-plugin
/plugin marketplace add /path/to/aws-apm-claude-plugin
/plugin install aws-apm@aws-apm-plugins
```

### Cowork

In Cowork desktop, open the plugin marketplace, search for **AWS APM**, and click
Install. The plugin format is identical — the same `.claude-plugin/plugin.json`,
skills, commands, and hooks work in both surfaces.

### Configuring AWS profile and region

The plugin's `.mcp.json` defaults to `AWS_PROFILE=default` and `AWS_REGION=us-east-2`.
Override per-user via Claude Code's MCP settings, or edit `.mcp.json` directly:

```json
"env": {
  "AWS_PROFILE": "my-prod-profile",
  "AWS_REGION": "us-west-2",
  "FASTMCP_LOG_LEVEL": "ERROR"
}
```

If anything fails to connect, run the `aws-apm-setup` skill — it walks through every
prerequisite and surfaces the exact error.

## Usage examples

### Investigating a fast burn (SLO breach)

```
> /cw-investigate-slo checkout-availability
```

The plugin will:
1. Check incident memory for prior breaches on this SLO
2. Fetch SLO state, classify as fast / slow burn
3. Identify top contributing operations
4. Pull 3–5 representative failed traces
5. Query CloudTrail for deploys / config changes in the breach window ± 30m
6. Follow cascading dependency contributions (Phase 6)
7. Rank 2–4 hypotheses with explicit evidence + confidence + falsifiable next step
8. Run the 6-check `investigation-validator` self-audit
9. Render the **SLO Breach Explainer** artifact with deep links
10. Persist a structured summary to `.aws-apm/incidents/`

### Responding to a fired alarm

```
> got paged for HighCheckoutErrorRate alarm
```

The model auto-activates `alarm-response`: parses the alarm metadata, pulls current
metric values, correlates traces / logs for the affected service, checks CloudTrail
for changes in the alarm window, and produces a **Service Health Card** + ranked
remediation hypotheses.

### Natural-language entry (Cowork)

```
> Our checkout service is slower than usual. p99 was 200ms yesterday, it's 800ms now.
```

The model auto-activates `latency-regression`, runs the workflow, and produces a
**Trace Waterfall Summary** + **Service Health Card** + **Top Suspected Cause** as an
HTML artifact in the side panel.

### Weekly portfolio review

```
> /cw-slo-report
```

Produces a portfolio-wide SLO compliance dashboard: every SLO across every Application
Signals service, ranked by risk of breaching, with budget-remaining and burn-rate
columns and recommendations for at-risk SLOs.

### Read-only by default

Every workflow skill is read-only. If the model proposes a write action (e.g. creating
an alarm to monitor a recurrence), the action-safety hook intercepts it and requires
explicit confirmation in chat. For destructive or billing-impacting actions (delete log
group, change retention, modify IAM), the model deep-links to the AWS console via the
`open-in-cloudwatch` skill rather than executing through MCP.

## Architecture

```
aws-apm-claude-plugin/
├── .claude-plugin/
│   ├── plugin.json           # Plugin metadata (v0.2.1)
│   └── marketplace.json      # Marketplace manifest
├── .mcp.json                 # Wires the 4 awslabs/mcp servers via uvx
├── skills/                   # 13 skills total
│   ├── slo-breach-investigation/    # Workflow
│   ├── latency-regression/          # Workflow
│   ├── error-spike-triage/          # Workflow
│   ├── alarm-response/              # Workflow
│   ├── slo-compliance-report/       # Reporting workflow
│   ├── slo-breach-explainer/        # Tier 3 artifact
│   ├── trace-waterfall-summary/     # Tier 3 artifact
│   ├── service-health-card/         # Tier 3 artifact
│   ├── top-suspected-cause/         # Tier 3 artifact
│   ├── open-in-cloudwatch/          # Deep-link primitive
│   ├── investigation-validator/     # 6-check self-audit
│   ├── incident-memory/             # JSON persistence + recurrence check
│   └── aws-apm-setup/               # Prerequisite walkthrough
├── artifacts/                # 5 HTML artifact templates with {{PLACEHOLDERS}}
│   ├── slo-breach-explainer.html
│   ├── trace-waterfall.html
│   ├── service-health-card.html
│   ├── top-suspected-cause.html
│   └── investigation-summary.html
├── commands/                 # 6 slash commands
│   ├── cw-investigate-slo.md
│   ├── cw-investigate-latency.md
│   ├── cw-investigate-errors.md
│   ├── cw-alarm-response.md
│   ├── cw-health-check.md
│   └── cw-slo-report.md
├── hooks/
│   ├── hooks.json            # PreToolUse confirmation gate on write actions
│   └── scripts/confirm-write.sh
└── tests/test_structure.py   # Stdlib-only structural tests (20 tests)
```

### MCP servers (4)

| Server | Purpose |
|---|---|
| `awslabs.cloudwatch-mcp-server` | Metrics, alarms, Logs Insights |
| `awslabs.cloudwatch-applicationsignals-mcp-server` | Service map, SLOs, operations, top contributors, traces |
| `awslabs.cloudtrail-mcp-server` | API audit trail (deploys, config changes, IAM) |
| `awslabs.aws-documentation-mcp-server` | AWS doc lookup |

### Why these four MCP servers, not a custom one

AWS already maintains the four MCP servers this plugin wires. They cover the full AWS
APM surface: Application Signals (service map, SLOs, operations, top contributors,
synthetics canaries), Application Map, Container Insights, Database Insights, and
CloudTrail. Building a new TypeScript MCP would duplicate that work and miss the point —
the value of this plugin is the workflow encoding (skills + commands + hooks + artifacts
+ validator + memory) on top, not a re-implementation of AWS API access.

### Tier framing

| Tier | Ships | Status |
|---|---|---|
| Tier 1 | Raw MCP servers | Already exists at `awslabs/mcp` |
| Tier 2 | MCP + skills + slash commands + hooks | This plugin |
| Tier 3 | Tier 2 + curated artifact components with consistent visual grammar | This plugin |

## What's new in v0.2.x

- **Phase 6 cascading dependency follow** in all three core workflow skills — when a
  dependency is the suspected root, the workflow recurses one level into the dependency's
  own RED metrics rather than stopping at the boundary.
- **Operational workflows** — `alarm-response` and `slo-compliance-report` extend the
  plugin beyond incident investigation to alarm triage and weekly portfolio review.
- **Quality bar primitives** — `investigation-validator` runs a 6-check self-audit on
  every artifact before it's shown; `incident-memory` persists summaries and surfaces
  recurrences.
- **Tier 3 HTML templates** — five HTML artifact templates with placeholder substitution,
  Cloudscape design tokens, and "Open in CloudWatch" deep-link buttons.
- **Expanded write-safety hook matcher** — covers `Create`, `Remove`, `Disable`,
  `Enable`, `Attach`, `Detach`, `Tag`, `Untag` in addition to the original
  `Put`/`Update`/`Delete`/`Modify`/`Start`/`Stop`.
- **Workflow polish** — every workflow skill now opens with reasoning state, tool-call
  labels, a progressive TODO checklist, and a verdict callout block in the final
  artifact.

## Out of scope

- **RUM** and **standalone Synthetics** — not part of the AWS APM surface this plugin
  targets. Synthetics canaries that participate in Application Signals service health
  *are* in scope.
- **Sub-agents** — deferred. Workflow skills cover the MVP.
- **`claude.ai` consumer chat** — needs a remote MCP connector path, not this plugin.

## Contributing

```bash
git clone https://github.com/hmiglani30/aws-apm-claude-plugin
cd aws-apm-claude-plugin
python -m unittest tests.test_structure -v
```

The structural tests verify: manifest validity, version sync, all expected skills /
commands / MCP servers / artifacts present, frontmatter completeness, hook script
executability, Phase 6 presence in workflow skills, Tier 3 skills referencing their
HTML templates, and Cloudscape token / placeholder presence in templates.

When adding a new skill:

1. Create `skills/<skill-name>/SKILL.md` with `name`, `description` (with strong trigger
   phrases), and `metadata.version`
2. Add the skill name to `EXPECTED_SKILLS` in `tests/test_structure.py`
3. If it's a workflow skill, add it to `WORKFLOW_SKILLS_WITH_PHASE_6`
4. If it renders an HTML artifact, add it to `SKILLS_REFERENCING_ARTIFACTS`
5. Run the structural tests to verify

## Acknowledgments

- The four AWS MCP servers are maintained at [`awslabs/mcp`](https://github.com/awslabs/mcp)
- Workflow content adapted from the [AWS Observability Kiro power](https://github.com/kirodotdev/powers/tree/main/aws-observability)
- Plugin format follows the [Anthropic plugins reference](https://code.claude.com/docs/en/plugins-reference) and the
  patterns established by the [Honeycomb agent skill](https://github.com/honeycombio/agent-skill) and
  [Datadog plugin](https://github.com/DataDog/datadog-api-claude-plugin)

## License

MIT — see [LICENSE](LICENSE).
