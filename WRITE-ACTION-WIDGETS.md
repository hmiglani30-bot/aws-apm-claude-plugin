# Write Action Widgets — `action_form` Spec

Design spec for the `action_form` widget type: interactive write-workflow forms
rendered inside MCP-UI templates, grounded in the existing plugin architecture.

## 1. Which write actions to support

### Source of truth: ACTION-SAFETY-MODEL.md Tier 4

Tier 4 defines "MCP-executable with explicit approval" actions. The PreToolUse
hook (`hooks/scripts/confirm-write.sh`) gates every call whose tool name matches
the regex in `hooks/hooks.json`:

```
mcp__awslabs__.*__(Put|Update|Delete|Modify|Create|Remove|Disable|Enable|Attach|Detach|Tag|Untag|Set|Batch|Send|Publish|Invoke|Execute|Run|Associate|Disassociate|Register|Deregister|Restore|Reboot|Terminate|Start|Stop).*
```

However, Tier 5 (disallowed) carves out destructive actions that must never
execute via MCP regardless of hook approval: `Delete*` log groups, lowering
retention, any IAM mutation, `DeleteAlarm`, `DeleteSlo`, `DeleteCanary`,
`DeleteDashboard`, and billing-impacting changes.

The intersection of "Tier 4 allowed" and "actually useful for write workflows"
yields these actions:

| Action | MCP Tool Name (inferred) | MCP Server | Existing Skill | Tier |
|---|---|---|---|---|
| Create metric alarm | `mcp__awslabs__cloudwatch_mcp_server__PutMetricAlarm` | `awslabs.cloudwatch-mcp-server` | `alerting-design` (recommends, never executes), `alarm-response` (proposes with structured approval block) | 4 |
| Tag a resource | `mcp__awslabs__cloudwatch_mcp_server__TagResource` | `awslabs.cloudwatch-mcp-server` | None explicitly; SECURITY.md lists it as optional write | 4 |
| Start a Logs Insights query | `mcp__awslabs__cloudwatch_mcp_server__StartQuery` | `awslabs.cloudwatch-mcp-server` | All investigation skills (but treated as Tier 1 read in practice) | 4* |

*Note: `StartQuery` matches the hook regex (`Start*`) but is functionally a
read operation. The hook gates it; the model re-issues it without the structured
approval block. This is a known design tension noted in ACTION-SAFETY-MODEL.md
("the matcher catches it").*

### Actions NOT in MCP-TOOL-CONTRACTS.md

The following write actions are referenced in skills but **do not have formal
contracts** in MCP-TOOL-CONTRACTS.md. The contracts file documents only read
contracts. If `action_form` is to support these, contracts must be added first:

| Action | Why no contract | Recommendation |
|---|---|---|
| `PutMetricAlarm` (create-only) | MCP-TOOL-CONTRACTS.md is read-only; SECURITY.md lists the IAM permission | Add a write contract section |
| `TagResource` | Same — IAM listed but no contract | Add a write contract section |
| `CreateServiceLevelObjective` | Not mentioned anywhere in the repo as MCP-executable | Requires new MCP capability; defer |
| `EnableTopologyDiscovery` / Enable App Signals | Not in any MCP server's documented tools | Requires new MCP capability; defer |

### Recommended `action_form` scope (v1)

Support **two** write actions in v1, both already gated by the existing
PreToolUse hook and both with IAM permissions documented in SECURITY.md:

1. **Create Metric Alarm** (`PutMetricAlarm`) — the highest-value action;
   `alerting-design` already produces the full alarm specification
2. **Tag Resource** (`TagResource`) — low-risk, idempotent, reversible

Defer to v2:
- Create SLO (requires Application Signals MCP write support)
- Enable Application Signals (requires new MCP capability)
- Any Tier 5 action (always console deep-link via `open-in-cloudwatch`)

---

## 2. `action_form` widget design

### 2.1 What it is

