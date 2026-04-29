import { esc } from "./_util.js";

export const density = 1;

function kindIcon(kind) {
  switch (kind) {
    case "deploy": return "↗";
    case "config": return "⚙";
    case "iam": return "🔑";
    case "infra": return "🛠";
    default: return "•";
  }
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "tertiary";
  const events = Array.isArray(data.events) ? data.events : [];

  const items = events.length === 0
    ? `<li class="change-empty">No change events in window.</li>`
    : events.map(ev => `<li class="change-item kind-${esc(ev.kind || "other")}">
        <span class="change-kind" aria-hidden="true">${kindIcon(ev.kind)}</span>
        <div class="change-body">
          <div class="change-row">
            <span class="change-time">${esc(ev.timestamp)}</span>
            <span class="change-title">${esc(ev.title)}</span>
          </div>
          <div class="change-meta">
            ${ev.principal ? `<span class="change-principal">${esc(ev.principal)}</span>` : ""}
            ${ev.resource ? `<span class="change-resource"><code>${esc(ev.resource)}</code></span>` : ""}
            ${ev.link ? `<a class="change-link" href="${esc(ev.link)}" target="_blank" rel="noreferrer noopener">CloudTrail →</a>` : ""}
          </div>
        </div>
      </li>`).join("");

  return `<div class="widget widget-change-events emph-${esc(emphasis)}">
  <div class="widget-header"><span>${esc(data.label || "Recent changes")}</span></div>
  <ul class="change-list">${items}</ul>
</div>`;
}
