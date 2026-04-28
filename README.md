# AWS APM — Claude Code & Cowork plugin

> SLO breach investigation, latency regression analysis, and error spike triage on top
> of AWS CloudWatch, Application Signals, and CloudTrail — with curated artifact
> components designed for on-call work.

This plugin extends the AWS Observability workflow content (originally built as a Kiro
power) to Anthropic's plugin surfaces: **Claude Code** (terminal / IDE / web) and
**Cowork** (desktop). It wires the four AWS-maintained MCP servers from
[`awslabs/mcp`](https://github.com/awslabs/mcp) and layers workflow skills, slash
commands, action-safety hooks, and Tier 3 artifact components on top.

## What you get

**Three workflow skills** that the model invokes automatically based on context:

| Skill | Triggers when… |
|---|---|
| `slo-breach-investigation` | An Application Signals SLO is breaching (fast or slow burn) |
| `latency-regression` | A service or operation got slower than baseline |
| `error-spike-triage` | Error rate jumps above baseline |

**Three user-invoked slash commands**:

| Command | What it does |
|---|---|
| `/cw-investigate-slo [service-or-slo]` | Full SLO breach workflow with breach explainer artifact |
| `/cw-investigate-latency <service> [window]` | Latency regression with trace waterfall artifact |
| `/cw-investigate-errors <service> [window]` | Error spike triage with health card + ranked causes |

**Five Tier 3 artifact components** — every investigation produces the same canonical
shape, with a metadata footer (source metric, time range, queries, MCP tools called,
confidence) so you can verify the model's reasoning before acting:

- 🚨 **SLO Breach Explainer** — burn rate, error budget, impacted operations, correlated deploys
- ⏱️ **Trace Waterfall Summary** — top slow spans, dependency contribution, span-to-code
- 🟢 **Service Health Card** — RED metrics, SLO context, recent changes, dependencies
- 🔍 **Top Suspected Cause** — ranked hypotheses with evidence + confidence + falsifiable next step
- 🔗 **Open in CloudWatch** — deep links into the AWS console with time range + filters preserved

**One action-safety hook** that intercepts AWS write actions (`Put*`, `Update*`,
`Delete*`, `Modify*`, `Start*`, `Stop*`, etc.) before they execute and requires explicit
user confirmation. Read operations pass through unmodified.

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
skills, commands, and hooks work in both surfaces. Tier 3 artifact components render
as HTML artifacts in Cowork (richer visuals — sparklines, waterfall SVGs) and as
Markdown in Claude Code.

### Configuring AWS profile and region

The plugin's `.mcp.json` defaults to `AWS_PROFILE=default` and `AWS_REGION=us-east-1`.
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

### Claude Code — investigating a fast burn

```
> /cw-investigate-slo checkout-availability
```

The plugin will:
1. Fetch SLO state, classify as fast/slow burn
2. Identify top contributing operations
3. Pull 3–5 representative failed traces
4. Query CloudTrail for deploys / config changes in the breach window ± 30m
5. Rank 2–4 hypotheses with explicit evidence
6. Render the **SLO Breach Explainer** artifact with deep links

### Cowork — natural-language entry point

```
> Our checkout service is slower than usual. p99 was 200ms yesterday, it's 800ms now.
```

The model auto-activates `latency-regression`, runs the workflow, and produces a
**Trace Waterfall Summary** + **Service Health Card** + **Top Suspected Cause** as an
HTML artifact in the side panel.

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
│   ├── plugin.json           # Plugin metadata
│   └── marketplace.json      # Marketplace manifest
├── .mcp.json                 # Wires the 4 awslabs/mcp servers via uvx
├── skills/                   # Workflow + Tier 3 artifact + setup skills
│   ├── slo-breach-investigation/
│   ├── latency-regression/
│   ├── error-spike-triage/
│   ├── slo-breach-explainer/
│   ├── trace-waterfall-summary/
│   ├── service-health-card/
│   ├── top-suspected-cause/
│   ├── open-in-cloudwatch/
│   └── aws-apm-setup/
├── artifacts/                # HTML artifact templates with {{PLACEHOLDERS}}
│   ├── slo-breach-explainer.html
│   ├── trace-waterfall.html
│   ├── service-health-card.html
│   ├── top-suspected-cause.html
│   └── investigation-summary.html
├── commands/                 # Slash commands
│   ├── cw-investigate-slo.md
│   ├── cw-investigate-latency.md
│   └── cw-investigate-errors.md
├── hooks/
│   ├── hooks.json            # PreToolUse confirmation gate on write actions
│   └── scripts/confirm-write.sh
└── tests/test_structure.py   # Stdlib-only structural tests
```

### Why these four MCP servers, not a custom one

AWS already maintains the four MCP servers this plugin wires (`cloudwatch-mcp-server`,
`cloudwatch-applicationsignals-mcp-server`, `cloudtrail-mcp-server`,
`aws-documentation-mcp-server`). They cover the full AWS APM surface: Application
Signals (service map, SLOs, operations, top contributors, synthetics canaries),
Application Map, Container Insights, Database Insights, and CloudTrail. Building a new
TypeScript MCP would duplicate that work and miss the point — the value of this plugin
is the workflow encoding (skills + commands + hooks + artifacts) on top, not a
re-implementation of AWS API access.

### Tier framing

| Tier | Ships | Status |
|---|---|---|
| Tier 1 | Raw MCP servers | Already exists at `awslabs/mcp` |
| Tier 2 | MCP + skills + slash commands + hooks | This plugin |
| Tier 3 | Tier 2 + curated artifact components with consistent visual grammar | This plugin |

## Out of scope

- **RUM** and **standalone Synthetics** — not part of the AWS APM surface this plugin
  targets. Synthetics canaries that participate in Application Signals service health
  *are* in scope.
- **Sub-agents** — deferred. Workflow skills cover the MVP; sub-agents may follow once
  the first three skills validate.
- **`claude.ai` consumer chat** — needs a remote MCP connector path, not this plugin.

## Contributing

```bash
git clone https://github.com/hmiglani30/aws-apm-claude-plugin
cd aws-apm-claude-plugin
python -m unittest tests.test_structure -v
```

The structural tests verify: manifest validity, version sync, all expected skills /
commands / MCP servers present, frontmatter completeness, hook script executability.

When adding a new skill:

1. Create `skills/<skill-name>/SKILL.md` with `name`, `description` (with strong trigger
   phrases), and `metadata.version`
2. Add the skill name to `EXPECTED_SKILLS` in `tests/test_structure.py`
3. Run the structural tests to verify

## Acknowledgments

- The four AWS MCP servers are maintained at [`awslabs/mcp`](https://github.com/awslabs/mcp)
- Workflow content adapted from the [AWS Observability Kiro power](https://github.com/kirodotdev/powers/tree/main/aws-observability)
- Plugin format follows the [Anthropic plugins reference](https://code.claude.com/docs/en/plugins-reference) and the
  patterns established by the [Honeycomb agent skill](https://github.com/honeycombio/agent-skill) and
  [Datadog plugin](https://github.com/DataDog/datadog-api-claude-plugin)

## License

MIT — see [LICENSE](LICENSE).
