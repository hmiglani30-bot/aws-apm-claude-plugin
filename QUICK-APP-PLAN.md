# Quick App Parity Plan

How to bring the Amazon Q Quick App to functional parity with the Claude Code
plugin, with minimal net-new work. The guiding insight: the plugin is
**prompt-driven orchestration on top of MCP**. Quick Apps natively support MCP
via "action connectors." If the intelligence layer (skills, commands,
templates, safety model) can be fed into both hosts, the Quick App is
mostly a config + transport exercise.

---

## 1. Functional parity matrix

### 1.1 Skills (19)

| # | Skill | Plugin | Quick App | Notes |
|---|---|---|---|---|
| 1 | `alarm-response` | Yes | Yes | Core investigation workflow. Same SKILL.md prompt drives both hosts. |
| 2 | `alerting-design` | Yes | Yes | Non-incident planning. Same prompt. |
| 3 | `aws-apm-setup` | Yes | **No** | Plugin-specific: checks `uvx`, local `.mcp.json`, local AWS creds. Quick App has its own onboarding (IAM role, connector config). |
| 4 | `copy-to-incident` | Yes | Partial | Text reformatting works. Slack/PagerDuty deep links may differ (Quick App has no local Slack MCP). |
| 5 | `error-spike-triage` | Yes | Yes | Core investigation workflow. Same prompt. |
| 6 | `hybrid-renderer` | Yes | Yes | JSON manifest -> renderer. Both hosts consume the same manifest schema. |
| 7 | `incident-memory` | Yes | **Degraded** | Plugin writes JSON to `~/.aws-apm/incidents/`. Quick App has no local filesystem. Needs a persistence adapter (DynamoDB or S3). |
| 8 | `investigation-validator` | Yes | Yes | Pure model self-check. No host dependencies. |
| 9 | `latency-regression` | Yes | Yes | Core investigation workflow. Same prompt. |
| 10 | `observability-gap-analysis` | Yes | **No** | Requires reading the user's local codebase via `Read`/`Grep`. Quick App has no filesystem access. Plugin-only. |
| 11 | `open-in-cloudwatch` | Yes | Yes | URL construction. Identical. |
| 12 | `service-health-card` | Yes | Yes | Artifact renderer. Same prompt. |
| 13 | `service-ownership` | Yes | Partial | Tag/Catalog lookups work. CODEOWNERS/GitHub/PagerDuty require additional MCP integrations the Quick App may not have. |
| 14 | `slo-breach-explainer` | Yes | Yes | Artifact renderer. Same prompt. |
| 15 | `slo-breach-investigation` | Yes | Yes | Core investigation workflow. Same prompt. |
| 16 | `slo-compliance-report` | Yes | Yes | Portfolio report. Same prompt. |
| 17 | `top-suspected-cause` | Yes | Yes | Artifact renderer. Same prompt. |
| 18 | `trace-to-code` | Yes | **No** | Requires local repo access (`Read`, `Grep`, git). Plugin-only. |
| 19 | `trace-waterfall-summary` | Yes | Yes | Artifact renderer. Same prompt. |

**Summary**: 14 skills work in both, 3 are plugin-only (setup, obs-gaps,
trace-to-code), 2 are degraded (incident-memory needs a persistence adapter,
service-ownership loses non-AWS lookups).

### 1.2 Commands (12)

| # | Command | Plugin | Quick App | Notes |
|---|---|---|---|---|
| 1 | `/cw-alarm-response` | Yes | Yes | Dispatches to `alarm-response` skill. Same prompt. |
| 2 | `/cw-alert-design` | Yes | Yes | Dispatches to `alerting-design` skill. |
| 3 | `/cw-doctor` | Yes | **No** | Checks local MCP servers, uvx, AWS identity. Plugin-only diagnostics. |
| 4 | `/cw-health-check` | Yes | Yes | Dispatches to service-health-card across services. |
| 5 | `/cw-investigate-errors` | Yes | Yes | Dispatches to `error-spike-triage`. |
| 6 | `/cw-investigate-latency` | Yes | Yes | Dispatches to `latency-regression`. |
| 7 | `/cw-investigate-slo` | Yes | Yes | Dispatches to `slo-breach-investigation`. |
| 8 | `/cw-obs-gaps` | Yes | **No** | Requires local filesystem. Plugin-only. |
| 9 | `/cw-set-context` | Yes | **Replaced** | Quick App uses IAM role + connector config instead of local `AWS_PROFILE`. Needs a Quick-App-specific context picker. |
| 10 | `/cw-slo-report` | Yes | Yes | Dispatches to `slo-compliance-report`. |
| 11 | `/cw-trail-view` | Yes | Yes | Dispatches to hybrid-renderer with CloudTrail data. |
| 12 | `/cw-verify-recovery` | Yes | Yes | Dispatches to recovery verification. |

