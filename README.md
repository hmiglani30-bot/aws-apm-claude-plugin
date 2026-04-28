# AWS APM — Claude Code & Cowork plugin

[![tests](https://github.com/hmiglani30/aws-apm-claude-plugin/actions/workflows/tests.yml/badge.svg)](https://github.com/hmiglani30/aws-apm-claude-plugin/actions/workflows/tests.yml)
[![version](https://img.shields.io/badge/version-0.2.1-blue)](.claude-plugin/plugin.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-8A2BE2)](https://code.claude.com/docs/en/plugins-reference)
[![Cowork](https://img.shields.io/badge/Cowork-compatible-teal)](https://www.anthropic.com/news/cowork)

> A personal-prototype investigation method for **SREs and service-owning
> developers** debugging production APM issues backed by AWS Application Signals,
> X-Ray, CloudWatch, and CloudTrail. Encodes a fixed multi-phase workflow,
> hypothesis-with-evidence outputs, post-investigation self-validation, and
> persistent incident memory on top of the four AWS-maintained MCP servers.

> **Not an official AWS or Anthropic product.** See [Ownership](#ownership).

**Ships in:** Claude Code (terminal / IDE / web), Cowork (desktop).
&nbsp;·&nbsp; Docs: [ARCHITECTURE](ARCHITECTURE.md) ·
[MCP-TOOL-CONTRACTS](MCP-TOOL-CONTRACTS.md) ·
[ACTION-SAFETY-MODEL](ACTION-SAFETY-MODEL.md) ·
[SECURITY](SECURITY.md)

## Who this is for

The wedge: **SREs and service-owning developers investigating production APM
issues that come into view through AWS Application Signals.**

Organized around three jobs:

| Job | What you say | What you get |
|---|---|---|
| **"I got paged"** | "got paged for HighCheckoutErrorRate", "checkout 5xx alarm fired" | Alarm-response workflow → Service Health Card + ranked hypotheses + console deep links |
| **"My service is slow"** | "checkout p99 was 200ms yesterday, it's 800ms now", "payment API got slower" | Latency-regression workflow → Trace Waterfall + Top Suspected Cause |
| **"My SLO is burning"** | "checkout availability SLO is breaching", "fast burn on payment latency SLO" | SLO-breach workflow → SLO Breach Explainer with burn rate, error budget, top contributors |

These three jobs cover ~80% of the on-call moments where the answer lives in
AWS APM telemetry. The plugin is opinionated about *how* to investigate them
(see [Workflow phases](#workflow-phases)) so the result is the same shape
regardless of who runs it.

### Not the right tool for…

- **Pure cost / billing investigations.** Cost Explorer + the AWS Cost MCP
  server are a better fit.
- **Security incidents that aren't observability-shaped.** GuardDuty, Security
  Hub, IAM Access Analyzer.
- **APM platforms that aren't AWS Application Signals.** This plugin is
  specifically for the AS / X-Ray / CloudWatch surface.
- **RUM and standalone Synthetics.** Out of scope (see
  [Out of scope](#out-of-scope)).

## Why this plugin, not just MCP alone?

> **MCP gives Claude *tools*. This plugin gives Claude an *AWS APM investigation
> method*.**

The four `awslabs/mcp` servers expose AWS APM data — metrics, alarms, SLOs,
traces, log queries, CloudTrail events. That's necessary but not sufficient
for an investigation. With raw MCP, the model has to invent its own approach
each time: which APIs to call, in what order, against what window, how to
classify burn rate, which evidence to cite for a hypothesis. The result is
inconsistent and often wrong on the parts that matter (window alignment,
burn-rate math, Phase-6 dependency follow, ruled-out alternatives).

This plugin is the **investigation method** layered on top:

| Concern | Without plugin (raw MCP) | With this plugin |
|---|---|---|
| **Workflow** | Model invents one each time | Fixed Phase 1–6: classify → contributors → evidence (metric/log/trace) → correlate changes → rank hypotheses → follow dependencies |
| **Time window** | Inconsistent across calls | Single window computed once, propagated to every phase ([invariant](ARCHITECTURE.md#time-window-propagation-invariant)) |
| **Output shape** | Free-form prose | Tier 3 artifacts with metadata footer (source metric, queries, MCP calls, confidence) |
| **Correctness gate** | Trust the model | `investigation-validator` 6-check self-audit before output |
| **Recurrence detection** | Lost between sessions | `incident-memory` flags "we saw this on this service 3 days ago" |
| **Write safety** | Trust IAM alone | PreToolUse hook gates every write verb regardless of model intent |
| **Console hand-off** | Free-form URLs (often wrong) | `open-in-cloudwatch` skill builds deep links with service / operation / window / filters preserved |

If you have AWS APM telemetry and want a Claude that follows the same
investigation playbook every time and shows its work, that's what this
plugin is.

## Product tenets

These are load-bearing. The codebase, the IAM guidance, and the artifact
shapes are all consequences of these.

1. **CloudWatch is the system of record.** Every claim in every artifact is
   cited to a metric, log, trace, or CloudTrail event the user can verify in
   the AWS console. The plugin is a presentation layer over the SoR — it
   does not cache, summarize-then-discard, or interpret without a citation.
   See [ARCHITECTURE.md](ARCHITECTURE.md#architectural-principle).
2. **Read-only by default.** The plugin's investigations need zero write
   permissions. When remediation is required, the plugin deep-links to the
   AWS console rather than executing. See
   [ACTION-SAFETY-MODEL.md](ACTION-SAFETY-MODEL.md).
3. **Same shape every time.** A 6-check self-audit (`investigation-validator`)
   runs as the last step of every workflow. Metadata footer present. Every
   claim cited. Deep links work. "Considered and ruled out" included.
   Burn-rate / error-budget math correct. Confidence stated.
4. **Recurrence is a first-class signal.** `incident-memory` persists every
   investigation as JSON and surfaces "we saw this before" before the model
   spins up a new investigation from scratch.
5. **The plugin is the *method*, MCP is the *data*, AWS is the *truth*.**
   Each layer is independently replaceable.

## Day 0 vs Day N positioning

This plugin lives on the **Day N** side of the curve.

| Phase | Need | This plugin's role |
|---|---|---|
| **Day 0 — getting started with Application Signals** | Enable Application Signals in your account; instrument services; create SLOs; wire alarms | Out of scope. Use the AWS Application Signals onboarding guide. The plugin's `aws-apm-setup` skill does check prerequisites and surface specific errors, but it doesn't enable AS for you. |
| **Day N — running production with Application Signals** | Investigate breaches, regressions, error spikes, alarms; produce shareable artifacts; remember what happened last time | Core use case. Every shipping skill. |

If you don't have Application Signals enabled and SLOs configured, install it
first. The plugin assumes telemetry exists and gives you a way to investigate
it; it isn't a replacement for the AS onboarding flow.

## Value by role

The plugin's MVP is shaped for two adjacent personas:

### SRE / on-call

**Job-to-be-done:** turn an alert into an investigation artifact in <5
minutes that I can paste into the incident channel.

The shipping commands and skills are tuned for this. Every artifact ends in
ranked hypotheses with falsifiable next steps and "Open in CloudWatch" deep
links. Recurrence detection means you don't re-investigate the same payment-
API regression three Mondays in a row.

### Service-owning developer

**Job-to-be-done:** when my service is the suspected cause, point me at the
trace span, the log line, and (eventually) the code path.

Today: the plugin gets you to the **trace waterfall** and a **Top Suspected
Cause** with operation-level evidence. The "trace-to-code fix" half of the
story — pulling the matching code path, suggesting a change, and opening a
PR — is **roadmap**:

| Future command | Job |
|---|---|
| `/cw-trace-to-code <trace-id>` | Resolve the slowest span in a trace to a file:line in your repo |
| `/cw-suggest-fix <hypothesis>` | Given a Top Suspected Cause, draft a code change |
| `/cw-explain-this-span <span-id>` | Annotate a span with what its source-of-truth code does |

These are intentionally not in v0.2.x — they require source-tree integration
the SRE workflows don't. Today, expect this plugin to be **strong on the SRE
side and partial on the developer side**.

## Competitive positioning

This is a focused tool, not a category replacement.

| Adjacent thing | What it is | How this plugin differs |
|---|---|---|
| **AWS APM MCP servers alone** | Tools for Claude to call AWS APIs | This plugin adds the *investigation method* — workflow phases, hypothesis ranking, validator, memory, artifacts |
| **Datadog / Honeycomb / New Relic incident agents** | Vendor-built agents for their APM platforms | Different platform. Use the right plugin for your APM. This is the AWS Application Signals one |
| **General Claude Code with AWS access** | Claude + your AWS CLI credentials | Same data, no method, no safety hooks, no artifact shape, no memory. You can reproduce *parts* of this plugin in a long prompt; you can't reproduce the validator or the Tier 3 visual grammar |
| **AWS Bedrock Agents for Application Signals** | Hosted agent framework | Different surface (Bedrock vs. Claude Code/Cowork), different cost model, different deployment. This plugin runs locally with your existing Anthropic / Claude Code subscription |
| **PagerDuty AIOps / Incident.io copilots** | Workflow-attached AI on top of incident tooling | Adjacent — those start from an incident; this starts from a service or alert and produces evidence the incident channel can use |

The plugin's wedge is the combination: **AWS Application Signals + Claude
Code/Cowork plugin surface + opinionated investigation method**. If any of
those three doesn't fit your stack, look elsewhere.

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

Every investigation produces the same canonical shape, with a **metadata footer**
(source metric, time range, queries, MCP tools called, confidence) so you can
verify the model's reasoning before acting.

- 🚨 **SLO Breach Explainer** — burn rate, error budget, impacted operations, correlated deploys, ranked hypotheses
- ⏱️ **Trace Waterfall Summary** — top slow spans by self-time, dependency contribution, span-to-code, Mermaid gantt
- 🟢 **Service Health Card** — RED metrics (5m + 24h baseline), SLO status, top dependencies, recent CloudTrail changes
- 🔍 **Top Suspected Cause** — ranked hypotheses with evidence cards (metric / log / trace / deploy), confidence, falsifiable next step
- 📋 **Investigation Summary** — wrapper report for `slo-breach-investigation`, `latency-regression`, `error-spike-triage`: verdict callout, ranked hypotheses, evidence cards
- 🔗 **Open in CloudWatch** — deep links into the AWS console with service / operation / time range / filters preserved

Tier 3 components render as rich **HTML artifacts** in Cowork (sparklines,
waterfall SVGs, Cloudscape design tokens) and as Markdown in Claude Code.

### Quality + safety primitives

- **`investigation-validator`** — runs as the final step of every workflow skill
  before output is shown. A 6-check self-audit: metadata footer present, every
  claim cited to evidence, deep links work, considered-and-ruled-out section
  present, burn-rate / error-budget math correct, confidence levels stated.
  Catches the omissions that erode trust.
- **`incident-memory`** — persists a structured incident summary as JSON under
  `.aws-apm/incidents/` (keyed by date + service) after every investigation,
  and checks for prior incidents on the same service before starting a new
  one. Surfaces "we saw this before" recurrences so on-call doesn't
  re-investigate from scratch.
- **PreToolUse write-safety hook** — intercepts AWS write actions (`Put*`,
  `Update*`, `Delete*`, `Modify*`, `Start*`, `Stop*`, `Create*`, `Remove*`,
  `Disable*`, `Enable*`, `Attach*`, `Detach*`, `Tag*`, `Untag*`) before they
  execute and requires explicit user confirmation. Read operations pass
  through unmodified. See [ACTION-SAFETY-MODEL.md](ACTION-SAFETY-MODEL.md)
  for the full 5-tier model.

## Workflow phases

Every workflow skill follows the same six phases. This is the investigation
method the plugin encodes.

| Phase | What happens |
|---|---|
| **0. Recurrence check** | `incident-memory` checks `.aws-apm/incidents/` for prior incidents on the same service. If a near-duplicate exists, the workflow surfaces the previous root cause and resolution before re-investigating |
| **1. Classify** | Pull current SLO state / RED metrics / alarm state. Classify (fast burn vs. slow burn; regression magnitude; error rate vs. fault rate). Establishes the time window all later phases inherit |
| **2. Top contributors** | Rank operations / dependencies by contribution to the breach. Pick 3–5 representative failed traces |
| **3. Evidence** | For each candidate, pull metric + log + trace evidence. Every fact in the artifact gets cited to one of these |
| **4. Correlate changes** | Query CloudTrail for deploys / config changes / IAM changes / scaling events in the breach window ± 30m |
| **5. Rank hypotheses** | 2–4 hypotheses with explicit evidence + confidence + falsifiable next step. Include "considered and ruled out" |
| **6. Follow dependencies** | If a downstream service is suspected, recurse one level (depth 2 cap) into its own RED metrics rather than stopping at the boundary |
| **Validate + persist** | `investigation-validator` runs the 6-check self-audit; passing artifact is rendered; `incident-memory` writes the structured summary |

See [ARCHITECTURE.md](ARCHITECTURE.md#time-window-propagation-invariant) for
the time-window invariant that holds across every phase.

## Sample outputs

What the artifacts look like for three realistic scenarios. Numbers and
service names are illustrative.

### Scenario 1: checkout SLO fast burn after an ECS deploy

> **User:** `/cw-investigate-slo checkout-availability`

**SLO Breach Explainer (excerpt):**

> 🚨 **checkout-availability — FAST BURN**
> Burn rate: **14.2× budget** (1h window, threshold = 14.4×)
> Error budget remaining: **18% (was 73% 90 min ago)**
> Impacted operations: `POST /api/checkout` (94% of error volume), `POST /api/cart/checkout` (4%)
>
> **Recurrence check:** No prior breach for this SLO in the last 30 days.
>
> **Top Suspected Cause (confidence: high)**
> ECS service `checkout-prod` deployed task definition revision **127** at 07:31 UTC. Error rate began climbing at 07:33 UTC. Tasks running revision 127 show `HTTP 5xx → "TimeoutError calling payment-svc"` in 64% of failed traces.
>
> *Evidence:*
> - **Metric:** `AWS/ApplicationSignals Error 5xx` for `checkout` jumped from 0.4% → 11.2% at 07:33 (1m granularity)
> - **Trace:** 3 of 5 sampled failed traces (e.g. `1-682d-a4e3...`) show `payment-svc` span duration **>3000ms** before TimeoutError
> - **CloudTrail:** `RegisterTaskDefinition` for `checkout-prod` rev 127 at 07:31:08 UTC by `arn:aws:iam::...:role/CodeDeployRole`
>
> **Considered and ruled out:**
> - DynamoDB throttling on `checkout-orders` (no throttling events; latency stable)
> - ALB target health (no unhealthy targets)
>
> **Falsifiable next step:** roll back ECS service to revision **126**. If error rate returns to baseline within 5m, confirms the deploy as root cause.
>
> **Open in CloudWatch:** [SLO →](#) · [Service map →](#) · [Failed traces →](#) · [CloudTrail event →](#)

### Scenario 2: payment-API p99 regression caused by DynamoDB

> **User:** "payment API p99 was 180ms yesterday, it's 950ms now"

**Trace Waterfall Summary (excerpt):**

> ⏱️ **payment-api — p99 regression detected**
> Window: last 1h vs. 24h baseline
> p99: **950ms (baseline 180ms; +427%)**
> Affected operation: `POST /api/charge`
>
> **Top slow spans (by self-time, top 5 traces):**
> 1. `dynamodb.GetItem TransactionsTable` — **avg 720ms** (baseline 12ms) — **+5900%**
> 2. `payment-svc.charge` — 180ms (mostly waiting on DDB)
> 3. `auth-svc.verifyToken` — 35ms
>
> **Top Suspected Cause (confidence: high)**
> DynamoDB table `TransactionsTable` is being throttled. `ReadThrottleEvents` jumped from 0/min to **240/min** at 06:55 UTC.
>
> *Evidence:*
> - **Metric:** `AWS/DynamoDB ReadThrottleEvents{TableName=TransactionsTable}` 0 → 240/min at 06:55
> - **Metric:** `ConsumedReadCapacityUnits` exceeded provisioned 4000 RCU starting 06:53; auto-scale target not yet adjusted
> - **Trace:** all 5 sampled slow `GetItem` spans show `RetryAttempts >= 2` and `ResultType = ProvisionedThroughputExceededException`
>
> **Considered and ruled out:**
> - payment-svc CPU pressure (cluster CPU stable at 22%)
> - Auth-svc latency (auth span unchanged)
>
> **Falsifiable next step:** raise provisioned RCU on `TransactionsTable` to 8000, or enable on-demand. If p99 returns to <250ms within 10m, confirms root cause.
>
> **Open in CloudWatch:** [DynamoDB metrics →](#) · [Trace waterfall →](#) · [Auto-scaling activity →](#)

### Scenario 3: 5xx spike after secret rotation

> **User:** `/cw-alarm-response HighOrdersErrorRate`

**Service Health Card + Top Suspected Cause (excerpt):**

> 🟢 **orders-svc** — alarm `HighOrdersErrorRate` ALARM since 14:08 UTC
> 5m: error rate **8.4%** (24h baseline: 0.3%)
> p99: 410ms (baseline 380ms — not regressed)
> Throughput: 2,100 rpm (baseline 2,050 rpm — not regressed)
>
> **Recurrence check:** Similar 5xx spike on `orders-svc` on 2026-04-09 — root cause was secret rotation lag. Surfacing this prior investigation.
>
> **Top Suspected Cause (confidence: medium-high)**
> Secret `orders-svc/db/credentials` was rotated at 14:06 UTC. Failed traces show `AccessDeniedException` from RDS calls starting 14:06:40 UTC. Hypothesis: at least one task is still using the previous secret version.
>
> *Evidence:*
> - **CloudTrail:** `RotateSecret` on `orders-svc/db/credentials` at 14:06:02 UTC by `SecretsManagerRotationLambda`
> - **Log:** ECS task `orders-svc/...c7f2` logs `RDS auth failure: AccessDeniedException` continuously from 14:06:40 onwards
> - **Metric:** ECS service has 12 tasks; 3 tasks (25%) producing 100% of the 5xx — explains the 8.4% error rate exactly
> - **Memory:** Last incident on this service (2026-04-09) had identical signature; root cause was the rotation Lambda not signaling consumers to reload
>
> **Considered and ruled out:**
> - RDS instance health (no failover events; CPU/connections healthy)
> - Network — VPC flow logs show successful 3-way handshakes
>
> **Falsifiable next step:** force ECS service to redeploy (`UpdateService --force-new-deployment`). Surviving tasks pick up the new secret version. If error rate drops to baseline within ECS task replacement window, confirms.
>
> **Open in CloudWatch:** [Alarm →](#) · [Failed traces →](#) · [Secrets Manager rotation →](#)

These artifacts are the standard output. Every fact above is cited to a
specific MCP tool call recorded in the metadata footer, and the
`investigation-validator` confirms each citation resolves before the artifact
is shown.

## Cost awareness

The plugin runs in your AWS account and your Claude Code / Cowork subscription
— costs accrue to both.

### AWS-side cost

A typical investigation makes:

- **3–8 `GetMetricData` calls** (current state + 24h baseline + per-operation contributors)
- **1–3 Logs Insights queries** (`StartQuery` + polling `GetQueryResults`)
- **1 `GetTraceSummaries` + 1 `BatchGetTraces`** for 5 representative traces
- **1 `LookupEvents`** call for the change-correlation phase

Approximate cost ranges (us-east region, April 2026 list prices, **subject to
change — verify current pricing**):

| Item | Per-investigation cost (approx) |
|---|---|
| CloudWatch metric reads (`GetMetricData`) | $0.001–$0.003 ($0.01 / 1k metrics retrieved) |
| Logs Insights queries | $0.005 / GB scanned — typically $0.01–$0.10 / investigation depending on log volume in window |
| X-Ray trace retrieval | $0.0005 / 100k traces retrieved — typically free in this volume |
| CloudTrail Lookup | First 90 days of management events: free |
| Application Signals SLO / contributor APIs | No additional charge above AS instrumentation |

Per-investigation AWS cost is typically **<$0.10** unless the Logs Insights
query scans a very large window or volume.

### Anthropic-side cost

Each investigation is one Claude conversation: input tokens for the workflow
prompt + tool results, output tokens for the artifact. Use of MCP tool results
adds significantly to input token volume, especially in `latency-regression`
(traces are large). Expect:

- **Input tokens:** 30–80k per investigation (workflow prompt + tool results)
- **Output tokens:** 2–5k per investigation (artifact)

At Claude Sonnet 4.6 pricing: typically **$0.10–$0.40 / investigation**.
Opus models are higher. Pricing changes — check anthropic.com/pricing.

### Cost guardrails

- **Use `start_time` / `end_time` tightly.** The default time window is
  ±30m around the trigger. Don't widen unless needed; Logs Insights cost
  scales linearly with bytes scanned.
- **Cap trace fetches.** The plugin fetches 5 representative failed traces by
  default. Don't raise that without a reason.
- **Disable Phase 6 dependency follow** for cheap-path investigations (set
  the `--no-deps` flag on the slash command — roadmap).
- **Pin MCP server versions in `.mcp.json`** to prevent silent upgrades that
  add expensive new default queries.
- **Audit cost via CloudTrail + Cost Explorer.** Every API call the plugin
  makes appears in CloudTrail with the role identity from your `AWS_PROFILE`
  — easy to attribute.

The plugin does not currently surface running cost in the artifact's metadata
footer. Adding "estimated cost of this investigation" is roadmap.

## Installation

### Prerequisites

1. **`uv` / `uvx`** — the four MCP servers launch via `uvx`
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. **AWS credentials** configured (`aws configure`, AWS SSO, or env vars)
3. **Application Signals enabled** in your AWS account
   ([docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Intro.html))
4. **IAM permissions** — see [SECURITY.md → Minimal read-only IAM policy](SECURITY.md#minimal-read-only-iam-policy)
   for the recommended posture and additive optional policies for CloudTrail,
   Logs Insights, and Synthetics.

> **Recommended:** install in **read-only mode**. The plugin's investigations
> need zero write permissions. See
> [SECURITY.md → Read-only recommended install](SECURITY.md#read-only-recommended-install).

### Claude Code (terminal / IDE / web)

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

### Cowork (desktop)

In Cowork desktop, open the plugin marketplace, search for **AWS APM**, and
click Install. The plugin format is identical — the same `.claude-plugin/plugin.json`,
skills, commands, and hooks work in both surfaces.

### Claude.ai consumer chat (future)

Not supported today. The Claude.ai consumer surface needs a remote MCP
**connector** path; the four `awslabs/mcp` servers are local-only via `uvx`.
A hosted-MCP variant is on the roadmap — see
[ARCHITECTURE.md → Remote / hosted future](ARCHITECTURE.md#remote--hosted-future)
for the data-sovereignty changes that mode would require.

### Configuring AWS profile and region

The plugin's `.mcp.json` defaults to `AWS_PROFILE=default` and
`AWS_REGION=us-east-2`. Override per-user via Claude Code's MCP settings, or
edit `.mcp.json` directly:

```json
"env": {
  "AWS_PROFILE": "my-prod-profile",
  "AWS_REGION": "us-west-2",
  "FASTMCP_LOG_LEVEL": "ERROR"
}
```

If anything fails to connect, run the `aws-apm-setup` skill — it walks
through every prerequisite and surfaces the exact error.

## Usage examples

### "I got paged"

```
> got paged for HighCheckoutErrorRate alarm
```

The model auto-activates `alarm-response`: parses the alarm metadata, pulls
current metric values, correlates traces / logs for the affected service,
checks CloudTrail for changes in the alarm window, and produces a **Service
Health Card** + ranked remediation hypotheses. See
[Sample outputs § scenario 3](#scenario-3-5xx-spike-after-secret-rotation).

### "My service is slow"

```
> Our checkout service is slower than usual. p99 was 200ms yesterday, it's 800ms now.
```

The model auto-activates `latency-regression`, runs the workflow, and produces
a **Trace Waterfall Summary** + **Service Health Card** + **Top Suspected
Cause** as an HTML artifact in the side panel (Cowork) or markdown (Claude
Code). See [Sample outputs § scenario 2](#scenario-2-payment-api-p99-regression-caused-by-dynamodb).

### "My SLO is burning"

```
> /cw-investigate-slo checkout-availability
```

Full SLO breach workflow → **SLO Breach Explainer** artifact with burn rate,
error budget, top contributors, deploy/change correlation, ranked hypotheses.
See [Sample outputs § scenario 1](#scenario-1-checkout-slo-fast-burn-after-an-ecs-deploy).

### Weekly portfolio review

```
> /cw-slo-report
```

Produces a portfolio-wide SLO compliance dashboard: every SLO across every
Application Signals service, ranked by risk of breaching, with budget-remaining
and burn-rate columns and recommendations for at-risk SLOs.

### Read-only by default

Every workflow skill is read-only. If the model proposes a write action (e.g.
creating an alarm to monitor a recurrence), the action-safety hook intercepts
it and requires explicit confirmation in chat. For destructive or
billing-impacting actions (delete log group, change retention, modify IAM),
the model deep-links to the AWS console via the `open-in-cloudwatch` skill
rather than executing through MCP. Full classification in
[ACTION-SAFETY-MODEL.md](ACTION-SAFETY-MODEL.md).

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
├── tests/test_structure.py   # Stdlib-only structural tests
├── ARCHITECTURE.md           # Layering, context provider, time-window invariant, change providers, multi-account roadmap, data sovereignty, schema governance
├── MCP-TOOL-CONTRACTS.md     # Required MCP tool contracts (input/output/failures/pagination/permissions)
├── ACTION-SAFETY-MODEL.md    # 5-tier action model (read-only → suggested → console-deep-linked → MCP-with-approval → disallowed)
├── SECURITY.md               # IAM policy examples, threat model, prompt-injection defenses, memory policy, integrity, ownership
├── LICENSE                   # MIT
└── README.md                 # This file
```

### MCP servers (4)

| Server | Purpose |
|---|---|
| `awslabs.cloudwatch-mcp-server` | Metrics, alarms, Logs Insights |
| `awslabs.cloudwatch-applicationsignals-mcp-server` | Service map, SLOs, operations, top contributors, traces |
| `awslabs.cloudtrail-mcp-server` | API audit trail (deploys, config changes, IAM) |
| `awslabs.aws-documentation-mcp-server` | AWS doc lookup |

Tool-level contracts the plugin depends on are documented in
[MCP-TOOL-CONTRACTS.md](MCP-TOOL-CONTRACTS.md).

### Why these four MCP servers, not a custom one

AWS already maintains the four MCP servers this plugin wires. They cover the
full AWS APM surface: Application Signals (service map, SLOs, operations, top
contributors, synthetics canaries), Application Map, Container Insights,
Database Insights, and CloudTrail. Building a new TypeScript MCP would
duplicate that work and miss the point — the value of this plugin is the
workflow encoding (skills + commands + hooks + artifacts + validator + memory)
on top, not a re-implementation of AWS API access. See the architectural
principle in [ARCHITECTURE.md](ARCHITECTURE.md#architectural-principle).

### Tier framing

| Tier | Ships | Status |
|---|---|---|
| Tier 1 | Raw MCP servers | Already exists at `awslabs/mcp` |
| Tier 2 | MCP + skills + slash commands + hooks | This plugin |
| Tier 3 | Tier 2 + curated artifact components with consistent visual grammar | This plugin |

## What's new in v0.2.x

- **Phase 6 cascading dependency follow** in all three core workflow skills —
  when a dependency is the suspected root, the workflow recurses one level
  into the dependency's own RED metrics rather than stopping at the boundary.
- **Operational workflows** — `alarm-response` and `slo-compliance-report`
  extend the plugin beyond incident investigation to alarm triage and weekly
  portfolio review.
- **Quality bar primitives** — `investigation-validator` runs a 6-check
  self-audit on every artifact before it's shown; `incident-memory` persists
  summaries and surfaces recurrences.
- **Tier 3 HTML templates** — five HTML artifact templates with placeholder
  substitution, Cloudscape design tokens, and "Open in CloudWatch" deep-link
  buttons.
- **Expanded write-safety hook matcher** — covers `Create`, `Remove`,
  `Disable`, `Enable`, `Attach`, `Detach`, `Tag`, `Untag` in addition to the
  original `Put`/`Update`/`Delete`/`Modify`/`Start`/`Stop`.
- **Workflow polish** — every workflow skill now opens with reasoning state,
  tool-call labels, a progressive TODO checklist, and a verdict callout
  block in the final artifact.
- **Documentation** — top-level [ARCHITECTURE.md](ARCHITECTURE.md),
  [MCP-TOOL-CONTRACTS.md](MCP-TOOL-CONTRACTS.md),
  [ACTION-SAFETY-MODEL.md](ACTION-SAFETY-MODEL.md), and
  [SECURITY.md](SECURITY.md) so the plugin's invariants and threat model are
  inspectable independent of the prompts.

## Adoption metrics

Tracking adoption is forward-looking; the plugin is a personal prototype and
does not phone home. The metrics below describe **what the maintainer
considers signal** when evaluating whether the plugin is being used and whether
it's working — they're how to think about it, not values to report.

### Engagement signals (you can self-measure)

| Signal | What it tells you | How to measure |
|---|---|---|
| Investigations per week per on-call | Plugin reaching its core moment | Count files in `.aws-apm/incidents/` |
| Recurrence-flag triggers | Memory layer paying off | `incident-memory` log on workflow start |
| % artifacts where validator passed first try | Investigation quality | Validator emits "passed" / "retried" — count from session transcripts |
| % artifacts shared into incident channel | Output is good enough to send | Manual — check incident channel pastes |

### Quality signals

| Signal | What it tells you |
|---|---|
| Hypothesis-correctness rate | Of the top-ranked hypotheses, what fraction were the actual root cause? Track via incident postmortems. |
| Time-to-first-artifact | How long after the trigger does the user have something to share? |
| Console-deep-link click-through | Are the deep links taking users to the right page? (manual sample) |

### Anti-signals (use to falsify "this is working")

- Users running the workflow then immediately re-running with `/cw-health-check` — likely the SLO/alarm context wasn't enough.
- Many investigations on the same service in the same week with different root causes — possibly Phase 6 isn't catching the upstream cause.
- High validator retry rate — workflow is producing under-cited artifacts.

If you're piloting this with a team, the simplest weekly review: count the
`.aws-apm/incidents/` files, sample 3, and ask "did the top-ranked hypothesis
match the postmortem?" That's the bar.

## Out of scope

- **RUM** and **standalone Synthetics** — not part of the AWS APM surface this
  plugin targets. Synthetics canaries that participate in Application Signals
  service health *are* in scope.
- **Sub-agents** — deferred. Workflow skills cover the MVP.
- **Multi-account / Organizations** — current MVP is single-account.
  See [ARCHITECTURE.md → Multi-account architecture](ARCHITECTURE.md#multi-account-architecture-roadmap)
  for the roadmap.
- **Trace-to-code developer commands** — `/cw-trace-to-code`,
  `/cw-suggest-fix`, `/cw-explain-this-span` are roadmap. See
  [Value by role → Service-owning developer](#service-owning-developer).
- **`claude.ai` consumer chat** — needs a remote MCP connector path, not this
  plugin.

## Ownership

This is a **personal prototype** by [@hmiglani30](https://github.com/hmiglani30).
It is **not**:

- An official AWS or Amazon product.
- An AWS Labs project. (It uses `awslabs/mcp` servers, but does not modify or
  redistribute them.)
- An Anthropic project.

For bugs, vulnerabilities, and questions, file a GitHub issue (or security
advisory) on this repository — **not** to AWS Support, AWS Labs, or Anthropic.
See [SECURITY.md → Reporting a vulnerability](SECURITY.md#reporting-a-vulnerability).

## Contributing

```bash
git clone https://github.com/hmiglani30/aws-apm-claude-plugin
cd aws-apm-claude-plugin
python -m unittest tests.test_structure -v
```

The structural tests verify: manifest validity, version sync, all expected
skills / commands / MCP servers / artifacts present, frontmatter completeness,
hook script executability, Phase 6 presence in workflow skills, Tier 3 skills
referencing their HTML templates, and Cloudscape token / placeholder presence
in templates.

When adding a new skill:

1. Create `skills/<skill-name>/SKILL.md` with `name`, `description` (with
   strong trigger phrases), and `metadata.version`.
2. Add the skill name to `EXPECTED_SKILLS` in `tests/test_structure.py`.
3. If it's a workflow skill, add it to `WORKFLOW_SKILLS_WITH_PHASE_6`.
4. If it renders an HTML artifact, add it to `SKILLS_REFERENCING_ARTIFACTS`.
5. Run the structural tests to verify.

When adding a new MCP tool dependency, also update
[MCP-TOOL-CONTRACTS.md](MCP-TOOL-CONTRACTS.md) with the required contract
(input, output, failures, pagination, permissions).

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — orchestration / data-access split,
  context provider, time-window invariant, pluggable change providers,
  multi-account roadmap, data sovereignty, schema governance.
- [MCP-TOOL-CONTRACTS.md](MCP-TOOL-CONTRACTS.md) — what each MCP tool must
  return for skills to function.
- [ACTION-SAFETY-MODEL.md](ACTION-SAFETY-MODEL.md) — 5-tier classification
  of every action the plugin can take or recommend.
- [SECURITY.md](SECURITY.md) — IAM policy examples, threat model,
  prompt-injection defenses, integrity, ownership, vulnerability reporting.

## Acknowledgments

- The four AWS MCP servers are maintained at [`awslabs/mcp`](https://github.com/awslabs/mcp).
- Workflow content adapted from the [AWS Observability Kiro power](https://github.com/kirodotdev/powers/tree/main/aws-observability).
- Plugin format follows the [Anthropic plugins reference](https://code.claude.com/docs/en/plugins-reference)
  and the patterns established by the [Honeycomb agent skill](https://github.com/honeycombio/agent-skill)
  and [Datadog plugin](https://github.com/DataDog/datadog-api-claude-plugin).

## License

MIT — see [LICENSE](LICENSE).
