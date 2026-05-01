---
description: Pick the AWS profile and region the plugin operates against — lists available profiles and regions with Application Signals services, then sets context for subsequent commands
argument-hint: [profile] [region]
allowed-tools: [Read, Bash, Grep]
---

# /cw-set-context

Account and region selector. Resolves which AWS profile and region the rest
of the AWS APM plugin's commands and skills will run against, surfaces which
regions actually have Application Signals services, and pins the choice for
the rest of the session.

The user invoked this with: `$ARGUMENTS`

## Why this exists

Every other AWS APM command (`/cw-doctor`, `/cw-health-check`,
`/cw-investigate-*`, `/cw-alarm-response`) operates on whatever region and
profile the MCP servers picked up at launch. In multi-account / multi-region
shops that's wrong by default — the on-call engineer might be paged on
`us-west-2` while the plugin was launched against `us-east-2`. This
command makes the choice explicit and visible.

## Instructions

1. Parse `$ARGUMENTS`:
   - **No args** — interactive: list profiles, list regions per profile,
     prompt the user to pick.
   - **One arg** — treat as profile name; list regions for that profile.
   - **Two args** — treat as `<profile> <region>`; set context directly.

2. Resolve available profiles:
   - Read `~/.aws/credentials` and `~/.aws/config` (if present).
   - Surface each profile name + its source (`credential_process`, `sso`,
     static keys) so the user knows what they're picking.
   - If `AWS_PROFILE` is already set in env, mark it as the current
     default with a `(current)` annotation.

3. Resolve available regions:
   - For the chosen profile, list every region where Application Signals
     has at least one service.
   - Use `list_monitored_services` against each region; cap fan-out at 5 concurrent
     and only probe regions where the user typically runs (start with
     `us-east-1`, `us-east-2`, `us-west-2`, `eu-west-1`, then ask if they
     want a wider scan).
   - Annotate each region with the service count.

4. Confirm the selection and surface what changes:
   - Show the profile + region the user picked.
   - Show which `.mcp.json` env vars will need to be updated, OR offer to
     update them in-place.
   - **Do not silently rewrite `.mcp.json`.** Show the exact diff and ask
     for confirmation before any write.

5. Persist the choice:
   - **Preferred**: edit `.mcp.json` in the plugin directory so all four
     MCP servers pick up the new region on next launch.
   - **Alternative**: write to a session-scoped context file
     (`~/.claude/aws-apm-context.json`) that subsequent commands read.
     Use this when the user does not want to edit the committed
     `.mcp.json`.

6. After persisting, recommend running `/cw-doctor` to confirm the new
   context is healthy.

## Canonical output layout

```markdown
## 🌐 AWS APM Context Selector

### Available profiles
| Profile | Source | Notes |
|---|---|---|
| `default` (current) | static keys | `~/.aws/credentials` |
| `prod-readonly` | sso | `~/.aws/config` SSO session `corp-sso` |
| `staging` | credential_process | `~/.aws/config` |

### Regions with Application Signals services (profile: `prod-readonly`)
| Region | Services | Notes |
|---|---|---|
| `us-east-1` | 47 | (current) |
| `us-east-2` | 12 | |
| `us-west-2` | 0 | no services configured |
| `eu-west-1` | 6 | |

> Want me to scan more regions? (`/cw-set-context prod-readonly --scan-all`)

### Pick a context
Reply with `<profile> <region>`, e.g. `prod-readonly us-east-1`.
```

After the user picks:

```markdown
## Confirm context change

**From:** `default` · `us-east-2`
**To:** `prod-readonly` · `us-east-1`

This will update `.mcp.json` env for all 4 MCP servers:
- `awslabs_cloudwatch-mcp-server`
- `awslabs_cloudwatch-applicationsignals-mcp-server`
- `awslabs_cloudtrail-mcp-server`
- (`aws-documentation-mcp-server` does not need credentials — unchanged)

Reply `yes` to apply, or `cancel` to keep the current context.
```

After applying:

```markdown
✅ Context set to `prod-readonly` · `us-east-1`.

> Restart Claude Code OR reconnect MCP servers for the new env to take effect.
> Then run `/cw-doctor` to confirm.
```

## Action safety

- The probes (`list_monitored_services` per region) are read-only.
- Editing `.mcp.json` IS a write to the working tree — must go through the
  plugin's PreToolUse confirmation gate. Show the diff, wait for explicit
  `yes`.
- Never write to `~/.aws/credentials` or `~/.aws/config`. If the user
  needs new profiles, link them to the AWS CLI docs.

## Examples

```
/cw-set-context
/cw-set-context prod-readonly
/cw-set-context prod-readonly us-east-1
```

## Performance notes

- Don't probe every AWS region — there are 30+ and most accounts use 2–4.
  Default scan is the four common regions; offer a `--scan-all` switch
  for completeness.
- Cache region scan results for 5 min within a session. Region service
  counts don't change minute-to-minute.