`action_form` is a new widget type in the existing widget registry
(`ui-server/components/runtime.jsx` `WIDGETS` map). Like `stat_card` and
`table`, it receives a `data` prop and renders Cloudscape components. Unlike
read-only widgets, it has interactive state and triggers an MCP tool call on
submit.

### 2.2 Component hierarchy

```
runtime.jsx
  WIDGETS = {
    stat_card: StatCard,
    table: Table,
+   action_form: ActionForm,    // NEW
  }
```

`ActionForm.jsx` renders:
- A Cloudscape `Form` with `FormField` components for each field
- A `Header` with the action name and a Tier-4 safety badge
- Pre-filled values from investigation context
- A structured approval block (matching the exact format from `alarm-response`
  and `slo-breach-investigation` SKILL.md) shown before the submit button
- Submit / Cancel buttons
- Post-submit status: `pending` | `confirmed` | `executing` | `success` | `error`

### 2.3 Data shape (the manifest node)

When the LLM places an `action_form` in a template slot, it produces a node
with this shape:

```json
{
  "type": "action_form",
  "data": {
    "action_id": "create_metric_alarm",
    "label": "Create Metric Alarm",
    "description": "Create a CloudWatch metric alarm for checkout-api Lambda errors",
    "mcp_tool": "mcp__awslabs__cloudwatch_mcp_server__PutMetricAlarm",
    "tier": 4,
    "blast_radius": "single resource",
    "reversible": true,
    "rollback_plan": "DeleteAlarms with alarm name (console deep-link provided)",
    "side_effect_detection": "Watch alarm state transitions in CloudWatch console",
    "fields": [
      {
        "key": "alarm_name",
        "label": "Alarm Name",
        "type": "text",
        "value": "checkout-api-Lambda-Errors-Sum-Critical",
        "source": "alerting-design recommendation",
        "required": true,
        "validation": { "pattern": "^[a-zA-Z0-9_\\-\\.]+$", "max_length": 255 }
      },
      ...
    ],
    "context": {
      "region": "us-east-2",
      "account": "123456789012",
      "service": "checkout",
      "time_window": { "start": "...", "end": "..." }
    },
    "deep_link": "https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#alarmsV2:alarm/..."
  }
}
```

### 2.4 Lifecycle

```
┌────────────┐     ┌──────────────┐     ┌────────────┐     ┌────────────┐
│  EDITING   │────>│  REVIEWING   │────>│ EXECUTING  │────>│  SUCCESS   │
│            │     │  (approval   │     │            │     │  or ERROR  │
│ form fields│     │   block)     │     │ hook runs  │     │            │
│ editable   │     │ user types   │     │ MCP call   │     │ result     │
│            │     │ CONFIRM ...  │     │ in flight  │     │ displayed  │
└────────────┘     └──────────────┘     └────────────┘     └────────────┘
      ^                   │                                       │
      └───────────────────┘ Cancel                                │
      └───────────────────────────────────────────────────────────┘ Retry (error only)
```

**EDITING**: Form fields are editable. Pre-filled values shown. User reviews
and modifies. Submit button transitions to REVIEWING.

**REVIEWING**: The structured approval block (identical to the one defined in
`alarm-response` and `slo-breach-investigation` SKILL.md) is rendered:

```
  Write action proposed
  - API action: mcp__awslabs.cloudwatch_mcp_server__PutMetricAlarm
  - Target ARN: arn:aws:cloudwatch:us-east-2:123456789012:alarm:checkout-api-...
  - Region / account: us-east-2 / 123456789012
  - Arguments: { ... full JSON ... }
  - Blast radius: single resource
  - Reversible? yes -- DeleteAlarms via console
  - Rollback plan: Delete alarm via console deep-link; verify alarm disappears
  - Side-effect detection: alarm state transitions in CloudWatch console

  Type CONFIRM PutMetricAlarm to proceed. Any other reply cancels.
```

The user must type the exact confirmation phrase in the chat (not in the form).
This is critical: the form does NOT bypass the existing PreToolUse hook flow.
The form collects and validates inputs; the confirmation still goes through
the chat-based approval gate that `confirm-write.sh` enforces.

