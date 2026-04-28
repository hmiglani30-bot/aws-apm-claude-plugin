---
description: Verify a service has recovered after a mitigation — checks SLO burn stopped, p99 returned to baseline, error rate normalized, traces no longer fail at the prior bad span, and alarms recovered to OK
argument-hint: <service-name> [mitigation-time-iso]
allowed-tools:
  - Read
  - Bash
  - Grep
  - "mcp__awslabs.cloudwatch-mcp-server__*"
  - "mcp__awslabs.cloudwatch-applicationsignals-mcp-server__*"
  - "mcp__awslabs.cloudtrail-mcp-server__*"
---

# /cw-verify-recovery

Post-mitigation verification. After the on-call engineer has applied a fix
(rollback, scale-up, config change, dependency restored), this command
confirms the service is genuinely back to baseline — not just "looks
better for 30 seconds." Produces a structured **recovery verdict** with
per-signal pass/fail.

The user invoked this with: `$ARGUMENTS`

## Why this exists

After a mitigation, on-call has to answer two questions:
1. Is the service actually recovered?
2. Can I close the incident and go back to bed?

Eyeballing five graphs is unreliable. This command runs the same five
checks every time, against the same windows, so the answer is reproducible.

## Instructions

1. Parse `$ARGUMENTS`:
   - **First arg** — service name (required).
   - **Second arg** — mitigation timestamp in ISO format. If omitted,
     ask the user for it. Recovery verification needs a `t=0` reference;
     a guess is worse than asking.

