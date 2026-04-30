// engine.js — pure-function rendering engine.
// manifest in -> HTML out. No DOM access, no globals, no LLM in the loop.

import { widgets as widgetRegistry } from "./widgets/index.js";
import { getShell, FALLBACK_SHELL } from "./shells/index.js";
import { esc } from "./widgets/_util.js";

// ----------------------------------------------------------------------------
// Validation. Lightweight, hand-rolled — checks the shape we depend on at
// render time. For full JSON-Schema validation, plug ajv in here later.
// ----------------------------------------------------------------------------

const ALLOWED_TYPES = new Set([
  "stat_card", "sparkline", "timeline", "table",
  "trace_waterfall", "log_viewer", "change_event_list",
  "action_form",
]);
const ALLOWED_SEVERITY = new Set(["critical", "warning", "info"]);

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors: ["manifest is not an object"] };
  }
  if (manifest.version !== "1.0") {
    errors.push(`unsupported manifest.version (got ${JSON.stringify(manifest.version)}, expected "1.0")`);
  }
  if (!manifest.metadata || typeof manifest.metadata !== "object") {
    errors.push("manifest.metadata missing");
  } else {
    if (!manifest.metadata.title) errors.push("metadata.title required");
    if (!ALLOWED_SEVERITY.has(manifest.metadata.severity)) errors.push(`metadata.severity must be one of ${[...ALLOWED_SEVERITY].join("|")}`);
    if (!manifest.metadata.query_intent) errors.push("metadata.query_intent required");
  }
  if (!Array.isArray(manifest.widgets) || manifest.widgets.length === 0) {
    errors.push("manifest.widgets must be a non-empty array");
  } else {
    manifest.widgets.forEach((w, i) => {
      if (!w || typeof w !== "object") { errors.push(`widgets[${i}] not an object`); return; }
      if (!ALLOWED_TYPES.has(w.type)) errors.push(`widgets[${i}].type "${w.type}" not in catalog`);
      if (typeof w.priority !== "number") errors.push(`widgets[${i}].priority must be a number`);
      if (!w.data || typeof w.data !== "object") errors.push(`widgets[${i}].data must be an object`);
    });
  }
  return { ok: errors.length === 0, errors };
}

// ----------------------------------------------------------------------------
// Shell inference.
// ----------------------------------------------------------------------------

const DENSITY_BY_TYPE = Object.fromEntries(
  Object.entries(widgetRegistry).map(([k, mod]) => [k, mod.density])
);

const SHELL_BUDGETS = {
  "single-focus": 6,
  "investigation": 8,
  "dashboard": 10,
};

const SLOT_CAPACITY = {
  "single-focus": { header: 1, primary: 1 },
  "investigation": { header: 1, primary: 2, context: 3 },
  "dashboard":     { header: 1, grid: 6 },
};

export function inferShell(widgets) {
  const densities = widgets.map(w => DENSITY_BY_TYPE[w.type] ?? 2);
  const hasDense = densities.some(d => d >= 3);
  const allLight = densities.every(d => d === 1);
  // If any widget is density-3 OR the manifest is tiny (≤2 widgets), single-focus.
  if (hasDense || widgets.length <= 2) return "single-focus";
  // Pure low-density and ≥3 widgets -> dashboard grid.
  if (allLight && widgets.length >= 3) return "dashboard";
  // Default: investigation (mixed densities, supporting context).
  return "investigation";
}

// ----------------------------------------------------------------------------
// Layout: place sorted widgets into the shell's slots, respecting density budget.
// ----------------------------------------------------------------------------

function pickHeaderIndex(sorted) {
  // Prefer the highest-priority stat_card/sparkline as the header. Fall back
  // to the first widget if no light header candidate exists.
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].type;
    if (t === "stat_card" || t === "sparkline") return i;
  }
  return 0;
}

export function planLayout(manifest) {
  const shell = inferShell(manifest.widgets);
  const budget = SHELL_BUDGETS[shell];
  const capacity = SLOT_CAPACITY[shell];

  const sorted = [...manifest.widgets].sort((a, b) => a.priority - b.priority);

  // Header gets one widget, taken out of the priority queue.
  const headerIdx = pickHeaderIndex(sorted);
  const header = sorted[headerIdx];
  const remaining = sorted.filter((_, i) => i !== headerIdx);

  const slots = { header: header ? [header] : [] };
  let densityUsed = header ? (DENSITY_BY_TYPE[header.type] ?? 2) : 0;

  const slotOrder = shell === "dashboard"
    ? ["grid"]
    : shell === "single-focus"
      ? ["primary"]
      : ["primary", "context"];

  for (const slot of slotOrder) slots[slot] = [];

  const drawer = [];

  for (const w of remaining) {
    const cost = DENSITY_BY_TYPE[w.type] ?? 2;
    const slotName = slotOrder.find(s => slots[s].length < (capacity[s] ?? Infinity));
    if (!slotName || densityUsed + cost > budget) {
      drawer.push(w);
      continue;
    }
    slots[slotName].push(w);
    densityUsed += cost;
  }

  return { shell, slots, drawer, densityUsed, budget };
}

// ----------------------------------------------------------------------------
// Render: take a layout plan and produce the final HTML string.
// ----------------------------------------------------------------------------