**EXECUTING**: Spinner shown. The MCP tool call is in flight. The PreToolUse
hook intercepts it, and because the user already confirmed in chat, the model
re-issues the call in an approved context.

**SUCCESS / ERROR**: Result displayed. On success: green StatusIndicator with
the created resource identifier + a console deep-link to verify. On error:
red StatusIndicator with the AWS error message + a retry button.

### 2.5 How submission works (integration with PreToolUse hook)

The `action_form` widget does NOT execute the MCP call directly. It cannot --
the widget runs in an iframe (Cloudscape UI), and MCP calls are issued by the
model through Claude Code's tool-calling mechanism. The flow:

1. User fills the form and clicks "Review & Submit"
2. The widget transitions to REVIEWING and renders the structured approval block
3. The widget emits a message to the parent frame (or the model context)
   containing the assembled tool input JSON
4. The model surfaces the structured approval block in chat (matching the exact
   format from the skill SKILL.md files)
5. The user types `CONFIRM PutMetricAlarm` in chat
6. The model re-issues the MCP call with the form's assembled arguments
7. The PreToolUse hook (`confirm-write.sh`) fires, but because the model is
   now in an "approved context" (the user confirmed), it proceeds
8. The MCP server executes the AWS API call
9. The result propagates back to the widget via the manifest update mechanism

This preserves the existing safety model completely. The form is a UX
convenience for assembling arguments and showing context -- it is not a
bypass of the hook.

---

## 3. Form schemas for supported write actions

### 3.1 Create Metric Alarm (`PutMetricAlarm`)

Source: `alerting-design` SKILL.md Phase 4 recommendation shape + AWS
CloudWatch `PutMetricAlarm` API.

| Field | Label | Type | Pre-fillable? | Source | Required | Validation |
|---|---|---|---|---|---|---|
| `alarm_name` | Alarm Name | text | Yes | `alerting-design` recommendation name convention: `<service>-<resource>-<metric>-<statistic>-<severity>` | Yes | `^[a-zA-Z0-9_\-\.]+$`, max 255 |
| `alarm_description` | Description | textarea | Yes | Generated from investigation context + hypothesis | No | max 1024 |
| `namespace` | Metric Namespace | text | Yes | From `get_active_alarms` output or `alerting-design` recommendation | Yes | AWS namespace format |
| `metric_name` | Metric Name | text | Yes | From investigation context (alarm metric or recommendation) | Yes | non-empty |
| `dimensions` | Dimensions | key-value pairs | Yes | From context provider `context.service` + alarm dimensions | Yes | at least 1 |
| `statistic` | Statistic | select | Yes | From recommendation (`Sum`, `Average`, `p99`, `SampleCount`, `Minimum`, `Maximum`) | Yes | enum |
| `extended_statistic` | Extended Statistic | text | Conditional | Only for percentile stats like `p99`, `p95` | Conditional | `p\d+(\.\d+)?` |
| `period` | Period (seconds) | number | Yes | From recommendation (typically 60, 300) | Yes | multiple of 60, min 10 |
| `evaluation_periods` | Evaluation Periods | number | Yes | From recommendation | Yes | 1-max |
| `datapoints_to_alarm` | Datapoints to Alarm | number | Yes | From recommendation | Yes | <= evaluation_periods |
| `threshold` | Threshold | number | Yes | From recommendation (baseline-derived) | Yes | numeric |
| `comparison_operator` | Comparison | select | Yes | `GreaterThanThreshold`, `LessThanThreshold`, `GreaterThanOrEqualToThreshold`, `LessThanOrEqualToThreshold` | Yes | enum |
| `treat_missing_data` | Treat Missing Data | select | Yes | From recommendation (`notBreaching`, `breaching`, `missing`, `ignore`) | Yes | enum |
| `alarm_actions` | ALARM Actions (SNS ARNs) | text[] | Partial | If routing plan exists from `alerting-design` Phase 5 | No | ARN format |
| `ok_actions` | OK Actions (SNS ARNs) | text[] | Partial | Same as alarm_actions typically | No | ARN format |
| `insufficient_data_actions` | Insufficient Data Actions | text[] | No | Rarely pre-filled | No | ARN format |
| `tags` | Tags | key-value pairs | Partial | `managed-by: aws-apm-plugin`, service ownership tags | No | key max 128, value max 256 |

