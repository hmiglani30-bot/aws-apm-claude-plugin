# Architecture

This doc describes how the plugin is layered, what each layer owns, and which
invariants hold across them. It complements [README.md](README.md) (what you
get) and [MCP-TOOL-CONTRACTS.md](MCP-TOOL-CONTRACTS.md) (the data-access
boundary).

## Architectural principle

> **Plugin owns orchestration and presentation. MCP owns data access. CloudWatch
> owns the system of record.**

This is the load-bearing principle. Every design choice in the plugin should be
checkable against it:

- The plugin **does not** cache or store telemetry. CloudWatch / Application
  Signals / X-Ray / CloudTrail is the source of truth, always queried fresh
  inside the investigation's time window.
- The plugin **does not** implement AWS API calls directly. It calls MCP tools
  whose contracts are documented in [MCP-TOOL-CONTRACTS.md](MCP-TOOL-CONTRACTS.md).
- The plugin **does not** ship its own database or backing service. Memory of
  past incidents is a JSON file under `.aws-apm/incidents/` (per-user, on-disk).
- Workflows, skills, hooks, slash commands, and artifact templates are
  orchestration + presentation. They sit on top of MCP, never beside or
  underneath it.

A practical implication: if you want to swap to a different MCP server (a
remote-hosted variant, a different fork, an internal one), the plugin should
keep working as long as the new server honors the contracts. The skill content
does not need to change.

## Layered view

```
┌──────────────────────────────────────────────────────────────┐
│  User                                                        │
│   "got paged for HighCheckoutErrorRate"                      │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Presentation                                                │
│  - Slash commands         (entry points, deterministic)      │
│  - Workflow skills        (auto-triggered, multi-phase)      │
│  - Tier 3 artifacts       (HTML / Markdown rendering)        │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Orchestration                                               │
│  - Phase 1..6 sequencing  (fixed, per workflow)              │
│  - Time-window propagation                                   │
│  - Context provider       (account/region/env/service/window)│
│  - Hypothesis ranking + evidence cards                       │
│  - investigation-validator (6-check self-audit)              │
│  - incident-memory        (persistence + recurrence check)   │
│  - PreToolUse write-safety hook                              │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Data access (MCP)                                           │
│  - awslabs.cloudwatch-mcp-server                             │
│  - awslabs.cloudwatch-applicationsignals-mcp-server          │
│  - awslabs.cloudtrail-mcp-server                             │
│  - awslabs.aws-documentation-mcp-server                      │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  System of record                                            │
│  AWS CloudWatch + Application Signals + X-Ray + CloudTrail   │
│  (the canonical source for every claim in every artifact)    │
└──────────────────────────────────────────────────────────────┘
```

The plugin code lives in the top two layers. The MCP servers and the AWS APIs
they call are external and unmodified.

## Context provider

Every workflow phase operates on a **context object** with a fixed shape. The
context is computed once at the start of the investigation and threaded through
every phase. Skills MUST read context fields rather than re-deriving them.

```yaml
context:
  account: "123456789012"          # AWS account id
  region: "us-east-2"               # AWS region (must match MCP env)
  environment: "prod"               # prod | staging | dev (heuristic from name)
  service: "checkout"               # Application Signals service name
  operation: "POST /api/checkout"   # optional — operation-scoped investigations
  slo: "checkout-availability"      # optional — SLO-scoped investigations
  alarm: "HighCheckoutErrorRate"    # optional — alarm-scoped investigations
  time_window:
    start: "2026-04-28T07:00:00Z"
    end:   "2026-04-28T08:00:00Z"
    reason: "alarm fired at 07:32, ±30m"
  data_sources_available:           # set at setup time
    cloudwatch_metrics: true
    application_signals: true
    cloudwatch_logs: true           # not all services emit Insights-queryable logs
    xray: true                      # requires SDK instrumentation
    cloudtrail: true
    synthetics: false               # canary may not exist for this service
```

### Why a context provider

- Every artifact's metadata footer is derived directly from the context. The
  same fields appear in every artifact, every time.
- Time-window propagation (see below) becomes trivial — every phase reads
  `context.time_window`.
- A skill that needs to short-circuit ("X-Ray is off; skip span analysis") can
  read `data_sources_available` instead of failing mid-call.
- Multi-account expansion (roadmap) becomes a per-account context, with the
  same skills running in a loop.

### What's NOT in the context

- Raw telemetry. The context names *what* to investigate, not the data itself.
  Each phase fetches data through MCP using context as input parameters.
- Hypotheses. Those are the workflow's *output*, not its input.
- Credentials. The MCP server picks credentials from `AWS_PROFILE` /
  `AWS_REGION` / SDK chain — the plugin never touches them.

