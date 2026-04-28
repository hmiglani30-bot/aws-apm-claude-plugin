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
# Fail open on parse errors (exit 0) — never block a read-only call by accident.

set -u

payload="$(cat)" || exit 0

if [[ "${AWS_APM_AUTO_APPROVE_WRITES:-0}" == "1" ]]; then
  exit 0
fi

# Best-effort tool name extraction without requiring jq. The hook payload is JSON of
# the form {"tool_name": "...", "tool_input": {...}}.
tool_name="$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

if [[ -z "$tool_name" ]]; then
  exit 0
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