**Pre-fill sources from context provider** (ARCHITECTURE.md context shape):

- `context.region` -> used in ARN construction and deep-link generation
- `context.account` -> used in ARN construction and approval block
- `context.service` -> maps to metric dimensions
- `context.alarm` -> if modifying threshold of existing alarm (Tier 3 deep-link preferred)
- `context.time_window` -> used to derive baseline threshold from recent metric data

**Pre-fill sources from skill output**:

- `alerting-design` Phase 4 produces the complete alarm specification:
  name, metric, namespace, dimensions, statistic, period, evaluation_periods,
  datapoints_to_alarm, comparison, threshold, treat_missing_data, actions,
  and IaC snippet. Every field maps 1:1.
- `alarm-response` Phase 5 hypothesis may recommend a new alarm for a gap found
  during investigation.

### 3.2 Tag Resource (`TagResource`)

Source: AWS CloudWatch `TagResource` API.

| Field | Label | Type | Pre-fillable? | Source | Required | Validation |
|---|---|---|---|---|---|---|
| `resource_arn` | Resource ARN | text | Yes | From the alarm/resource under investigation | Yes | ARN format |
| `tags` | Tags | key-value pairs | Partial | Default: `managed-by: aws-apm-plugin` | Yes | at least 1 pair; key max 128, value max 256; max 50 tags |

**Pre-fill sources**:

- `context.service` -> suggested tag `service: <service>`
- `context.environment` -> suggested tag `environment: <environment>`
- Investigation output -> `created-by: aws-apm-plugin`, `investigation-id: <id>`

### 3.3 Create Composite Alarm (future v1.1)

From `alerting-design` Phase 4 composite alarm section. Would use
`PutCompositeAlarm` (same MCP server, same hook pattern). Fields:

| Field | Label | Type | Pre-fillable? | Required |
|---|---|---|---|---|
| `alarm_name` | Composite Alarm Name | text | Yes | Yes |
| `alarm_rule` | Alarm Rule Expression | text | Yes (from recommendation) | Yes |
| `alarm_description` | Description | textarea | Yes | No |
| `alarm_actions` | ALARM Actions | text[] | Partial | No |
| `ok_actions` | OK Actions | text[] | Partial | No |
| `actions_suppressor` | Actions Suppressor ARN | text | Partial | No |

Deferred because `PutCompositeAlarm` is not yet listed in SECURITY.md's
optional write IAM policy.

---

## 4. Integration with existing architecture

### 4.1 Four-layer stack placement

From ARCHITECTURE.md's layered view:

```
Presentation        <- action_form widget lives HERE
  - Renders Cloudscape FormField components
  - Pre-fills from investigation context
  - Assembles tool input JSON
  - Renders structured approval block

Orchestration       <- existing skills drive WHEN to show the form
  - alerting-design produces alarm specs -> feeds action_form data
  - alarm-response proposes remediation -> feeds action_form data
  - PreToolUse hook gates the actual execution
  - Context provider supplies region/account/service/window

Data Access (MCP)   <- the form's submit target
  - awslabs.cloudwatch-mcp-server exposes PutMetricAlarm, TagResource
  - MCP-TOOL-CONTRACTS.md governs the input/output shape (write contracts TBD)

System of Record    <- CloudWatch receives the write
  - The alarm/tag is created in the user's AWS account
  - CloudTrail logs the write (audit trail)
```

The `action_form` is purely Presentation. It does not call MCP tools itself
and does not bypass any Orchestration-layer safety checks. It assembles
parameters and hands them to the model, which runs through the normal
Orchestration flow (hook gating, confirmation, re-issue).

