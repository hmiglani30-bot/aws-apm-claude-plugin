import { esc } from "./_util.js";

export const density = 2;

function sevClass(s) {
  switch (s) {
    case "error": return "log-error";
    case "warn": return "log-warn";
    case "info": return "log-info";
    case "debug": return "log-debug";
    default: return "log-info";
  }
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "secondary";
  const lines = Array.isArray(data.lines) ? data.lines : [];

  const body = lines.length === 0
    ? `<div class="log-empty">No log lines in window.</div>`
    : lines.map(l => `<div class="log-line ${sevClass(l.severity)}">
        <span class="log-ts">${esc(l.timestamp)}</span>
        <span class="log-sev">${esc(l.severity || "info")}</span>
        <span class="log-msg">${esc(l.message)}</span>
      </div>`).join("");

  return `<div class="widget widget-log-viewer emph-${esc(emphasis)}">
  <div class="widget-header">
    <span>${esc(data.label || "Logs")}</span>
    ${data.log_group ? `<span class="widget-meta"><code>${esc(data.log_group)}</code></span>` : ""}
  </div>
  <div class="log-scroll">${body}</div>
</div>`;
}
