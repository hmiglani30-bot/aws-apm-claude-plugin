// action_form — interactive prefilled form for Tier-4 write actions.
//
// Data shape (matches widget-catalog 1.9, plus a CLI command block):
//   {
//     action_id, label, description?, mcp_tool?, tier?, blast_radius?,
//     reversible?, rollback_plan?, side_effect_detection?,
//     fields: [
//       { key, label, type ("text"|"number"|"select"|"textarea"),
//         value, source?, required?, help?, unit?,
//         options?: [{value, label}],            // select
//         validation?: { pattern?, max_length?, min?, max?, step? } }
//     ],
//     context?: { region?, account?, service?, environment? },
//     deep_link?, deep_link_label?,
//     cli_command?, cli_label?,
//     safety_note?
//   }
//
// The form has no action attribute. It is a static prefilled view of the
// proposed write — users review the fields, copy the CLI block, or follow
// the deep link to apply the change in the AWS console. The renderer never
// submits this form. (See ACTION-SAFETY-MODEL.md — Tier 3 is the default
// disposition; Tier 4 requires an explicit chat confirmation flow that
// happens outside the rendered HTML.)

import { esc } from "./_util.js";

export const density = 3;

let formUid = 0;

function renderField(field, formId) {
  const fieldId = `${formId}-${esc(field.key || "f")}`;
  const required = field.required ? "required" : "";
  const reqMark = field.required ? `<span class="af-required" aria-hidden="true">*</span>` : "";
  const help = field.help
    ? `<div class="af-field-help">${esc(field.help)}</div>`
    : "";
  const source = field.source
    ? `<div class="af-field-source"><span class="af-source-label">Recommended</span> · ${esc(field.source)}</div>`
    : "";
  const v = field.validation || {};

  let control;
  if (field.type === "select") {
    const opts = Array.isArray(field.options) ? field.options : [];
    const optionsHtml = opts.map(o => {
      const ov = o && (o.value !== undefined ? o.value : o);
      const ol = o && (o.label !== undefined ? o.label : ov);
      const sel = String(ov) === String(field.value) ? "selected" : "";
      return `<option value="${esc(ov)}" ${sel}>${esc(ol)}</option>`;
    }).join("");
    control = `<select id="${fieldId}" name="${esc(field.key)}" ${required} class="af-control af-select" data-field-key="${esc(field.key)}">
      ${optionsHtml}
    </select>`;
  } else if (field.type === "textarea") {
    const max = v.max_length ? `maxlength="${Number(v.max_length)}"` : "";
    control = `<textarea id="${fieldId}" name="${esc(field.key)}" ${required} ${max} rows="3" class="af-control af-textarea" data-field-key="${esc(field.key)}">${esc(field.value ?? "")}</textarea>`;
  } else {
    const inputType = field.type === "number" ? "number" : "text";
    const attrs = [
      v.pattern ? `pattern="${esc(v.pattern)}"` : "",
      v.max_length ? `maxlength="${Number(v.max_length)}"` : "",
      v.min !== undefined ? `min="${Number(v.min)}"` : "",
      v.max !== undefined ? `max="${Number(v.max)}"` : "",
      v.step !== undefined ? `step="${Number(v.step)}"` : "",
    ].filter(Boolean).join(" ");
    control = `<input type="${inputType}" id="${fieldId}" name="${esc(field.key)}"
      value="${esc(field.value ?? "")}" ${required} ${attrs}
      class="af-control af-input" data-field-key="${esc(field.key)}" />`;
  }

  const unit = field.unit ? `<span class="af-field-unit">${esc(field.unit)}</span>` : "";

  return `<div class="af-field">
    <label for="${fieldId}" class="af-field-label">
      ${esc(field.label || field.key)} ${reqMark}
    </label>
    <div class="af-field-control">${control}${unit}</div>
    ${source}
    ${help}
  </div>`;
}

function renderTierBadge(tier) {
  if (tier === undefined || tier === null) return "";
  const label = `Tier ${esc(String(tier))}`;
  const cls = tier === 5 ? "af-tier-5" : tier === 4 ? "af-tier-4" : "af-tier-low";
  return `<span class="af-tier-badge ${cls}" title="See ACTION-SAFETY-MODEL.md">${label}</span>`;
}