### 4.2 Template system integration

**New `allowedType`**: `action_form` is added to the widget registry alongside
`stat_card` and `table`.

Template slot updates:

```json
// stacked.json - action forms go in the components slot
{
  "id": "stacked",
  "slots": {
    "components": { "maxComponents": 3, "allowedTypes": ["*"] }
  }
}

// grid.json - action forms go in the primary slot (below cards)
{
  "id": "grid",
  "slots": {
    "cards": { "maxComponents": 6, "allowedTypes": ["stat_card"] },
    "primary": { "maxComponents": 1, "allowedTypes": ["table", "timeline", "chart", "action_form"] }
  }
}

// single.json - action form can be the sole component
{
  "id": "single",
  "slots": {
    "primary": { "maxComponents": 1, "allowedTypes": ["*"] }
  }
}
```

Since `stacked.json` and `single.json` already use `"allowedTypes": ["*"]`,
`action_form` is permitted in those slots with no schema change. Only
`grid.json` needs an explicit addition if the wildcard is tightened later.

**New template for mixed read+write layouts** (see section 5):

```json
{
  "id": "investigation_with_actions",
  "layout": "SpaceBetween + Divider",
  "description": "Investigation results above, action forms below a visual divider. For workflows that diagnose then offer remediation.",
  "slots": {
    "diagnostic": { "maxComponents": 4, "allowedTypes": ["stat_card", "table", "chart", "timeline"] },
    "actions": { "maxComponents": 2, "allowedTypes": ["action_form"] }
  }
}
```

### 4.3 Action safety model integration

The `action_form` operates within Tier 4 exclusively. The integration points:

| Safety layer | How `action_form` integrates |
|---|---|
| **Tier classification** | The form's `data.tier` field is always `4`. The widget refuses to render if `tier` is `5` or missing. |
| **PreToolUse hook** | The form does not bypass the hook. The model issues the MCP call after the user confirms in chat, and `confirm-write.sh` intercepts it normally. |
| **Structured approval block** | The form renders the exact approval block format defined in `alarm-response` SKILL.md (API action, Target ARN, Region/account, Arguments, Blast radius, Reversible?, Rollback plan, Side-effect detection, confirmation phrase). No paraphrasing. |
| **Confirmation in chat** | The user types `CONFIRM <ToolName>` in the chat interface, not in the form widget. The form shows a prompt to do this. |
| **Tier 5 filtering** | If the assembled action matches a Tier 5 pattern (Delete log group, IAM mutation, etc.), the form refuses to render and shows a deep-link via `open-in-cloudwatch` instead. |
| **Deep-link fallback** | Every `action_form` includes a `data.deep_link` field (console URL from `open-in-cloudwatch` skill). The user can always click through to the console instead of using MCP execution. |

### 4.4 Existing skill integration

| Skill | Relationship to `action_form` |
|---|---|
| **`alerting-design`** | Phase 4 produces the complete alarm specification. This is the primary data source for the `create_metric_alarm` form. Today the skill renders IaC snippets + console deep links; with `action_form`, it can additionally render a pre-filled form. The skill's own rule ("Does not modify alarms") is preserved because the form only assembles data; execution requires chat confirmation. |
| **`alarm-response`** | Phase 5 may recommend a new alarm (e.g., "add a latency alarm for this operation"). The structured approval block format is already defined here. The `action_form` renders this block visually instead of as raw text. |
| **`slo-breach-investigation`** | Same structured approval block. If a remediation involves creating a burn-rate alarm, the form can be pre-filled from the SLO breach context (burn rate thresholds, service dimensions). |
| **`open-in-cloudwatch`** | Provides the `deep_link` field for every `action_form`. The form always shows "Or open in CloudWatch console" as an alternative. URL templates from this skill are used directly. |

---

## 5. Read-only vs. action separation in templates

### 5.1 Problem