## Time-window propagation invariant

> **Every MCP call within a single investigation phase uses the same
> `(start_time, end_time)` pair, computed once from the trigger.**

The trigger is one of:

- **SLO breach**: window = breach detection time ± 30m.
- **Alarm fire**: window = alarm `StateUpdatedTimestamp` ± 30m.
- **User-stated regression**: window = user-stated baseline vs. current,
  with current = last 1h by default.
- **Slash command override**: explicit `[window]` arg trumps the above.

### Why this matters

If Phase 1 looks at metrics for 07:00–08:00 but Phase 4 looks at CloudTrail for
06:30–08:30, the workflow's correlations are noise. The investigation is only
defensible if every phase is anchored in the same window.

### How it's enforced

- The context provider sets `context.time_window` once and never mutates it.
- Every workflow skill's Phase 1 reads from `context.time_window`; Phases 2–6
  inherit it.
- Phase 6 (cascading dependency follow) recurses *with the same window* into
  the dependency's own RED metrics. The window is not re-computed at recursion.
- The `investigation-validator` skill's metadata-footer check verifies the
  window matches what was queried. A mismatch fails the audit.

The only legal window changes are:

1. **Widening for context** — e.g. a baseline comparison may pull a 24h
   secondary window for "yesterday at this time", but this is recorded in the
   artifact's metadata footer as a separate range.
2. **Narrowing for trace selection** — a phase may sub-window down to a
   5-minute slice within the parent to pick representative failed traces. The
   parent window is still recorded.

## Pluggable change providers

CloudTrail is the default change-correlation source (Phase 4 of every workflow:
"any deploys / config changes in the alarm window"), but the architecture
treats it as **one provider among many**. The pluggable interface:

```yaml
change_provider:
  name: cloudtrail
  query(window, resource_filters) -> ChangeEvent[]
  fields:
    - timestamp
    - actor          # who / what made the change
    - resource       # what was changed
    - kind           # deploy | config | scaling | iam | secret | flag
    - source_url     # link to the original event
    - confidence     # exact-match | best-match | approximate
```

The Top Suspected Cause artifact takes a uniform `ChangeEvent[]` regardless of
provider, so adding a provider is "implement the contract, register the
adapter".

### Roadmap providers

| Provider | Maps to | Status |
|---|---|---|
| **CloudTrail** (default) | AWS API calls within window | Shipped |
| **CodePipeline** | Deploy approvals, stage transitions | Roadmap |
| **GitHub** | Commits + tags + PR merges to main | Roadmap |
| **LaunchDarkly / OpenFeature** | Feature flag flips | Roadmap |
| **Terraform Cloud** | Run / apply events for the matched resource | Roadmap |

### Why pluggable

The "what changed?" question rarely has one source. A 5xx spike right after a
secret rotation might be invisible in CloudTrail (the rotation happened in
Secrets Manager → console, but the *consumer* never reloaded) — but obvious in
LaunchDarkly if the team flipped a "use new secret" flag the same minute. A
plugin that only knows about CloudTrail will produce a confidently wrong root
cause.

## Multi-account architecture (roadmap)

Today the plugin operates in a single (account, region) chosen by the
`AWS_PROFILE` / `AWS_REGION` environment variables passed to the MCP servers.
The roadmap target is **multi-account observability**, where one user with
the right SSO role can investigate across an entire AWS Organization.

### Components (planned)

- **SSO + role assumption** — the plugin reads SSO cache (`~/.aws/sso/cache`)
  to discover available roles, lists which roles can `sts:AssumeRole` into
  which target accounts, and picks the role with the minimum required
  permissions in the target.
- **Organizations integration** — `organizations:ListAccounts` to enumerate
  member accounts; `tag:GetResources` for service-to-account ownership;
  Account / OU tags surfaced in the context provider as `context.account` and
  `context.ou_path`.
- **Cross-account observability** — the plugin's preferred path is AWS
  CloudWatch cross-account observability (sharing accounts → monitoring
  account) when present, falling back to per-account role assumption when not.
- **Per-account context loop** — workflow skills re-run per account when the
  user asks "any service in any account at risk?", aggregating results into a
  portfolio-level artifact.

### Why this is roadmap, not shipped

Multi-account requires:

- A consistent way to enumerate the target set (Organizations + tagging).
- A safe role-assumption story (least-privilege, session tags for audit).
- Aggregation UX that avoids drowning the user in 50 simultaneous artifacts.

The plugin's MVP intentionally constrains itself to a single account so the
investigation method is solid before account multiplexing layers on top.

## Data sovereignty