2. Frame the windows:
   - **Pre-mitigation** — 30 min before mitigation timestamp (the breach
     state we're recovering from).
   - **Post-mitigation soak** — 15 min after the mitigation. Some signals
     need this long to settle (SLO burn rate, alarm evaluation periods).
   - **Steady-state baseline** — same window 24h ago AND 7 days ago.

3. Run all 5 checks in parallel. Do not stop at the first pass — every
   pass needs to hold for the verdict to be ✅ Recovered.

## The 5 recovery checks

### 1. SLO burn stopped
- For every SLO on this service that was breaching pre-mitigation:
  - Pull burn rate over the 15 min post-mitigation window.
  - Pass = burn rate ≤ 1× normal (i.e. consuming budget at or below the
    target rate).
  - Fail = burn rate still >1× normal.
- If no SLOs were breaching pre-mitigation, mark this check N/A with
  reason "no SLOs were in breach."
- **Note** — error budget *remaining* may still be low even if burn has
  stopped. That's a separate concern (see `slo-compliance-report`); this
  check only verifies the bleeding has stopped.

### 2. p99 returned to baseline
- Pull current p99 (last 5 min) for the worst operation pre-mitigation.
- Pass = current p99 within ±20% of the 24h-ago baseline AND within
  ±20% of the 7d-ago baseline.
- Fail = current p99 still >1.2× either baseline.
- Surface both baselines in the output — a single baseline can lie if
  yesterday was itself a bad day.

### 3. Error rate normalized
- Pull error rate over the post-mitigation 15 min window.
- Pass = error rate within ±20% of the 24h-ago baseline.
- Fail = error rate still >1.2× baseline.
- Distinguish 4xx vs 5xx — a 5xx rate that recovered while 4xx is still
  elevated is a different signal (likely a downstream client now hitting
  validation errors), and the verdict should call that out.

### 4. Traces no longer show the failed / slow span
- Sample 5–10 recent traces (status = ok preferred, but include any) for
  the affected operation.
- Pre-mitigation, the investigation should have identified a "bad span"
  (the failed span where the exception was thrown, or the slow span that
  dominated p99).
- Pass = none of the sampled post-mitigation traces show the bad span
  pattern (same exception class on the same span name, or a duration
  outlier on the same span).
- Fail = bad span pattern still present in any post-mitigation trace.
- N/A = no bad span was identified pre-mitigation (this should be rare —
  if so, recommend re-running the investigation skill before declaring
  recovery).

### 5. Alarm state recovered
- Pull every CloudWatch alarm on this service.
- Pass = every alarm that was in `ALARM` state pre-mitigation is now in
  `OK` state AND has been in `OK` for at least one full evaluation
  period.
- Fail = any alarm still in `ALARM`, or recently transitioned to `OK`
  but has not held through one evaluation period (could be flapping).
- Surface composite alarms with their child state — a recovered child
  doesn't mean a recovered composite if other children are still in
  alarm.

## Verdict line

End with exactly one of:

- ✅ **Recovered** — all 5 checks Pass (or N/A with documented reason).
  Service is back to baseline. Safe to close the incident and stop the
  page.
- 🟠 **Partially recovered** — some checks pass, others still failing.
  List which signals are still degraded and recommend the next step
  (continue mitigation? roll back further? wait one more soak window?).
- 🔴 **Not recovered** — primary metric (SLO burn, p99, or error rate)
  is still in breach. The mitigation did not work or did not fully take
  effect. Recommend re-running the original investigation skill.

## Canonical output layout

```markdown
## ✅ Recovery Verification — `checkout-service`

**Mitigation applied:** 2026-04-28T14:18:00Z (rollback)
**Pre-mitigation window:** 13:48–14:18 UTC
**Post-mitigation soak:** 14:18–14:33 UTC
**As of:** <ISO ts UTC>

| # | Check | Status | Detail |
|---|---|---|---|
| 1 | SLO burn stopped | ✅ | `checkout-availability` burn 0.4× (was 28×) |
| 2 | p99 to baseline | ✅ | 187ms (24h: 192ms, 7d: 178ms) |
| 3 | Error rate normalized | ✅ | 0.08% (24h: 0.07%) — both 4xx and 5xx |
| 4 | Bad span gone | ✅ | 0 of 8 sampled traces show `NullPointerException` |
| 5 | Alarms recovered | ✅ | 3/3 alarms `OK`, all held >1 evaluation period |

---

✅ **Recovered** — all 5 checks passed. Safe to close incident.

> **Source:** Application Signals + CloudWatch
> **Time range:** 13:48–14:33 UTC (mitigation at 14:18)
> **MCP tools called:** `list_slos`, `get_slo`, `get_metric_data`, `search_traces`, `describe_alarms`
> **Confidence:** High — 5/5 multi-source agreement

> Next step: write the postmortem. Use `copy-to-incident` skill for a
> postmortem skeleton.
```

When checks fail, render the row with the failure detail, then a **What
to do next** block with the recommended action (continue mitigation,
roll back further, escalate to dependency owner via `service-ownership`
skill, etc.).

## Edge cases

- **No traffic during soak window** — request rate fell to near-zero
  during the post-mitigation window. Cannot verify recovery from absence
  of errors. Mark check 3 as "Inconclusive — insufficient traffic" and
  recommend re-running after traffic returns. Cap verdict at 🟠 Partial.
- **Mitigation timestamp very recent (<5 min ago)** — soak window is too
  short. Refuse to verdict; tell the user "Wait <N> minutes for soak
  window, then re-run." This is a guard against premature "all clear."
- **Service has no SLOs and no alarms** — checks 1 and 5 are N/A. Can
  still verdict on 2/3/4 alone but cap confidence at Medium and surface
  the gap.
- **Multiple mitigations in the window** — if CloudTrail shows >1
  `Update*` event in the post-mitigation soak, surface that. The verdict
  is now verifying the *combined* effect, not the named one.

## Action safety

Read-only. Every check is a `Get*` / `List*` / `Describe*` call. The
command never proposes a write action. If recovery has not happened, the
recommendation is "re-run investigation" or "wait one soak period," not
an automated re-mitigation.

## Examples

```
/cw-verify-recovery checkout-service 2026-04-28T14:18:00Z
/cw-verify-recovery payment-service
```

## Performance notes

- Run all 5 checks in parallel.
- Cap each at 10s timeout; if any check is slow, surface that as a
  finding (slow telemetry IS a recovery signal — if `GetMetricData` is
  taking 30s, the service is not fully healthy yet).
