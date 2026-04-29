import { esc, fmt, svgSparkline, colorVarFor } from "./_util.js";

export const density = 1;

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "secondary";
  const size = hints.size_preference || "default";
  const color = colorVarFor(data.color);

  const points = Array.isArray(data.points) ? data.points : [];
  const min = points.length ? Math.min(...points) : null;
  const max = points.length ? Math.max(...points) : null;

  const meta = [];
  if (data.current !== undefined) meta.push(`<span class="sparkline-meta-item"><span class="lbl">current</span><span class="val">${fmt(data.current)}${data.unit ? " " + esc(data.unit) : ""}</span></span>`);
  if (data.min !== undefined || min !== null) meta.push(`<span class="sparkline-meta-item"><span class="lbl">min</span><span class="val">${fmt(data.min !== undefined ? data.min : min)}</span></span>`);
  if (data.max !== undefined || max !== null) meta.push(`<span class="sparkline-meta-item"><span class="lbl">max</span><span class="val">${fmt(data.max !== undefined ? data.max : max)}</span></span>`);

  return `<div class="widget widget-sparkline emph-${esc(emphasis)} size-${esc(size)}">
  <div class="sparkline-header">
    <div class="sparkline-label">${esc(data.label)}</div>
  </div>
  <div class="sparkline-chart">${svgSparkline(points, color)}</div>
  <div class="sparkline-meta">${meta.join("")}</div>
</div>`;
}