**Summary**: 9 commands work in both, 2 are plugin-only (doctor, obs-gaps),
1 needs replacement (set-context).

### 1.3 Other capabilities

| Capability | Plugin | Quick App | Notes |
|---|---|---|---|
| PreToolUse write-safety hook | Yes | **Different mechanism** | Quick App has no shell hooks. Safety gating moves to the prompt layer (system prompt instructions + structured approval block in chat). |
| MCP-UI template rendering | Yes (iframe in side panel) | Yes (iframe in Quick App shell) | Same `UIResource` payloads, same `shared/templates.json`, same `shared/tokens.css`. |
| `action_form` widgets | Yes (Cloudscape in iframe) | Yes (same iframe payload) | The form itself is identical. Confirmation flow differs (see section 4). |
| Incident memory persistence | Local JSON files | Needs adapter | DynamoDB or S3 via a thin Lambda, or Quick App's own state store if available. |
| Local codebase access | Yes (`Read`, `Grep`, `Bash`) | No | Quick App is sandboxed. No filesystem. |

---

## 2. Shared intelligence layer

### 2.1 Skills and commands — shareable as-is

Skills and commands are **markdown files containing prompts**. They do not
contain host-specific code. The model reads them and follows the instructions.
This is the single biggest reuse win.

**Shareable as-is (zero changes)**:
- 14 of 19 SKILL.md files
- 9 of 12 command .md files
- The `investigation-validator` 6-check self-audit
- The structured approval block format (used by alarm-response,
  slo-breach-investigation, alerting-design)
- Hypothesis ranking / evidence card format
- Context provider shape (account, region, service, time_window)

**How to share**: Both repos can either:
1. **Symlink / copy**: Keep a `shared/skills/` directory in the monorepo root,
   symlinked into both `aws-apm-claude-plugin/skills/` and
   `aws-apm-quick-app/skills/`. OR
2. **Git submodule**: Extract `skills/` and `commands/` into a shared repo.
3. **Simplest**: Just copy the files. They change rarely (prompt tuning is a
   patch bump). A CI check can diff them.

Recommendation: **option 3 (copy + CI diff check)** for v1. No infra overhead.

### 2.2 MCP server definitions — same servers, different transport

Plugin `.mcp.json`:
```json
{
  "awslabs.cloudwatch-mcp-server": {
    "command": "uvx",
    "args": ["awslabs.cloudwatch-mcp-server@0.0.25"],
    "env": { "AWS_PROFILE": "default", "AWS_REGION": "us-east-1" }
  }
}
```

Quick App equivalent (Amazon Q action connector config):
```json
{
  "connectorType": "MCP",
  "serverUri": "arn:aws:q:us-east-1:123456789012:connector/cloudwatch-mcp",
  "transport": "streamableHttp",
  "auth": { "type": "IAM_ROLE", "roleArn": "arn:aws:iam::role/QuickAppMCPRole" }
}
```

**Same servers, same tools, same tool names.** The transport changes from
local stdio (`uvx` subprocess) to remote HTTP/SSE (Quick's managed connector
infrastructure). The tool contracts in MCP-TOOL-CONTRACTS.md apply to both.

**What changes**: Auth goes from local AWS SDK credential chain to IAM role
assumed by the Quick App connector. The Quick App never sees raw credentials.

### 2.3 Template system — shared as-is

`shared/templates.json` is already shared between both repos. It defines
`single`, `stacked`, and `grid` layouts. The `investigation_with_actions`
template from WRITE-ACTION-WIDGETS.md will be added to this shared file.

`shared/tokens.css` is already shared. Design tokens are identical.

