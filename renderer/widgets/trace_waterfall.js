import { esc, fmt } from "./_util.js";

export const density = 3;

function statusToBarClass(status) {
  switch (status) {
    case "error": return "bar-error";
    case "throttled": return "bar-warning";
    default: return "bar-ok";
  }
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "primary";
  const total = Math.max(data.total_duration_ms || 0, 1);
  const spans = Array.isArray(data.spans) ? data.spans : [];

  const rows = spans.map((s, i) => {
    const startPct = Math.max(0, Math.min(100, (s.start_ms / total) * 100));
    const widthPct = Math.max(0.4, Math.min(100 - startPct, (s.duration_ms / total) * 100));
    const depth = Math.min(s.depth || 0, 8);
    const indent = depth * 14;
    return `<div class="waterfall-row">
      <div class="waterfall-label" style="padding-left: ${indent}px">
        <span class="waterfall-name" title="${esc(s.name)}">${esc(s.name)}</span>
        ${s.service ? `<span class="waterfall-service">${esc(s.service)}</span>` : ""}
      </div>
      <div class="waterfall-track">
        <div class="waterfall-bar ${statusToBarClass(s.status)}"
             style="left: ${startPct.toFixed(2)}%; width: ${widthPct.toFixed(2)}%"
             aria-label="${esc(s.name)} ${fmt(s.duration_ms)}ms"></div>
      </div>
      <div class="waterfall-duration">${fmt(s.duration_ms)} <span class="unit">ms</span></div>
    </div>`;
  }).join("");

  return `<div class="widget widget-waterfall emph-${esc(emphasis)}">
  <div class="widget-header">
    <span>Trace waterfall</span>
    <span class="widget-meta"><code>${esc(data.trace_id)}</code> · ${fmt(total)} ms</span>
  </div>
  <div class="waterfall-grid">
    ${rows || `<div class="empty-row">No spans.</div>`}
  </div>
</div>`;
}