function renderWidget(w) {
  const mod = widgetRegistry[w.type];
  if (!mod) return `<div class="widget widget-error">Unknown widget type: ${esc(w.type)}</div>`;
  try {
    return mod.render(w.data, w.display_hints || {});
  } catch (err) {
    return `<div class="widget widget-error">Widget "${esc(w.type)}" failed to render: ${esc(err.message)}</div>`;
  }
}

function renderSlot(items) {
  return items.map(renderWidget).join("\n");
}

function renderDrawer(items) {
  if (!items.length) return "";
  const body = items.map(renderWidget).join("\n");
  return `<details class="hr-drawer" data-slot="drawer">
  <summary class="hr-drawer-summary">
    <span class="hr-drawer-label">Show ${items.length} more ${items.length === 1 ? "widget" : "widgets"}</span>
    <span class="hr-drawer-chevron" aria-hidden="true">▾</span>
  </summary>
  <div class="hr-drawer-body">${body}</div>
</details>`;
}

let titleUid = 0;

function renderShellHeader(meta, titleId) {
  const sevClass = `sev-${meta.severity || "info"}`;
  const sub = [meta.service, meta.region, meta.environment].filter(Boolean).map(esc).join(" · ");
  return `<div class="hr-meta-bar ${sevClass}">
  <div class="hr-meta-titles">
    <h1 class="hr-title" id="${titleId}">${esc(meta.title || "Untitled")}</h1>
    ${meta.subtitle ? `<div class="hr-subtitle">${esc(meta.subtitle)}</div>` : ""}
  </div>
  <div class="hr-meta-tags">
    <span class="hr-sev-badge ${sevClass}" aria-label="Severity: ${esc(meta.severity || "info")}">${esc(meta.severity || "info")}</span>
    ${sub ? `<span class="hr-meta-context">${sub}</span>` : ""}
    ${meta.generated_at ? `<span class="hr-meta-time">${esc(meta.generated_at)}</span>` : ""}
  </div>
</div>`;
}

function fillShell(shellName, slots, drawerHtml) {
  let template;
  try {
    template = getShell(shellName);
  } catch {
    template = FALLBACK_SHELL;
  }
  // Replace named slot placeholders. Any placeholder we don't have content for
  // becomes empty. Drawer is independent (it's a named placeholder too).
  return template
    .replace("{{HEADER}}", renderSlot(slots.header || []))
    .replace("{{PRIMARY}}", renderSlot(slots.primary || []))
    .replace("{{CONTEXT}}", renderSlot(slots.context || []))
    .replace("{{GRID}}", renderSlot(slots.grid || []))
    .replace("{{DRAWER}}", drawerHtml);
}

// ----------------------------------------------------------------------------
// Fallback. Renderer must NEVER throw at the top level — invalid manifests
// produce a degraded but correct artifact instead of breaking the host panel.
// ----------------------------------------------------------------------------

function renderFallback(manifest, errors) {
  const meta = (manifest && manifest.metadata) || {};
  const widgets = (manifest && Array.isArray(manifest.widgets)) ? manifest.widgets : [];

  const rawTable = {
    label: "Raw widget payloads (validation failed)",
    columns: [
      { key: "type", label: "Type", kind: "code" },
      { key: "priority", label: "Priority", kind: "number", align: "right" },
      { key: "summary", label: "Data summary", kind: "text" },
    ],
    rows: widgets.map(w => ({
      type: w && w.type,
      priority: w && w.priority,
      summary: (() => {
        try { return JSON.stringify(w && w.data || {}).slice(0, 200); }
        catch { return "<unserializable>"; }
      })(),
    })),
    searchable: false,
    sortable: true,
    empty_message: "No widgets in manifest.",
  };

  const errorList = {
    events: errors.map(msg => ({ timestamp: "validation", title: msg, severity: "critical" })),
    label: "Validation errors",
  };

  const fallbackManifest = {
    version: "1.0",
    metadata: {
      title: meta.title || "Manifest invalid — degraded view",
      severity: "warning",
      query_intent: "fallback",
      subtitle: "Renderer received an invalid manifest. Showing raw widget data as a table.",
    },
    widgets: [
      { type: "timeline", priority: 1, data: errorList },
      { type: "table", priority: 2, data: rawTable },
    ],
  };

  // Single recursive call with a known-valid manifest — guaranteed to take the
  // happy path and not loop.
  return renderToHtml(fallbackManifest, { __isFallback: true });
}

// ----------------------------------------------------------------------------
// Public entry. The shells module must already be loaded.
// ----------------------------------------------------------------------------

export function renderToHtml(manifest, opts = {}) {
  const v = validateManifest(manifest);
  if (!v.ok && !opts.__isFallback) {
    return renderFallback(manifest, v.errors);
  }
  const plan = planLayout(manifest);
  const drawerHtml = renderDrawer(plan.drawer);
  const shellHtml = fillShell(plan.shell, plan.slots, drawerHtml);
  const titleId = `hr-title-${++titleUid}`;
  const metaBar = renderShellHeader(manifest.metadata, titleId);
  const overflowNote = plan.drawer.length
    ? `<div class="hr-overflow-note">${plan.drawer.length} additional ${plan.drawer.length === 1 ? "widget" : "widgets"} hidden in detail drawer below.</div>`
    : "";
  return `<article class="hr-artifact" data-shell="${esc(plan.shell)}" data-density="${plan.densityUsed}/${plan.budget}" aria-labelledby="${titleId}">
  ${metaBar}
  ${overflowNote}
  ${shellHtml}
</article>`;
}
