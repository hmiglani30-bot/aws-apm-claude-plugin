// progress_tracker — vertical multi-step remediation checklist.
//
// Data shape:
//   {
//     label?: string,
//     steps: [
//       {
//         label: string,
//         status: "pending" | "in_progress" | "completed" | "failed" | "skipped",
//         detail?: string,
//         link?: string,
//         link_label?: string
//       }
//     ]
//   }
//
// Renders as a vertical stepper with status icons, connector lines between
// steps, and an aria-current="step" marker on the in-progress step.

import { esc } from "./_util.js";

export const density = 2;

const STATUS_ICONS = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  failed: "✕",
  skipped: "⊘",
};

const STATUS_LABEL = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

function statusCls(status) {
  switch (status) {
    case "completed":   return "step-completed";
    case "in_progress": return "step-in-progress";
    case "failed":      return "step-failed";
    case "skipped":     return "step-skipped";
    default:            return "step-pending";
  }
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "secondary";
  const steps = Array.isArray(data.steps) ? data.steps : [];

  if (!steps.length) {
    return `<div class="widget widget-progress-tracker emph-${esc(emphasis)}">
  <div class="widget-header"><span>${esc(data.label || "Progress")}</span></div>
  <div class="empty-row">No steps.</div>
</div>`;
  }

  const items = steps.map((s, i) => {
    const status = s.status in STATUS_ICONS ? s.status : "pending";
    const cls = statusCls(status);
    const icon = STATUS_ICONS[status];
    const isCurrent = status === "in_progress";
    const isLast = i === steps.length - 1;
    const link = s.link
      ? `<a class="step-link" href="${esc(s.link)}" target="_blank" rel="noreferrer noopener">${esc(s.link_label || "Open →")}</a>`
      : "";
    const detail = s.detail ? `<div class="step-detail">${esc(s.detail)}</div>` : "";
    const statusBadge = `<span class="step-status-badge">${esc(STATUS_LABEL[status])}</span>`;
    return `<li class="pt-step ${cls}${isCurrent ? " is-current" : ""}"${isCurrent ? ` aria-current="step"` : ""}>
      <div class="pt-marker" aria-hidden="true">
        <span class="pt-icon">${icon}</span>
        ${isLast ? "" : `<span class="pt-connector"></span>`}
      </div>
      <div class="pt-body">
        <div class="pt-label-row">
          <span class="pt-label">${esc(s.label)}</span>
          ${statusBadge}
        </div>
        ${detail}
        ${link}
      </div>
    </li>`;
  }).join("");

  const completed = steps.reduce((n, s) => n + (s.status === "completed" ? 1 : 0), 0);
  const summary = `${completed}/${steps.length} completed`;

  return `<div class="widget widget-progress-tracker emph-${esc(emphasis)}">
  <div class="widget-header">
    <span>${esc(data.label || "Progress")}</span>
    <span class="widget-meta">${esc(summary)}</span>
  </div>
  <ol class="pt-steps">${items}</ol>
</div>`;
}
