# AWS Observability Claude Plugin

[![tests](https://github.com/hmiglani30/aws-apm-claude-plugin/actions/workflows/tests.yml/badge.svg)](https://github.com/hmiglani30/aws-apm-claude-plugin/actions/workflows/tests.yml)
[![version](https://img.shields.io/badge/version-0.3.0-blue)](.claude-plugin/plugin.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Cowork](https://img.shields.io/badge/Cowork-compatible-teal)](https://www.anthropic.com/news/cowork)

> A personal-prototype investigation method for **SREs and service-owning
> developers** debugging production APM issues backed by AWS Application Signals,
> X-Ray, CloudWatch, and CloudTrail. Encodes a fixed multi-phase workflow,
> hypothesis-with-evidence outputs, post-investigation self-validation, and
> persistent incident memory on top of the four AWS-maintained MCP servers.
> Investigations render as **interactive MCP-UI widgets** built on the
> **Cloudscape Design System**, with support for **write actions** (alarm
> creation, resource tagging) gated by a 5-tier safety model.

Docs: [ARCHITECTURE](ARCHITECTURE.md) ·
[MCP-TOOL-CONTRACTS](MCP-TOOL-CONTRACTS.md) ·
[ACTION-SAFETY-MODEL](ACTION-SAFETY-MODEL.md) ·
[SECURITY](SECURITY.md) ·
[WRITE-ACTION-WIDGETS](WRITE-ACTION-WIDGETS.md) ·
[QUICK-APP-PLAN](QUICK-APP-PLAN.md) ·
[eval-analysis.pdf](eval-analysis.pdf) ·
[template-design-analysis.pdf](template-design-analysis.pdf)

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

### Not the right tool for...

- **Pure billing investigations.** Cost Explorer + the AWS Cost MCP
  server are a better fit.
- **Security incidents that aren't observability-shaped.** GuardDuty, Security
  Hub, IAM Access Analyzer.
- **APM platforms that aren't AWS Application Signals.** This plugin is
  specifically for the AS / X-Ray / CloudWatch surface.
- **RUM and standalone Synthetics.** Out of scope (see
  [Out of scope](#out-of-scope)).

## Why this plugin, not just MCP alone?

> **MCP gives the model *tools*. This plugin gives the model an *AWS APM
> investigation method*.**

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
| **Workflow** | Model invents one each time | Fixed Phase 1-6: classify → contributors → evidence (metric/log/trace) → correlate changes → rank hypotheses → follow dependencies |
| **Time window** | Inconsistent across calls | Single window computed once, propagated to every phase ([invariant](ARCHITECTURE.md#time-window-propagation-invariant)) |
| **Output shape** | Free-form prose | MCP-UI widgets with Cloudscape components, consistent visual grammar, metadata footer |
| **Visual rendering** | Plain text or ad-hoc HTML | 9 widget types, 7 templates, deterministic renderer via MCP-UI protocol |
| **Write actions** | Trust IAM alone | `action_form` widget with 5-tier safety model and PreToolUse hook gating |
| **Correctness gate** | Trust the model | `investigation-validator` 6-check self-audit before output |
| **Recurrence detection** | Lost between sessions | `incident-memory` flags "we saw this on this service 3 days ago" |
| **Console hand-off** | Free-form URLs (often wrong) | `open-in-cloudwatch` skill builds deep links with service / operation / window / filters preserved |

If you have AWS APM telemetry and want an agent that follows the same
investigation playbook every time and shows its work, that's what this
plugin is.

## Visual Intelligence Layer

Investigations render as structured MCP-UI manifests composed of widgets and
templates. The deterministic renderer converts manifests into interactive HTML
using the **Cloudscape Design System** for visual consistency with the AWS
console.

### 9 Widget Types

| Widget | Cloudscape Component | Purpose |
|---|---|---|
| `stat_card` | `Container` + `StatusIndicator` + `Badge` | Single KPI tile with trend, sparkline, and status |
| `table` | `Table` with sorting/filtering | Sortable tabular data (alarms, services, operations, contributors) |
| `chart` | Time-series line/area | Metric time-series with baseline overlay |
| `timeline` | Vertical event list | Ordered events (deploys, config changes, alarm transitions) |
| `trace_waterfall` | Custom SVG | Distributed trace visualization with span-level detail |
| `log_viewer` | Severity-colored entries | Log lines with level coloring and pattern highlighting |
| `change_event_list` | Change cards | Deployment and config change events from CloudTrail |
| `sparkline` | Inline mini chart | Compact inline trend for embedding in stat cards or tables |
| `action_form` | `Form` + `Input` + `Button` | Interactive write-action forms (Tier 4 safety) |

### 7 Templates

Templates control slot layout — which widgets go where in the rendered view.

| Template | Use case | Typical command |
|---|---|---|
| `focus` | Single-widget deep dive | `/cw-investigate-latency` |
| `investigate` | Multi-evidence investigation | `/cw-investigate-slo` |
| `overview` | Fleet-level summary | `/cw-health-check` |
| `status` | Alarm/SLO status board | `/cw-slo-report` |
| `compare` | Side-by-side metric comparison | Regression analysis |
| `dashboard` | Multi-section grid | `/cw-trail-view` |
| `investigation_with_actions` | Investigation + write-action forms | Alarm response with remediation |

### Widget Catalog Skill

The `widget-catalog` skill is a master reference loaded whenever the LLM must
choose which widgets to place in a manifest, which template to select, or how
to map MCP tool output to visual components. It includes:

- Widget registry with data shapes, density costs, and usage rules
- Template selection matrix and command-to-template defaults
- Query pattern decision tree for 25+ example queries
- MCP tool-to-widget mapping (which tool output feeds which widget)

### Color System

- **16-color visualization palette** for chart series, categorical data
- **Status colors**: healthy (green), degraded (yellow), warning (orange), unhealthy (red), neutral (grey)
- **Semantic tokens** aligned with Cloudscape design tokens for light/dark mode

## Interactive Write Actions

The plugin supports interactive write actions through the `action_form` widget
type, enabling users to execute Tier 4 operations directly from investigation
artifacts.

### Supported Actions (v1)

| Action | MCP Tool | Use case |
|---|---|---|
| **Create Metric Alarm** | `PutMetricAlarm` | Create the alarm recommended by `alerting-design` |
| **Tag Resource** | `TagResource` | Tag resources for ownership, cost allocation, investigation notes |

### 5-Tier Safety Model

| Tier | Classification | Behavior |
|---|---|---|
| 1 | Read-only | Pass through — no gating |
| 2 | Suggested | Plugin recommends; user executes manually |
| 3 | Console-deep-linked | Plugin builds an AWS console URL; user clicks through |
| 4 | MCP-executable with approval | `action_form` renders; PreToolUse hook requires explicit `CONFIRM` in chat |
| 5 | Disallowed | Console-only fallback; never executed via MCP (deletes, IAM, billing) |

### How It Works

1. Investigation identifies a remediation (e.g., "create an alarm for this metric")
2. `action_form` widget renders in the `investigation_with_actions` template
3. User reviews pre-filled form fields (metric, threshold, period, etc.)
4. PreToolUse hook intercepts the write call and presents a structured approval block
5. User types `CONFIRM` in chat to execute, or uses the console deep link as fallback

Full spec in [WRITE-ACTION-WIDGETS.md](WRITE-ACTION-WIDGETS.md).

## Product tenets

These are load-bearing. The codebase, the IAM guidance, and the artifact
shapes are all consequences of these.

1. **CloudWatch is the system of record.** Every claim in every artifact is
   cited to a metric, log, trace, or CloudTrail event the user can verify in
   the AWS console. The plugin is a presentation layer over the SoR — it
   does not cache, summarize-then-discard, or interpret without a citation.
   See [ARCHITECTURE.md](ARCHITECTURE.md#architectural-principle).
2. **Read-only by default.** The plugin's investigations need zero write
   permissions. When remediation is required, Tier 4 `action_form` widgets
   offer MCP-executable writes with explicit approval; Tier 5 actions
   deep-link to the AWS console. See
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

These are intentionally not in v0.3.0 — they require source-tree integration
the SRE workflows don't. Today, expect this plugin to be **strong on the SRE
side and partial on the developer side**.

## Competitive positioning

This is a focused tool, not a category replacement.

| Adjacent thing | What it is | How this plugin differs |
|---|---|---|
| **AWS APM MCP servers alone** | Tools for an agent to call AWS APIs | This plugin adds the *investigation method* — workflow phases, hypothesis ranking, validator, memory, MCP-UI visual layer |
| **Datadog / Honeycomb / New Relic incident agents** | Vendor-built agents for their APM platforms | Different platform. Use the right plugin for your APM. This is the AWS Application Signals one |
| **General agent with AWS access** | An agent + your AWS CLI credentials | Same data, no method, no safety hooks, no artifact shape, no memory. You can reproduce *parts* of this plugin in a long prompt; you can't reproduce the validator or the Cloudscape visual grammar |
| **AWS Bedrock Agents for Application Signals** | Hosted agent framework | Different surface, different deployment. This plugin runs locally with your existing agent runtime |
| **PagerDuty AIOps / Incident.io copilots** | Workflow-attached AI on top of incident tooling | Adjacent — those start from an incident; this starts from a service or alert and produces evidence the incident channel can use |

The plugin's wedge is the combination: **AWS Application Signals + portable
plugin surface + opinionated investigation method + Cloudscape visual layer**.
If any of those doesn't fit your stack, look elsewhere.

## What you get

### Workflow skills (auto-triggered by context)

The model invokes these based on what the user describes — no command needed.

| Skill | Triggers when... |
|---|---|
| `slo-breach-investigation` | An Application Signals SLO is breaching (fast or slow burn) |
| `latency-regression` | A service or operation got slower than baseline |
| `error-spike-triage` | Error rate or fault rate jumps above baseline |
| `alarm-response` | A CloudWatch alarm fires (PagerDuty / OpsGenie / direct page) |
| `slo-compliance-report` | Non-incident reporting — "weekly SLO report", "audit SLOs", "which SLOs are at risk" |
| `observability-gap-analysis` | "audit my code for logging", "missing instrumentation", "is my service observable" — scans a codebase for logging / metrics / tracing / error-handling / health-check gaps |
| `alerting-design` | "what alarms should I have", "audit alarms", "alarm fatigue" — inventories existing alarms and recommends a per-service alerting plan |

### Slash commands (12)

| Command | What it does |
|---|---|
| `/cw-investigate-slo [service-or-slo]` | Full SLO breach workflow → SLO Breach Explainer artifact |
| `/cw-investigate-latency <service> [window]` | Latency regression → Trace Waterfall Summary + Top Suspected Cause |
| `/cw-investigate-errors <service> [window]` | Error spike triage → Service Health Card + Top Suspected Cause |
| `/cw-alarm-response <alarm-name-or-arn>` | Triage a fired CloudWatch alarm → Service Health Card + Top Suspected Cause |
| `/cw-health-check [service-name-pattern]` | Fleet-level dashboard across all Application Signals services in the region |
| `/cw-slo-report` | Portfolio-wide SLO compliance report ranked by risk, with recommendations |
| `/cw-obs-gaps [path] [language]` | Codebase observability gap analysis → Observability Gap Report (logging / metrics / tracing / error-handling / health-check coverage; multi-language) |
| `/cw-alert-design [service-or-namespace] [window]` | Alerting design → Alerting Plan (existing-alarm audit, coverage matrix, recommended thresholds, composite-alarm patterns, IaC snippets) |
| `/cw-trail-view [time-range] [service-filter] [event-type]` | View recent CloudTrail events as a hybrid-renderer manifest — layout (timeline / audit table / dashboard) is selected from the prompt intent |
| `/cw-dashboard <dashboard-name> [time-range]` | Read an existing CloudWatch dashboard, fetch live metric / alarm / log values for each widget, and render an interpreted summary |
| `/cw-set-context` | Pick the AWS profile and region the plugin operates against |
| `/cw-doctor` | End-to-end diagnostic: MCP servers, AWS identity, region, Application Signals, logs, traces, CloudTrail |
| `/cw-verify-recovery <service>` | Verify a service has recovered after a mitigation (SLO burn stopped, p99 returned, errors normalized, alarms back to OK) |

### Skills (20 total)

| Category | Skills |
|---|---|
| **Workflow** | `slo-breach-investigation`, `latency-regression`, `error-spike-triage`, `alarm-response`, `slo-compliance-report`, `observability-gap-analysis`, `alerting-design` |
| **Artifact rendering** | `slo-breach-explainer`, `trace-waterfall-summary`, `service-health-card`, `top-suspected-cause`, `hybrid-renderer` |
| **Visual intelligence** | `widget-catalog` |
| **Quality + safety** | `investigation-validator`, `incident-memory` |
| **Utilities** | `open-in-cloudwatch`, `service-ownership`, `trace-to-code`, `copy-to-incident`, `aws-apm-setup` |

### Tier 3 artifact components (consistent visual grammar)

Every investigation produces the same canonical shape, with a **metadata footer**
(source metric, time range, queries, MCP tools called, confidence) so you can
verify the model's reasoning before acting.

- **SLO Breach Explainer** — burn rate, error budget, impacted operations, correlated deploys, ranked hypotheses
- **Trace Waterfall Summary** — top slow spans by self-time, dependency contribution, span-to-code, Mermaid gantt
- **Service Health Card** — RED metrics (5m + 24h baseline), SLO status, top dependencies, recent CloudTrail changes
- **Top Suspected Cause** — ranked hypotheses with evidence cards (metric / log / trace / deploy), confidence, falsifiable next step
- **Investigation Summary** — wrapper report for `slo-breach-investigation`, `latency-regression`, `error-spike-triage`: verdict callout, ranked hypotheses, evidence cards
- **Observability Gap Report** — per-file findings on logging / metrics / tracing / error-handling / health-check coverage, ranked by severity, with language-specific fix snippets
- **Alerting Plan** — existing-alarm inventory, noise audit, per-service coverage matrix, recommended alarms with thresholds and IaC snippets, composite-alarm and anomaly-detection candidates
- **Open in CloudWatch** — deep links into the AWS console with service / operation / time range / filters preserved

Tier 3 components render as rich **HTML artifacts** in Cowork (sparklines,
waterfall SVGs, Cloudscape design tokens) and as Markdown elsewhere. Beyond
the seven fixed HTML templates above, the **`hybrid-renderer`** path lets a
skill emit a JSON manifest that the deterministic renderer (`renderer/`)
turns into a custom artifact — see [Hybrid renderer](#hybrid-renderer).

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

## Demo Environment

A zero-cost demo stack exercises every capability of the plugin without
requiring an existing production AWS environment.

### What it deploys

- **Lambda function** (`pet-clinic-api`) with Python 3.12 and ADOT instrumentation layer
- **API Gateway** (HTTP API) as the public endpoint
- **CloudWatch Alarms** (3) for error rate, latency, and throttling
- **CloudWatch Dashboard** with invocation, error, and duration graphs
- **SNS Topic** for alarm notifications (optional email subscription)
- **X-Ray tracing** via ADOT for distributed trace collection
- **Application Signals** integration for service map and SLO support

### Quick start

```bash
# Deploy the stack
aws cloudformation deploy \
  --template-file demo/demo-stack.yaml \
  --stack-name apm-demo \
  --capabilities CAPABILITY_IAM

# Generate load (~10% error rate by design)
./demo/generate-load.sh $(aws cloudformation describe-stacks \
  --stack-name apm-demo \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

# Tear down when done
aws cloudformation delete-stack --stack-name apm-demo
```

See [demo/README.md](demo/README.md) for full instructions, cost breakdown,
and plugin commands to try.

## Quick App Compatibility

The same MCP servers and intelligence layer that power the Claude Code plugin
can serve **Amazon Q Quick Apps** with minimal adaptation.

| Concern | Claude Code Plugin | Amazon Q Quick App |
|---|---|---|
| **Transport** | Local stdio via `uvx` | Remote HTTP/SSE via action connectors |
| **Intelligence layer** | Skills, commands, templates, safety model | Same prompts, same widget catalog |
| **Rendering** | MCP-UI in Cowork side panel | Quick App native rendering |
| **Filesystem access** | Full (for `obs-gaps`, `trace-to-code`) | None — 3 skills are plugin-only |

**~80% reuse**: 14 of 20 skills work identically in both hosts. 3 skills
(`aws-apm-setup`, `observability-gap-analysis`, `trace-to-code`) require local
filesystem access and are plugin-only. 2 skills (`incident-memory`,
`service-ownership`) work with degraded capability in Quick Apps (need
persistence adapter and additional MCP integrations respectively).

See [QUICK-APP-PLAN.md](QUICK-APP-PLAN.md) for the full parity matrix and
migration plan.

## Workflow phases

Every workflow skill follows the same six phases. This is the investigation
method the plugin encodes.

| Phase | What happens |
|---|---|
| **0. Recurrence check** | `incident-memory` checks `.aws-apm/incidents/` for prior incidents on the same service. If a near-duplicate exists, the workflow surfaces the previous root cause and resolution before re-investigating |
| **1. Classify** | Pull current SLO state / RED metrics / alarm state. Classify (fast burn vs. slow burn; regression magnitude; error rate vs. fault rate). Establishes the time window all later phases inherit |
| **2. Top contributors** | Rank operations / dependencies by contribution to the breach. Pick 3-5 representative failed traces |
| **3. Evidence** | For each candidate, pull metric + log + trace evidence. Every fact in the artifact gets cited to one of these |
| **4. Correlate changes** | Query CloudTrail for deploys / config changes / IAM changes / scaling events in the breach window +/- 30m |
| **5. Rank hypotheses** | 2-4 hypotheses with explicit evidence + confidence + falsifiable next step. Include "considered and ruled out" |
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

> **checkout-availability — FAST BURN**
> Burn rate: **14.2x budget** (1h window, threshold = 14.4x)
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

> **payment-api — p99 regression detected**
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

> **orders-svc** — alarm `HighOrdersErrorRate` ALARM since 14:08 UTC
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

### Distribution model

There is **no centralized, Anthropic-hosted public plugin marketplace**.
Plugins are distributed from individual GitHub repos (or zip archives), and
each host — Claude Code or Cowork — installs them directly from that source.
The `.claude-plugin/marketplace.json` shipped at the root of this repo lets
Claude Code's `/plugin marketplace add <github-url>` flow discover and install
the plugin; it is **not** a listing in any global directory.

### Claude Code (CLI)

```bash
# Add this repo as a marketplace, then install the plugin
/plugin marketplace add https://github.com/hmiglani30/aws-apm-claude-plugin
/plugin install aws-apm@aws-apm-plugins
```

Or, for local development:

```bash
git clone https://github.com/hmiglani30/aws-apm-claude-plugin
/plugin marketplace add /path/to/aws-apm-claude-plugin
/plugin install aws-apm@aws-apm-plugins
```

> Both forms are slash commands inside the Claude Code REPL. There is no
> `claude plugin add ...` CLI subcommand outside the REPL.

### Cowork (desktop)

Cowork uses the same plugin format as Claude Code (`.claude-plugin/plugin.json`,
`skills/`, `commands/`, `hooks/`, and a root `.mcp.json`), but does **not** have
an in-app marketplace browser and does not install directly from a GitHub URL.

**Recommended — download and upload the prebuilt `.plugin` file.**

1. Download the latest `aws-apm-claude-plugin.plugin` from
   [GitHub Releases](https://github.com/hmiglani30/aws-apm-claude-plugin/releases).
2. Open Cowork → **Settings** → **Plugins** → **Upload**.
3. Pick the downloaded `.plugin` file. Cowork unpacks it and prompts to
   restart so the four `awslabs.*` MCP servers can launch.

The `.plugin` file is a zip archive (renamed). If your Cowork build only
accepts `.zip`, rename the extension before uploading.

<details>
<summary>Build the <code>.plugin</code> file from source</summary>

```bash
# From the repo root
zip -r aws-apm-claude-plugin.plugin . \
  -x "*.DS_Store" -x ".git/*" -x "tests/*" -x "node_modules/*"
```

The resulting archive root contains `.claude-plugin/plugin.json`,
`.mcp.json`, `skills/`, `commands/`, `hooks/`, `artifacts/`, `renderer/`,
`schemas/`, and `data/`.
</details>

<details>
<summary>Alternative — drop the plugin folder into the IT-managed <code>org-plugins</code> directory</summary>

For organizations that ship plugins to a managed fleet, Cowork
auto-discovers any plugin folder placed in:

| OS      | Path                                              |
|---------|---------------------------------------------------|
| macOS   | `/Library/Application Support/Claude/org-plugins/` |
| Windows | `C:\ProgramData\Claude\org-plugins\`              |

```bash
# macOS example — needs sudo to write under /Library
git clone https://github.com/hmiglani30/aws-apm-claude-plugin
sudo cp -R aws-apm-claude-plugin "/Library/Application Support/Claude/org-plugins/aws-apm"
# Then restart Cowork.
```

This path requires admin privileges and is intended for IT-managed
deployments, not single-user installs.
</details>

**Cowork-specific prerequisites:**

- Cowork executes MCP server commands inside its sandboxed Linux VM.
  `uvx` is **not** preinstalled there. Either install it once in your Cowork
  environment (`curl -LsSf https://astral.sh/uv/install.sh | sh`) so the four
  `awslabs.*` MCP servers can launch, or rewrite `.mcp.json` to use a
  Cowork-supported command.
- AWS credentials must be reachable from inside the Cowork sandbox. The
  `AWS_PROFILE`/`AWS_REGION` env values in `.mcp.json` are honored, but the
  underlying credential chain (env vars, `~/.aws/credentials`, SSO) must be
  available where Cowork runs the MCP server.
- Hooks rely on the standard `${CLAUDE_PLUGIN_ROOT}` env var that hosts set
  when invoking `hooks/hooks.json` commands. If a future Cowork release does
  not set it, the action-safety gate will fail closed (the safer default) and
  the `aws-apm-setup` skill will surface the gap.

### Configuring AWS profile and region

The plugin's `.mcp.json` defaults to `AWS_PROFILE=default` and
`AWS_REGION=us-east-1`. Override per-user via the host's MCP settings, or
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
Cause** rendered as MCP-UI widgets in the side panel (Cowork) or markdown
elsewhere. See [Sample outputs § scenario 2](#scenario-2-payment-api-p99-regression-caused-by-dynamodb).

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
│   ├── plugin.json           # Plugin metadata (v0.3.0)
│   └── marketplace.json      # Marketplace manifest
├── .claude/worktrees/*/ui-server/
│   ├── components/widgets/   # Cloudscape widget components (StatCard, Table)
│   └── templates/            # 7 layout templates + 3 shell layouts (10 JSON files)
├── .mcp.json                 # Wires the 4 awslabs/mcp servers via uvx
├── skills/                   # 20 skills total
│   ├── slo-breach-investigation/    # Workflow
│   ├── latency-regression/          # Workflow
│   ├── error-spike-triage/          # Workflow
│   ├── alarm-response/              # Workflow
│   ├── slo-compliance-report/       # Reporting workflow
│   ├── observability-gap-analysis/  # Codebase audit workflow
│   ├── alerting-design/             # Alerting plan workflow
│   ├── slo-breach-explainer/        # Tier 3 artifact
│   ├── trace-waterfall-summary/     # Tier 3 artifact
│   ├── service-health-card/         # Tier 3 artifact
│   ├── top-suspected-cause/         # Tier 3 artifact
│   ├── open-in-cloudwatch/          # Deep-link primitive
│   ├── investigation-validator/     # 6-check self-audit
│   ├── incident-memory/             # JSON persistence + recurrence check
│   ├── service-ownership/           # Resolve owning team / on-call
│   ├── trace-to-code/               # Map trace span to source code
│   ├── copy-to-incident/            # Reformat artifact for Slack / postmortem / status page
│   ├── hybrid-renderer/             # JSON manifest grammar for the deterministic HTML renderer
│   ├── widget-catalog/              # LLM steering for widget / template / shell selection
│   └── aws-apm-setup/               # Prerequisite walkthrough
├── artifacts/                # 7 HTML artifact templates with {{PLACEHOLDERS}}
│   ├── slo-breach-explainer.html
│   ├── trace-waterfall.html
│   ├── service-health-card.html
│   ├── top-suspected-cause.html
│   ├── investigation-summary.html
│   ├── observability-gap-report.html
│   └── alerting-plan.html
├── commands/                 # 12 slash commands
│   ├── cw-investigate-slo.md
│   ├── cw-investigate-latency.md
│   ├── cw-investigate-errors.md
│   ├── cw-alarm-response.md
│   ├── cw-health-check.md
│   ├── cw-slo-report.md
│   ├── cw-obs-gaps.md
│   ├── cw-alert-design.md
│   ├── cw-trail-view.md
│   ├── cw-dashboard.md
│   ├── cw-set-context.md
│   ├── cw-doctor.md
│   └── cw-verify-recovery.md
├── renderer/                 # Deterministic JSON-manifest → HTML renderer
│   ├── render.js             # Pure function: manifest in → HTML out
│   ├── engine.js             # Shell selection, slotting, density budget, overflow
│   ├── cache.js              # Render-result memoization
│   ├── interactions.js       # Lightweight client-side widget interactions
│   ├── styles.css            # Cloudscape-token-based widget styles
│   ├── test-harness.html     # Browser-visible eval harness
│   ├── widgets/              # 7 widget types (stat_card, sparkline, timeline,
│   │                         #   table, trace_waterfall, log_viewer,
│   │                         #   change_event_list)
│   └── shells/               # 3 shells (single-focus, investigation, dashboard)
├── schemas/
│   └── manifest.schema.json  # JSON-Schema contract for hybrid-renderer manifests
├── evals/                    # 52-prompt evaluation suite for the renderer
│   ├── cases.mjs             # Prompts + reference manifests + per-case expectations
│   ├── run-evals.mjs         # Harness; emits JSON results
│   ├── build-scorecard.mjs   # JSON → human-readable HTML scorecard
│   ├── hybrid-renderer-eval-results.json
│   ├── hybrid-renderer-eval-results.html
│   └── README.md             # 6 scoring dimensions, run instructions
├── data/                     # Hybrid-renderer E2E inputs and rendered outputs
│   ├── alarms.json, dashboard.json, health.json, logs.json, trail.json
│   ├── build-manifests.mjs   # Builds manifests/ from the JSON inputs
│   ├── manifests/            # Generated manifests for E2E render
│   ├── rendered/             # Generated HTML output for visual diffing
│   └── e2e-report.md         # E2E run summary
├── hooks/
│   ├── hooks.json            # PreToolUse confirmation gate on write actions
│   └── scripts/confirm-write.sh
├── tests/                    # 5 stdlib-only test modules
│   ├── test_structure.py
│   ├── test_behavioral.py
│   ├── test_golden_outputs.py
│   ├── test_artifact_rendering.py
│   └── test_error_taxonomy.py
├── docs/
│   ├── debugging.md
│   └── hybrid-renderer-eval-scorecard.pdf
├── .github/workflows/test.yml  # CI: 5 unittest modules + JSON / placeholder / shellcheck / markdown / link checks
├── package.json              # ajv + ajv-formats devDeps for the renderer evals
├── ARCHITECTURE.md           # Layering, context provider, time-window invariant, change providers, multi-account roadmap, data sovereignty, schema governance
├── MCP-TOOL-CONTRACTS.md     # Required MCP tool contracts (input/output/failures/pagination/permissions)
├── ACTION-SAFETY-MODEL.md    # 5-tier action model (read-only → suggested → console-deep-linked → MCP-with-approval → disallowed)
├── SECURITY.md               # IAM policy examples, threat model, prompt-injection defenses, memory policy, integrity
├── WRITE-ACTION-WIDGETS.md   # action_form widget spec, supported write actions, safety model
├── QUICK-APP-PLAN.md         # Amazon Q Quick App parity plan and migration guide
├── eval-analysis.pdf         # Evaluation analysis
├── template-design-analysis.pdf # Template design analysis
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

The plugin uses a three-tier framing:

| Tier   | What ships                                                             | Output to the user            | Status |
| ------ | ---------------------------------------------------------------------- | ----------------------------- | ------ |
| Tier 1 | Raw MCP tool calls — the model talks to the API directly               | Plain text                    | Already exists at [`awslabs/mcp`](https://github.com/awslabs/mcp) |
| Tier 2 | MCP + skills + slash commands + safety hooks                           | Structured Markdown           | This plugin |
| Tier 3 | Tier 2 + **MCP-UI widgets** with Cloudscape components + write actions | Rich interactive HTML / SVG   | This plugin |

**Tier 3, concretely:** every investigation produces a JSON manifest specifying
widgets, template, and data bindings. The deterministic renderer (`render.js`)
converts this manifest into interactive HTML using Cloudscape components — stat
cards, sortable tables, time-series charts, trace waterfalls, and action forms.
The `widget-catalog` skill guides the LLM in selecting the right widgets and
template for each query. In Markdown-only surfaces, the same manifest renders as
structured Markdown with "Open in CloudWatch" deep links.

## End-to-end test infrastructure

## Hybrid renderer

For investigations that don't fit one of the seven fixed Tier 3 templates
(e.g. ad-hoc CloudTrail audits via `/cw-trail-view`, mixed dashboards, custom
combinations), the plugin ships a **deterministic JSON-manifest renderer**
under [`renderer/`](./renderer).

```
LLM (skill-following)              renderer/render.js (deterministic)
  picks WHICH widgets   ─────────► picks WHERE they go
  fills the data                   shell, slots, density budget, overflow
```

The split keeps the LLM out of the rendering loop:

- The LLM emits a JSON manifest validated against
  [`schemas/manifest.schema.json`](./schemas/manifest.schema.json) — a
  small, stable contract.
- `render.js` is a pure function: manifest in → HTML out. No LLM call,
  no string-templating in the model, no markup drift between runs.
- The [`widget-catalog`](./skills/widget-catalog) skill steers the LLM's
  widget / shell choices so the manifest stays inside the visual grammar.

**Widgets (7):** `stat_card`, `sparkline`, `timeline`, `table`,
`trace_waterfall`, `log_viewer`, `change_event_list`.

**Shells (3):** `single-focus`, `investigation`, `dashboard` — the renderer
selects one based on the manifest's `query_intent` and widget mix.

The renderer is the path used by `/cw-trail-view` and any future
investigation that wants a custom layout without authoring a new HTML
template.

### Renderer evals

The renderer is covered by a **52-prompt evaluation suite** at
[`evals/`](./evals). Each case is hand-authored to mimic what a
skill-following LLM would emit for that prompt and is scored on six
dimensions:

| Dimension | What it checks |
|---|---|
| **Manifest validity** | Passes JSON-Schema validation against `schemas/manifest.schema.json` |
| **Shell selection** | Engine inferred a shell appropriate to the prompt |
| **Widget relevance** | Required widgets present, forbidden widgets absent |
| **Widget count** | Within a per-prompt expected range |
| **Density budget** | `densityUsed <= budget` and overflow drawer ≤ 50% of widgets |
| **Rendering** | `renderManifest` produced clean HTML (correct root, no widget-error tags, balanced markup) |

Latest results — **52/52 cases passing on all 6 dimensions** (10 error
investigation, 10 latency / performance, 10 SLO / service health, 10
CloudTrail / security, 12 mixed / complex). Raw results in
[`evals/hybrid-renderer-eval-results.json`](./evals/hybrid-renderer-eval-results.json);
human-readable scorecard in
[`evals/hybrid-renderer-eval-results.html`](./evals/hybrid-renderer-eval-results.html)
and as a PDF at
[`docs/hybrid-renderer-eval-scorecard.pdf`](./docs/hybrid-renderer-eval-scorecard.pdf).

```bash
npm install              # ajv + ajv-formats
npm run eval             # node evals/run-evals.mjs — JSON + console summary
node evals/build-scorecard.mjs
```

## What's new in v0.3.0

- **Hybrid renderer** — a deterministic JSON-manifest → HTML pipeline under
  [`renderer/`](./renderer) (pure-function `render.js`, engine, cache,
  styles, 7 widget types, 3 shells) plus a JSON-Schema contract at
  [`schemas/manifest.schema.json`](./schemas/manifest.schema.json). Lets a
  skill produce custom artifacts without hand-authoring HTML.
- **`widget-catalog` skill** — master reference the LLM loads when picking
  widgets, shells, and templates so the manifest stays inside the visual
  grammar. Brings the skill count to 20.
- **`/cw-trail-view` command** — recent CloudTrail events rendered through
  the hybrid renderer (timeline / audit table / dashboard, picked from
  prompt intent).
- **Renderer eval suite** — [`evals/`](./evals) ships 52 prompts × 6 scoring
  dimensions (manifest validity, shell selection, widget relevance, widget
  count, density budget, rendering); latest run is 52 / 52 on every
  dimension. Run with `npm install && npm run eval`. See
  [Renderer evals](#renderer-evals).
- **Hybrid-renderer E2E corpus** — [`data/`](./data) holds JSON inputs,
  generated manifests, rendered HTML, and an E2E report so renderer changes
  can be visually diffed without round-tripping through a live MCP call.

### Carried forward from v0.2.x

- **Phase 6 cascading dependency follow** in all three core workflow skills —
  when a dependency is the suspected root, the workflow recurses one level
  into the dependency's own RED metrics rather than stopping at the boundary.
- **Operational workflows** — `alarm-response` and `slo-compliance-report`
  extend the plugin beyond incident investigation to alarm triage and weekly
  portfolio review.
- **Production-readiness workflows** — `/cw-obs-gaps` audits a service's
  codebase (Python, Java, JS / TS, Go, Ruby, C# / .NET) for logging,
  metrics, tracing, error-handling, and health-check coverage; `/cw-alert-design`
  inventories existing alarms, surfaces noise / fatigue, builds a coverage
  matrix per AWS service in use, and recommends alarm configurations with
  IaC snippets. Both are read-only and non-incident — they prepare a service
  to be observable and alertable before the next page.
- **Quality bar primitives** — `investigation-validator` runs a 6-check
  self-audit on every artifact before it's shown; `incident-memory` persists
  summaries and surfaces recurrences.
- **Tier 3 HTML templates** — seven HTML artifact templates with placeholder
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

## Contributing

```bash
git clone https://github.com/hmiglani30/aws-apm-claude-plugin
cd aws-apm-claude-plugin

# Stdlib-only Python tests (5 modules, mirror the CI matrix):
python -m unittest tests.test_structure tests.test_behavioral \
  tests.test_golden_outputs tests.test_artifact_rendering \
  tests.test_error_taxonomy -v

# Renderer evals (Node — needs `npm install` first for ajv + ajv-formats):
npm install
npm run eval
```

The Python tests cover: manifest validity, version sync across
`plugin.json` / `marketplace.json`, all expected skills / commands /
MCP servers / artifacts present, frontmatter completeness, hook script
executability, Phase 6 presence in workflow skills, Tier 3 skills
referencing their HTML templates, Cloudscape token / placeholder presence
in templates, behavioral expectations, golden artifact outputs, and error
taxonomy completeness.

The renderer evals cover the hybrid renderer end-to-end against 52
prompts × 6 scoring dimensions — see [Renderer evals](#renderer-evals).

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
  prompt-injection defenses, integrity, vulnerability reporting.
- [WRITE-ACTION-WIDGETS.md](WRITE-ACTION-WIDGETS.md) — `action_form` widget
  spec, supported write actions (PutMetricAlarm, TagResource), safety model
  integration.
- [QUICK-APP-PLAN.md](QUICK-APP-PLAN.md) — Amazon Q Quick App functional
  parity matrix and migration plan.
- [eval-analysis.pdf](eval-analysis.pdf) — evaluation analysis.
- [template-design-analysis.pdf](template-design-analysis.pdf) — template
  design analysis.

## Acknowledgments

- The four AWS MCP servers are maintained at [`awslabs/mcp`](https://github.com/awslabs/mcp).
- Workflow content adapted from the [AWS Observability Kiro power](https://github.com/kirodotdev/powers/tree/main/aws-observability).
- Plugin format follows patterns established by the
  [Honeycomb agent skill](https://github.com/honeycombio/agent-skill)
  and [Datadog plugin](https://github.com/DataDog/datadog-api-claude-plugin).

## License

MIT — see [LICENSE](LICENSE).