The renderer (`renderer.js` in Quick App, `renderer/render.js` in plugin)
consumes the same JSON manifest and produces the same Cloudscape HTML in a
sandboxed iframe. The Quick App already has a working renderer.

### 2.4 Action safety model in Quick App

The 5-tier model is **prompt-level**, not code-level. The tier classification
lives in the SKILL.md files and ACTION-SAFETY-MODEL.md. The model reads these
and follows them. This works in any host.

| Tier | Plugin enforcement | Quick App enforcement |
|---|---|---|
| 1 (read-only) | Runs freely | Runs freely |
| 2 (suggested action) | Written in artifact, not executed | Same |
| 3 (console deep-link) | `open-in-cloudwatch` produces URL | Same |
| 4 (MCP-executable + approval) | PreToolUse shell hook (`confirm-write.sh`) gates the call | **System prompt instruction** + structured approval block in chat. Quick App's model reads the same SKILL.md, surfaces the same approval block, waits for `CONFIRM <ToolName>`. No shell hook needed — the model itself is the gate. |
| 5 (disallowed) | Shell hook blocks + model instruction | **Model instruction only**. The model reads ACTION-SAFETY-MODEL.md and refuses. Quick App connector IAM role should also lack Tier-5 permissions as defense-in-depth. |

**Key difference**: The plugin has a deterministic shell hook as a backstop.
The Quick App relies on prompt-level instruction + IAM restriction. This is
acceptable because:
1. The IAM role for the Quick App connector should be scoped to Tier-1 read
   permissions by default (same recommendation as the plugin).
2. If Tier-4 writes are enabled, the IAM role is the enforcement boundary.
3. The structured approval block format is identical — the user still types
   `CONFIRM PutMetricAlarm` in the Quick App chat.

**Recommendation**: For v1 Quick App, ship read-only (Tier 1 only). Defer
Tier-4 write support to v2. This eliminates the hook-parity question entirely.

---

## 3. Minimal work path

### 3.1 Zero work — shared as-is

| Artifact | Count | Effort |
|---|---|---|
| SKILL.md files (14 of 19) | 14 files | Copy |
| Command .md files (9 of 12) | 9 files | Copy |
| `shared/templates.json` | 1 file | Already shared |
| `shared/tokens.css` | 1 file | Already shared |
| ACTION-SAFETY-MODEL.md (as system prompt) | 1 file | Include in Quick App system prompt |
| MCP-TOOL-CONTRACTS.md | 1 file | Same contracts apply |
| Context provider shape | Prompt text | Same YAML shape in skills |
| Investigation-validator checklist | 1 skill | Copy |
| Structured approval block format | Prompt text | Same across both |
| `open-in-cloudwatch` URL templates | 1 skill | Copy |

### 3.2 Config-only — change transport, no new code

| Item | What changes | Effort |
|---|---|---|
| MCP server connections | stdio -> HTTP/SSE action connectors | Amazon Q console config. 4 connectors, ~15 min each. |
| AWS auth | `AWS_PROFILE` env var -> IAM role on connector | IAM policy creation (copy from SECURITY.md read-only policy). |
| Region/account | Env var -> connector config or Quick App parameter | Config |

### 3.3 Needs new code

| Item | What to build | Effort estimate |
|---|---|---|
| **Quick App system prompt** | Assemble from ARCHITECTURE.md context provider + ACTION-SAFETY-MODEL.md tiers + skill trigger-phrase routing table. The prompt tells the Quick App model which skill to invoke for which user query. | 1 day |
| **Context picker (replaces /cw-set-context)** | Quick App UI for selecting account/region. Could be a simple dropdown that sets connector parameters. | 0.5 day |
| **Incident memory adapter** | Replace local JSON file I/O with DynamoDB `PutItem`/`GetItem` via a 5th MCP server or a Quick App action. Schema is identical (`schema_version`, service, timestamp, summary). | 1-2 days |
| **Quick App packaging** | Wrap the existing `src/` scaffold as an Amazon Q Quick App bundle. Manifest file, icon, description, connector declarations. | 0.5 day |
| **MCP client real transport** | Replace the stub `MCPClient` in `src/mcp-client.js` with `@modelcontextprotocol/sdk` client using HTTP/SSE transport to Quick's connector endpoints. | 1 day |
| **Quick-App-specific /cw-doctor** | Health check that verifies connectors are reachable, IAM role has required permissions, and Application Signals is enabled in the target account. | 0.5 day |
| **service-ownership adapter** | For non-AWS lookups (CODEOWNERS, PagerDuty), either drop them gracefully or add optional MCP connectors. | 0.5 day (graceful degradation path) |