function renderContext(ctx) {
  if (!ctx) return "";
  const parts = [];
  if (ctx.account)     parts.push(`<span class="af-ctx-item"><span class="af-ctx-lbl">Account</span><code>${esc(ctx.account)}</code></span>`);
  if (ctx.region)      parts.push(`<span class="af-ctx-item"><span class="af-ctx-lbl">Region</span><code>${esc(ctx.region)}</code></span>`);
  if (ctx.service)     parts.push(`<span class="af-ctx-item"><span class="af-ctx-lbl">Service</span><code>${esc(ctx.service)}</code></span>`);
  if (ctx.environment) parts.push(`<span class="af-ctx-item"><span class="af-ctx-lbl">Env</span><code>${esc(ctx.environment)}</code></span>`);
  if (!parts.length) return "";
  return `<div class="af-context">${parts.join("")}</div>`;
}

function renderSafetyBlock(data) {
  const tier = renderTierBadge(data.tier);
  const meta = [];
  if (data.blast_radius)        meta.push(`<span><span class="af-meta-lbl">Blast radius</span> ${esc(data.blast_radius)}</span>`);
  if (data.reversible !== undefined) meta.push(`<span><span class="af-meta-lbl">Reversible</span> ${data.reversible ? "yes" : "no"}</span>`);
  if (data.mcp_tool)            meta.push(`<span><span class="af-meta-lbl">MCP tool</span> <code>${esc(data.mcp_tool)}</code></span>`);
  if (!tier && !meta.length && !data.safety_note) return "";

  const rollback = data.rollback_plan
    ? `<div class="af-safety-row"><span class="af-meta-lbl">Rollback</span> ${esc(data.rollback_plan)}</div>`
    : "";
  const side = data.side_effect_detection
    ? `<div class="af-safety-row"><span class="af-meta-lbl">Detect side effects</span> ${esc(data.side_effect_detection)}</div>`
    : "";
  const note = data.safety_note
    ? `<div class="af-safety-note">${esc(data.safety_note)}</div>`
    : "";

  return `<div class="af-safety">
    <div class="af-safety-header">${tier}${meta.length ? `<div class="af-safety-meta">${meta.join("")}</div>` : ""}</div>
    ${rollback}
    ${side}
    ${note}
  </div>`;
}

function renderCli(data, formId) {
  if (!data.cli_command) return "";
  const label = esc(data.cli_label || "Copy CLI command");
  const cliId = `${formId}-cli`;
  return `<div class="af-cli">
    <div class="af-cli-header">
      <span>${label}</span>
      <button type="button" class="af-copy-btn" data-copy-target="${cliId}" aria-label="Copy command to clipboard">Copy</button>
    </div>
    <pre id="${cliId}" class="af-cli-block"><code>${esc(data.cli_command)}</code></pre>
  </div>`;
}

function renderActions(data) {
  const items = [];
  if (data.deep_link) {
    items.push(`<a class="af-btn af-btn-primary" href="${esc(data.deep_link)}" target="_blank" rel="noreferrer noopener">${esc(data.deep_link_label || "Open in CloudWatch console")}</a>`);
  }
  // Form is non-submitting by design; reset button restores the prefilled values.
  items.push(`<button type="reset" class="af-btn af-btn-secondary">Reset to recommended</button>`);
  return `<div class="af-actions">${items.join("")}</div>`;
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "primary";
  const formId = `af-${++formUid}-${Math.random().toString(36).slice(2, 7)}`;
  const fields = Array.isArray(data.fields) ? data.fields : [];

  const intro = data.description
    ? `<p class="af-description">${esc(data.description)}</p>`
    : "";

  const fieldsHtml = fields.length
    ? fields.map(f => renderField(f, formId)).join("")
    : `<div class="af-empty">No fields supplied.</div>`;

  return `<div class="widget widget-action-form emph-${esc(emphasis)}" data-action-id="${esc(data.action_id || "")}">
  <div class="widget-header">
    <span>${esc(data.label || "Action")}</span>
    ${data.action_id ? `<span class="widget-meta"><code>${esc(data.action_id)}</code></span>` : ""}
  </div>
  <div class="af-body">
    ${intro}
    ${renderContext(data.context)}
    ${renderSafetyBlock(data)}
    <form id="${formId}" class="af-form" novalidate onsubmit="return false;">
      <fieldset class="af-fields">
        <legend class="af-legend">Configuration</legend>
        ${fieldsHtml}
      </fieldset>
      ${renderActions(data)}
    </form>
    ${renderCli(data, formId)}
  </div>
</div>`;
}
