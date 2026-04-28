#!/usr/bin/env bash
# Confirmation gate for AWS write actions invoked through the awslabs MCP servers.
#
# Reads the PreToolUse hook payload from stdin (JSON), inspects the tool name and
# arguments, and:
#   - if the env var AWS_APM_AUTO_APPROVE_WRITES=1 is set, allows the call (intended
#     for CI / scripted runs only — never default)
#   - otherwise prints a structured warning to stderr describing the action so the
#     model surfaces it in chat for explicit user approval, and exits with a non-zero
#     status to block the call until the model re-issues it inside an approved context.
#
# Per scope doc Q14: idempotent reversible write actions are allowed via MCP *with* a
# confirmation gate; destructive / billing-impacting actions should deep-link to the
# AWS console instead. This script enforces the gate; the model enforces the deep-link
# rule via the open-in-cloudwatch skill.
#
# Fail CLOSED on parse / read errors (exit 2) — never let a write through silently
# just because we could not parse the payload. The matcher only routes write-shaped
# tool names to this script, so any payload reaching us is presumptively a write
# and must require confirmation even if we can't extract the tool name to display.

set -u

if ! payload="$(cat)"; then
  cat >&2 <<'EOF'
🛑 AWS APM plugin — write-action confirmation gate

Could not read the tool-call payload from stdin. Failing closed: the call is
blocked. Re-issue it after explicit user approval, or set
AWS_APM_AUTO_APPROVE_WRITES=1 for CI / scripted runs only.
EOF
  exit 2
fi

if [[ "${AWS_APM_AUTO_APPROVE_WRITES:-0}" == "1" ]]; then
  exit 0
fi

# Best-effort tool name extraction without requiring jq. The hook payload is JSON of
# the form {"tool_name": "...", "tool_input": {...}}.
tool_name="$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

if [[ -z "$tool_name" ]]; then
  cat >&2 <<'EOF'
🛑 AWS APM plugin — write-action confirmation gate

Could not parse `tool_name` from the hook payload. Failing closed: the matcher
routed this call to the write-confirmation gate, so it is presumptively a write
action. The call is blocked.

To proceed, the model must:
  1. Show the user the exact action and arguments
  2. Wait for "yes" / "confirmed" / explicit approval in chat
  3. Re-issue the call in an approved context (or set AWS_APM_AUTO_APPROVE_WRITES=1
     for CI / scripted runs only)
EOF
  exit 2
fi

cat >&2 <<EOF
🛑 AWS APM plugin — write-action confirmation gate

The model attempted to call: $tool_name

This is a write action against AWS. Per the AWS APM plugin's action-safety policy,
write actions require explicit user approval *and* an exact-diff preview before
execution.

To proceed, the model must:
  1. Show the user the exact action and arguments
  2. Wait for "yes" / "confirmed" / explicit approval in chat
  3. Re-issue the call in an approved context (or set AWS_APM_AUTO_APPROVE_WRITES=1 for
     CI / scripted runs only)

For destructive or billing-impacting actions (delete log group, change retention,
modify IAM), prefer deep-linking to the AWS console via the open-in-cloudwatch skill
rather than executing through MCP.
EOF

exit 2
