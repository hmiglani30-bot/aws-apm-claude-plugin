# Cowork runtime — what works, what's missing, how to verify

This plugin is designed to run in Claude Code (local) and Cowork (Claude's
desktop app, which executes plugin code in a lightweight Linux VM). The
Cowork environment is more constrained than a developer laptop — this doc
captures what the plugin needs from the runtime and how it degrades when
something is missing.

The single source of truth for "is the plugin actually working *here*" is
`/cw-doctor`. This doc explains *why* each of those checks exists.

## End-to-end data flow

```
                ┌──────────────────────────────────────────────────────┐
                │  Cowork lightweight VM (or Claude Code local shell)  │
                │                                                      │
   user types   │  uvx ──► awslabs MCP server ──► AWS SDK              │
   /cw-* in     │            │                       │                 │
   Cowork  ───► │            ▼                       ▼                 │  ──► AWS APIs
                │   model picks tools     signs request with creds     │
                │            │                                         │
                │            ▼                                         │
                │   skill receives JSON, builds manifest               │
                │            │                                         │
                │            ▼                                         │
                │   manifest.json on disk                              │
                │            │                                         │
                │            ▼                                         │
                │   node render-standalone.mjs ──► artifact.html       │
                │                                       │              │
                │                                       ▼              │
                │                          Cowork displays inline      │
                └──────────────────────────────────────────────────────┘
```

Every arrow above is verified by a check in `/cw-doctor`. If any single
arrow is broken, `/cw-doctor` reports the first broken link rather than
silently degrading.

## Per-arrow runtime requirements

| Arrow | Requires | `/cw-doctor` check | Failure mode if missing |
|---|---|---|---|
| User → MCP server launch | `uvx` on PATH | 0a | Every MCP tool fails to launch — no AWS data flows in at all |
| MCP server → AWS | AWS credentials reachable from inside the VM | 2 (caller identity) | `Unable to locate credentials` from every MCP call |
| AWS → MCP server | Network egress to AWS regional endpoints | 5–8 | Timeout / DNS errors |
| Skill → manifest | Model is in the loop | implicit | n/a — handled by Claude itself |
| Manifest → HTML | `node` ≥ 18 on PATH, `${CLAUDE_PLUGIN_ROOT}` resolves | 0b, 0c, 10 | Manifest written, HTML not. Plugin still produces Markdown summary; HTML artifact view is degraded |
| HTML → Cowork display | HTML written under `${CLAUDE_PROJECT_DIR}/.aws-apm/artifacts/` | 11 | Cowork can't pick up the artifact for inline display |

## Why `mcp__awslabs_<server>__<tool>` (not `mcp__awslabs.<server>__*`)

The MCP tool prefix Claude Code / Cowork actually exposes is
`mcp__awslabs_<server-name>__<tool>` — single underscore between `awslabs`
and `<server-name>`, double underscore at the boundary, lowercase
underscore-separated tool names. The dot in the `.mcp.json` server id
(`awslabs.cloudwatch-mcp-server`) gets converted to a single underscore in
the tool prefix. The plugin's `allowed-tools` patterns and hook matcher
must use this exact shape — anything else is a silent no-op (no error, no
permissions, no hook firing).

| Wrong | Right |
|---|---|
| `mcp__awslabs.cloudwatch-mcp-server__*` | `mcp__awslabs_cloudwatch-mcp-server__*` |
| `mcp__awslabs__.*__(Put\|...)` | `mcp__awslabs_[a-z0-9-]+__(put\|...)_.*` |
| `mcp__awslabs__cloudwatch_mcp_server__PutMetricAlarm` | `mcp__awslabs_cloudwatch-mcp-server__put_metric_alarm` |

## Cowork-specific gotchas

### `uvx` is probably not pre-installed
Cowork's VM is intentionally minimal. Run the install command from
`/cw-doctor`'s "Fix this" block:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```
This drops `uvx` at `~/.local/bin/uvx`, which Cowork's default PATH already
includes. Restart the Cowork session for the MCP servers to pick it up.

### AWS credentials must reach the VM
The plugin uses the AWS SDK default credential chain inside whatever
process the MCP server runs in. There are three workable paths in Cowork:

1. **Environment variables** — set `AWS_ACCESS_KEY_ID` /
   `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (and optionally
   `AWS_REGION`) in the Cowork session before launching MCP. This is the
   simplest form for short-lived investigation sessions.
2. **`~/.aws/` mounted into the VM** — if Cowork mounts the host's home
   directory, `aws configure` on the host populates the VM's view as
   well. `/cw-doctor` check 2 confirms this works in your specific Cowork
   build.
3. **SSO / role assumption** — works if `aws sso login` has been run on
   the host and the SSO cache directory (`~/.aws/sso/cache/`) is
   reachable from inside the VM.

The plugin never asks for or persists credentials. If check 2 fails with
`Unable to locate credentials`, the Cowork VM does not see any of the
above — pick whichever of (1)–(3) fits your workflow.

### `node` for the renderer
The HTML artifact path needs Node.js 18+. If `/cw-doctor` check 0b fails:
- Cowork VM with apt: `apt-get install -y nodejs npm` (may need sudo)
- macOS / Linux dev box: install via your usual Node manager (nvm, fnm,
  asdf, or nodejs.org installer)

If Node really cannot be installed, the plugin still produces Markdown
summaries from every workflow — the HTML view is the affected feature, not
the investigation logic.

### `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PROJECT_DIR}`
Both are populated by the plugin host. `CLAUDE_PLUGIN_ROOT` resolves to
the plugin's install directory (where `render-standalone.mjs` and the
hooks live); `CLAUDE_PROJECT_DIR` resolves to the user's working repo (the
default place to write artifacts so they're discoverable).

The hook script (`hooks/scripts/confirm-write.sh`) and the renderer
invocation in skills both depend on these. If `/cw-doctor` check 0c fails
the plugin is loaded incorrectly — re-install via the marketplace.

## What the plugin does NOT need

- A running browser context. The renderer is a Node CLI that produces a
  fully self-contained HTML file (CSS and JS are inlined).
- Network access to anywhere except AWS regional endpoints. The renderer
  has no fetch calls; manifests are read from disk.
- Privileged access. Every probe in `/cw-doctor` is a read-only call;
  every AWS call is `Get*` / `List*` / `Describe*` unless the user
  explicitly approves a write through the confirmation hook.