Today, all widgets are read-only (`stat_card`, `table`). Adding `action_form`
creates a visual and conceptual split: diagnostic output (what happened) vs.
remediation forms (what to do about it). Mixing them without separation creates
cognitive risk: the user might think they are still reading when they are
actually about to write.

### 5.2 Design: visual separation

**Within a single template**: Use a `Divider` component + a section header to
create a clear boundary:

```
┌─────────────────────────────────────────────────────┐
│  DIAGNOSTIC SECTION                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ StatCard │ │ StatCard │ │ StatCard │  (grid)     │
│  │ p99: 340 │ │ err: 4.2%│ │ rate: 1k │             │
│  └──────────┘ └──────────┘ └──────────┘             │
│  ┌──────────────────────────────────────┐            │
│  │ Table: Top contributing operations   │            │
│  │ ...                                  │            │
│  └──────────────────────────────────────┘            │
│                                                      │
│  ── Recommended Actions ─────────────────────────── │
│                                                      │
│  ACTION SECTION                                      │
│  ┌──────────────────────────────────────┐            │
│  │ action_form: Create Metric Alarm     │ Tier 4    │
│  │                                      │ badge     │
│  │ [Alarm Name: checkout-api-...-Crit ] │            │
│  │ [Namespace: AWS/Lambda             ] │            │
│  │ [Threshold: 5                      ] │            │
│  │ ...                                  │            │
│  │ [Review & Submit]  [Open in Console] │            │
│  └──────────────────────────────────────┘            │
└─────────────────────────────────────────────────────┘
```

### 5.3 Visual cues on the `action_form` widget

1. **Tier badge**: A Cloudscape `Badge` in the header showing "Tier 4 -- Requires approval" in amber. Uses the existing `Badge` component pattern from `StatCard.jsx`.

2. **Border treatment**: The `action_form` Container uses a left border accent in `var(--aws-apm-amber)` (the amber/warning color from `tokens.js`: `#FFA552`) to visually distinguish it from read-only containers.

3. **Header icon**: A shield/lock icon prefix on the form header to signal "this will write to AWS."

4. **Console alternative**: Every form shows a secondary link "Or configure in CloudWatch console" using the `deep_link` from `open-in-cloudwatch`, styled as a Cloudscape `Link` with `variant="secondary"`.

5. **Pre-fill provenance**: Each pre-filled field shows a small annotation (e.g., "from alerting-design recommendation" or "from investigation context") so the user knows where the value came from and can verify.

### 5.4 The `investigation_with_actions` template

A new template specifically for mixed diagnostic+action layouts:

```jsx
// templates/InvestigationWithActions.jsx
export default function InvestigationWithActions({ title, subtitle, slots, renderComponent }) {
  const diagnosticItems = slots.diagnostic || [];
  const actionItems = slots.actions || [];
  return (
    <SpaceBetween size="l">
      {title && <Header description={subtitle}>{title}</Header>}

      {/* Diagnostic section */}
      {diagnosticItems.map((item, i) => (
        <div key={`diag-${i}`}>{renderComponent(item)}</div>
      ))}

      {/* Visual separator */}
      {actionItems.length > 0 && (
        <>
          <Divider />
          <Header variant="h2">Recommended Actions</Header>
          <Box variant="p" color="text-status-warning">
            Actions below will modify your AWS account. Each requires explicit
            confirmation before execution.
          </Box>
        </>
      )}

      {/* Action section */}
      {actionItems.map((item, i) => (
        <div key={`action-${i}`}>{renderComponent(item)}</div>
      ))}
    </SpaceBetween>
  );
}
```

Template schema:

```json
{
  "id": "investigation_with_actions",
  "layout": "SpaceBetween + Divider",
  "description": "Investigation results above, action forms below a visual divider. For workflows that diagnose then offer remediation.",
  "slots": {
    "diagnostic": {
      "maxComponents": 4,
      "allowedTypes": ["stat_card", "table", "chart", "timeline"]
    },
    "actions": {
      "maxComponents": 2,
      "allowedTypes": ["action_form"]
    }
  }
}
```