**Total new code**: ~5-6 days of work.

### 3.4 Explicitly NOT building

| Item | Why not |
|---|---|
| New skills for Quick App | The 14 shared skills are the intelligence layer. No new prompts needed. |
| New renderer | The Quick App already has `src/renderer.js`. Same UIResource payloads. |
| New template system | `shared/templates.json` is already shared. |
| New widget types | `stat_card`, `table`, `action_form` work in both (same iframe HTML). |
| Tier-4 write support in v1 | Ship read-only first. Add writes in v2 once the prompt-only safety gate is validated. |
| `observability-gap-analysis` in Quick App | Requires local codebase. Fundamentally plugin-only. |
| `trace-to-code` in Quick App | Requires local repo. Fundamentally plugin-only. |

---

## 4. Divergence points — where the two MUST differ

### 4.1 Auth model

| | Plugin | Quick App |
|---|---|---|
| AWS creds | Local SDK chain (`AWS_PROFILE`, env vars, SSO cache) | IAM role assumed by Quick App connector |
| Anthropic/model | Claude Code's own auth | Amazon Q's model (Bedrock-hosted Claude or Q's own model) |
| User identity | Implicit (whoever is logged into the terminal) | Amazon Q user identity (SSO/IdC) |

**Implication**: The Quick App's system prompt must NOT reference `AWS_PROFILE`
or local credential chain. Skills that mention "the MCP server picks credentials
from AWS_PROFILE" need a one-line edit: "the connector uses the configured IAM
role."

### 4.2 Deployment model

| | Plugin | Quick App |
|---|---|---|
| Installation | `git clone` + `uvx` + local `.mcp.json` | Amazon Q admin publishes Quick App; users open it from the Q console |
| Updates | `git pull` | Admin republishes the app bundle |
| MCP servers | Local subprocesses (stdio) | Managed connectors (HTTP/SSE) hosted by Amazon Q infrastructure |
| State | Local filesystem (`~/.aws-apm/incidents/`) | Cloud state (DynamoDB, S3, or Q's state API) |

### 4.3 UI rendering

| | Plugin | Quick App |
|---|---|---|
| Host shell | Claude Code side panel / Cowork artifact panel | Quick App iframe shell (`src/index.html`) |
| CSP | Cowork's CSP (allows Cloudscape CDN) | Quick App sandbox CSP (stricter; must inline or bundle Cloudscape) |
| Interactivity | `window.__AWS_APM_MANIFEST__` + local render | Same manifest injected into iframe via `srcdoc` |
| Link handling | Cowork opens links in system browser | Quick App's `mcpUi.openLink` RPC bridge opens links (URL allowlist enforced) |

**Implication**: The Quick App may need to bundle Cloudscape CSS/JS into the
`srcdoc` payload instead of loading from CDN, depending on CSP restrictions.
The plugin's renderer already handles this via inline injection.

### 4.4 Write-action confirmation

| | Plugin | Quick App |
|---|---|---|
| Gate mechanism | PreToolUse shell hook (`confirm-write.sh`) — deterministic, matcher-based | Prompt-level instruction only. Model reads ACTION-SAFETY-MODEL.md and follows structured approval block format. |
| Backstop | Shell script blocks unconfirmed writes at the process level | IAM role restrictions (no write permissions = no writes possible) |
| Confirmation UX | User types `CONFIRM <ToolName>` in Claude Code chat | User types same phrase in Quick App chat |

**Implication**: The Quick App's safety boundary for writes is IAM, not a
shell hook. This is actually stronger — even if the model hallucinates past
the prompt instruction, the AWS API rejects the call.

### 4.5 Model

| | Plugin | Quick App |
|---|---|---|
| Model | Claude (via Anthropic API, through Claude Code) | Amazon Q's model (could be Bedrock-hosted Claude, or Q's own model) |
| System prompt | Claude Code's plugin system prompt + CLAUDE.md | Quick App system prompt (needs to be authored) |
| Skill loading | Claude Code reads SKILL.md files from disk on demand | Quick App system prompt includes skill routing table; full skill text loaded on demand or pre-loaded |

**Implication**: If the Quick App uses a non-Claude model, skill prompts may
need minor tuning. The structured output formats (JSON manifests, approval
blocks, evidence cards) are model-agnostic, but the investigative reasoning
quality depends on the model's capability.

---

## 5. Implementation steps

### Phase 1: Shared foundation (2 days)

1. **Copy shared skills and commands** into the Quick App repo.
   Copy the 14 shareable SKILL.md files and 9 command .md files.
   Add a CI script that diffs them against the plugin repo and fails if
   they diverge without an explicit exclusion.
   *Effort: 0.5 day.*

2. **Author the Quick App system prompt.**
   Assemble from:
   - ARCHITECTURE.md context provider section (context shape)
   - ACTION-SAFETY-MODEL.md (all 5 tiers, adapted for "connector IAM role"
     instead of "local credentials")
   - Skill routing table (trigger phrases -> skill names, extracted from
     SKILL.md frontmatter `description` fields)
   - Investigation-validator instructions
   - Hybrid-renderer manifest grammar
   *Effort: 1 day.*

3. **Create IAM policy for Quick App connectors.**
   Copy the read-only policy from SECURITY.md. Scope to Tier-1 verbs only.
   Create one policy; attach to one role; all 4 connectors assume it.
   *Effort: 0.5 day.*

### Phase 2: Transport + client (2 days)

4. **Configure 4 MCP action connectors in Amazon Q.**
   One connector per MCP server. Same server packages, HTTP/SSE transport.
   Map each connector to the IAM role from step 3.
   *Effort: 0.5 day.*

5. **Wire real MCP client in Quick App.**
   Replace the stub `MCPClient` in `src/mcp-client.js` with
   `@modelcontextprotocol/sdk` client using the transport endpoint URLs
   from the action connectors.
   *Effort: 1 day.*

6. **Build context picker UI.**
   Replace `/cw-set-context` with a dropdown in the Quick App shell header
   that lets the user pick account/region. Sets connector parameters
   accordingly.
   *Effort: 0.5 day.*

### Phase 3: Persistence + packaging (2 days)

7. **Incident memory adapter.**
   Create a thin DynamoDB adapter that implements the same read/write
   interface as the plugin's local JSON files. Table schema:
   `PK = service#account`, `SK = timestamp`, attributes match
   `schema_version` 1 incident JSON. A single Lambda behind an MCP
   connector, or inline in the Quick App if Q supports direct SDK calls.
   *Effort: 1.5 days.*

8. **Package as Amazon Q Quick App.**
   Create the Quick App manifest (name, description, icon, connector
   references). Bundle `src/` + `shared/` into the app package. Test
   deployment to Q console.
   *Effort: 0.5 day.*

### Phase 4: Validation (1 day)

9. **End-to-end test: run each shared command.**
   For each of the 9 shared commands, run in both plugin and Quick App
   against the same account/region/time-window. Verify:
   - Same MCP tools called
   - Same artifact structure produced
   - Same deep links generated
   - Same investigation-validator checks pass
   *Effort: 1 day.*

### Phase 5 (v2): Write support (deferred)

10. **Add Tier-4 write permissions to connector IAM role.**
11. **Validate prompt-only safety gate** (structured approval block,
    `CONFIRM` phrase) works correctly without the shell hook backstop.
12. **Ship `action_form` widget in Quick App** (same component, same
    iframe rendering).

---

## 6. Effort summary

| Phase | Work | Days |
|---|---|---|
| 1. Shared foundation | Copy skills, system prompt, IAM policy | 2 |
| 2. Transport + client | Connectors, real MCP client, context picker | 2 |
| 3. Persistence + packaging | Incident memory adapter, Q app bundle | 2 |
| 4. Validation | End-to-end parity testing | 1 |
| **Total v1** | | **7 days** |
| 5. Write support (v2) | Tier-4 IAM, safety validation, action_form | 3 |
| **Total v1 + v2** | | **10 days** |

The Quick App gets 14/19 skills, 9/12 commands, the full template/renderer
system, the full safety model, and the full investigation workflow — all by
reusing the plugin's intelligence layer with a transport swap.