### Local-only by default

In the current Claude Code / Cowork installation, all plugin code runs **on
the user's machine**:

- Skills and slash commands are markdown files Claude reads locally.
- The PreToolUse hook is a shell script executed locally.
- MCP servers are launched locally via `uvx` and run as local processes.
- Incident memory persists to `.aws-apm/incidents/` on the user's filesystem.

The data flow per investigation:

```
User prompt → Claude (Anthropic API)
            ↓
            Claude calls MCP tool locally
            ↓
            MCP server signs an AWS API call with local credentials
            ↓
            AWS responds with telemetry
            ↓
            MCP server returns to Claude
            ↓
            Claude (Anthropic API) reasons over telemetry → artifact
            ↓
            User sees artifact in Claude Code / Cowork UI
```

The egress points are:

- **AWS APIs** — over the user's network, signed by local credentials.
- **Anthropic API** — user prompts, MCP tool results, model output. The MCP
  tool result *can include AWS telemetry strings* (log lines, metric values,
  trace IDs, error messages). Treat these as model context.

The plugin never POSTs telemetry to a third-party service the user did not
configure. There is no plugin-operated backend.

### Remote / hosted future

A future "Claude.ai connector" path (out of scope for v0.2) would change this
substantially: the MCP servers would run in a hosted environment with
delegated AWS access, and the IAM / audit / egress story changes accordingly.
That mode requires additional design we've called out in
[SECURITY.md](SECURITY.md) and is **not** the current shipping mode.

### Auth

- Local: AWS SDK default credential chain (env vars, `AWS_PROFILE`, EC2/ECS
  task role, SSO). The plugin does not request, store, or transmit
  credentials.
- Anthropic: handled by Claude Code / Cowork's own auth; the plugin does not
  touch the Anthropic key.

### Audit

- Every AWS read is logged in **CloudTrail** in the user's account (because
  AWS sees the API call, not the plugin). This is the canonical audit trail.
- Tier-4 writes are additionally logged in the local Claude Code transcript
  (the chat history shows the confirmation prompt and the tool result).
- Tier-5 disallowed actions never reach AWS; their absence in CloudTrail is
  the proof.

## Schema and version governance

Plugin manifests, MCP contracts, and artifact templates all version together.

### Plugin version (`.claude-plugin/plugin.json`)

- `version` is SemVer.
- **Major bump**: breaking change to skill names, removed slash commands,
  removed artifacts, removed MCP servers.
- **Minor bump**: new skills, new slash commands, new MCP-tool dependencies,
  new artifact placeholders, new workflow phases.
- **Patch bump**: doc fixes, prompt tuning that doesn't change observable
  behavior, hook bugfixes.

The plugin and marketplace versions MUST match — the
`test_versions_are_in_sync` test enforces this.

### MCP tool contract version

Contracts in [MCP-TOOL-CONTRACTS.md](MCP-TOOL-CONTRACTS.md) are versioned
implicitly by plugin version. Any contract change is a plugin minor bump at
minimum, with the diff in the changelog.

### Artifact placeholder schema

HTML artifact templates use `{{PLACEHOLDER}}` substitution. Adding a placeholder
is a minor bump; renaming or removing one is a major bump. The structural
tests check that every Tier 3 skill's `SKILL.md` references the same template
file the artifact lives in, so a rename without skill update breaks CI.

### Incident memory schema

Files under `.aws-apm/incidents/` are JSON. The schema is versioned via a
`schema_version` field in each file. The `incident-memory` skill MUST handle
older versions on read (forward-compat) and write only the current version.
Schema changes are a plugin minor bump.

### Skill frontmatter schema

`SKILL.md` files have YAML frontmatter with `name`, `description`,
`metadata.version`. Adding a frontmatter field is non-breaking if the
structural tests treat it as optional. The `name` field MUST match the
directory name — `test_each_skill_has_skill_md_with_required_frontmatter`
enforces this.

## Why this layering

- **Plugin / MCP / SoR split** keeps each layer independently replaceable.
  The plugin survives MCP-server upgrades; MCP survives plugin-prompt rewrites;
  CloudWatch survives both.
- **Context-provider abstraction** prevents skills from re-deriving the same
  facts five times and getting them inconsistent.
- **Time-window invariant** is the single most important correctness
  property of an investigation — it's worth its own enforcement step in the
  validator.
- **Pluggable change providers** acknowledge that "what changed?" is rarely
  one provider's job. The plugin is opinionated about the question, agnostic
  about the answer source.
- **Local-only data flow** keeps the security review tractable: every
  telemetry byte's path can be traced to a local process and a CloudTrail
  entry.