Register in `runtime.jsx`:

```js
const TEMPLATES = {
  single: Single,
  stacked: Stacked,
  grid: GridTemplate,
+ investigation_with_actions: InvestigationWithActions,
};
```

### 5.5 When to use which template

| Scenario | Template | Why |
|---|---|---|
| Pure investigation (alarm-response, SLO breach) | `grid` or `stacked` | Read-only output; no action forms |
| Investigation + user asks "create the alarm now" | `investigation_with_actions` | Diagnostic widgets in `diagnostic` slot, action form in `actions` slot |
| Pure alerting design plan review | `stacked` | Read-only; IaC snippets + deep links |
| Alerting design + user asks "apply these alarms" | `investigation_with_actions` | Coverage matrix table in `diagnostic`, alarm creation forms in `actions` |
| Quick tag operation | `single` | Just the tag form, no diagnostic context needed |

---

## 6. Implementation checklist

### New files to create

| File | Purpose |
|---|---|
| `ui-server/components/widgets/ActionForm.jsx` | The `action_form` widget component |
| `ui-server/components/templates/InvestigationWithActions.jsx` | The mixed diagnostic+action template |
| `ui-server/templates/investigation_with_actions.json` | Template schema |

### Existing files to modify

| File | Change |
|---|---|
| `ui-server/components/runtime.jsx` | Add `action_form` to `WIDGETS`, add `investigation_with_actions` to `TEMPLATES` |
| `ui-server/templates/grid.json` | Add `action_form` to `primary` slot `allowedTypes` (if wildcard is removed) |
| `MCP-TOOL-CONTRACTS.md` | Add write-action contract sections for `PutMetricAlarm` and `TagResource` |
| `SECURITY.md` | Document IAM requirements for action_form-supported write actions |
| Skills that produce alarm specs (`alerting-design`, `alarm-response`) | Add guidance for when to emit `action_form` widget nodes in the manifest |

### No changes needed

| File | Why |
|---|---|
| `hooks/hooks.json` | The existing PreToolUse regex already matches `Put*`, `Tag*` -- no new patterns needed |
| `hooks/scripts/confirm-write.sh` | The hook is tool-name-based, not widget-aware -- it gates the call regardless of how it was assembled |
| `ARCHITECTURE.md` | The layered model already accounts for this (`Presentation` calls `Data Access` through `Orchestration`) |
| `ACTION-SAFETY-MODEL.md` | Tier 4 already covers MCP-executable writes with approval; `action_form` is a presentation-layer convenience, not a new tier |

---

## 7. Design decisions (resolved)

1. **MCP write contracts**: Add formal write-action contracts to
   MCP-TOOL-CONTRACTS.md for `PutMetricAlarm` and `TagResource` before
   shipping `action_form`. The contracts must document input schema, output
   shape, failure modes, and IAM permissions — matching the rigor of the
   existing read contracts.

2. **Confirmation UX**: Keep typed `CONFIRM <ToolName>` in chat. The typing
   friction is intentional — it matches the existing safety model's design
   intent (deliberate confirmation over click convenience). The form surfaces
   the confirmation phrase prominently but does not auto-send it.

3. **Form state persistence**: No persistence. Form state resets if the user
   navigates away from the artifact. This matches the read-once manifest model
   (`window.__AWS_APM_MANIFEST__`) and avoids introducing a separate
   persistence layer. If the user abandons a form, they re-run the skill to
   get fresh pre-filled values.

4. **Multiple alarms**: One form per alarm, max 2 in the `actions` slot per
   template render. `alerting-design` may recommend 10+ alarms, but the user
   applies high-priority alarms first and re-runs for more. This keeps the
   template clean and the approval flow manageable (one `CONFIRM` per alarm).

5. **Create SLO**: Deferred to v2. `CreateServiceLevelObjective` is the
   second-highest-value write action but no MCP server currently exposes it.
   Top priority for v2 once `awslabs.cloudwatch-applicationsignals-mcp-server`
   adds write support.
