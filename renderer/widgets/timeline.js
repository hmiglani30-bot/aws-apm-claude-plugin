import { esc, severityToClass } from "./_util.js";

export const density = 2;

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "secondary";
  const events = Array.isArray(data.events) ? data.events : [];

  const items = events.map(ev => `
    <li class="timeline-item ${severityToClass(ev.severity)}">
      <span class="timeline-dot" aria-hidden="true"></span>
      <div class="timeline-body">
        <div class="timeline-row">
          <span class="timeline-time">${esc(ev.timestamp)}</span>
          <span class="timeline-title">${esc(ev.title)}</span>
        </div>
        ${ev.description ? `<div class="timeline-desc">${esc(ev.description)}</div>` : ""}
        ${ev.link ? `<a class="timeline-link" href="${esc(ev.link)}" target="_blank" rel="noreferrer noopener">Open →</a>` : ""}
      </div>
    </li>`).join("");

  return `<div class="widget widget-timeline emph-${esc(emphasis)}">
  ${data.label ? `<div class="widget-header">${esc(data.label)}</div>` : ""}
  <ol class="timeline">${items}</ol>
</div>`;
}
