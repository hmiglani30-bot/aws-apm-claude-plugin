// heatmap — 2D intensity grid for time-of-day × metric visualization.
//
// Data shape:
//   {
//     label?: string,
//     rows: string[],            // row labels (e.g. hours "00:00".."23:00")
//     columns: string[],         // column labels (e.g. days "Mon".."Sun")
//     data: number[][],          // matrix[rowIdx][colIdx]
//     unit?: string,
//     scale?: { min?: number, max?: number }   // override auto-detected range
//   }
//
// Cells are colored on a deep-blue → orange → red gradient. Missing values
// render as transparent. Each cell carries a tooltip with the exact value.

import { esc, fmt } from "./_util.js";

export const density = 2;

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function intensityColor(t) {
  const x = clamp01(t);
  // Stops chosen to read clearly on a dark surface and align with the
  // Cloudscape dark-theme severity ramp (info → warning → error).
  const stops = [
    [0.0, [22, 58, 94]],     // deep navy (cool / low)
    [0.5, [217, 119, 6]],    // amber (mid)
    [1.0, [239, 68, 68]],    // red (hot / high)
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(239,68,68)";
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "secondary";
  const rowLabels = Array.isArray(data.rows) ? data.rows : [];
  const colLabels = Array.isArray(data.columns) ? data.columns : [];
  const matrix = Array.isArray(data.data) ? data.data : [];
  const unit = data.unit ? esc(data.unit) : "";

  let lo = Infinity;
  let hi = -Infinity;
  for (const row of matrix) {
    if (!Array.isArray(row)) continue;
    for (const v of row) {
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (data.scale && typeof data.scale.min === "number") lo = data.scale.min;
  if (data.scale && typeof data.scale.max === "number") hi = data.scale.max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  const range = hi - lo || 1;

  const colTmpl = `auto repeat(${colLabels.length}, minmax(0, 1fr))`;

  const cells = [];
  cells.push(`<div class="heatmap-corner" aria-hidden="true"></div>`);
  for (const c of colLabels) {
    cells.push(`<div class="heatmap-col-head">${esc(c)}</div>`);
  }
  for (let ri = 0; ri < rowLabels.length; ri++) {
    cells.push(`<div class="heatmap-row-head">${esc(rowLabels[ri])}</div>`);
    for (let ci = 0; ci < colLabels.length; ci++) {
      const row = matrix[ri];
      const v = Array.isArray(row) ? row[ci] : undefined;
      const num = typeof v === "number" ? v : NaN;
      const ok = Number.isFinite(num);
      const t = ok ? (num - lo) / range : 0;
      const bg = ok ? intensityColor(t) : "transparent";
      const valueLabel = ok ? `${fmt(num)}${unit ? " " + unit : ""}` : "—";
      const tip = `${rowLabels[ri]} · ${colLabels[ci]}: ${valueLabel}`;
      const cls = ok ? "heatmap-cell" : "heatmap-cell heatmap-cell-empty";
      cells.push(`<div class="${cls}" style="background:${bg}" title="${esc(tip)}" aria-label="${esc(tip)}"></div>`);
    }
  }

  const grid = cells.length > 1
    ? `<div class="heatmap-grid" style="grid-template-columns: ${colTmpl};">${cells.join("")}</div>`
    : `<div class="empty-row">No data.</div>`;

  const legendStops = `linear-gradient(90deg, ${intensityColor(0)} 0%, ${intensityColor(0.5)} 50%, ${intensityColor(1)} 100%)`;
  const legend = `<div class="heatmap-legend">
    <span class="legend-min">${fmt(lo)}${unit ? " " + unit : ""}</span>
    <span class="legend-bar" style="background:${legendStops};" aria-hidden="true"></span>
    <span class="legend-max">${fmt(hi)}${unit ? " " + unit : ""}</span>
  </div>`;

  return `<div class="widget widget-heatmap emph-${esc(emphasis)}">
  <div class="widget-header">
    <span>${esc(data.label || "Heatmap")}</span>
    ${unit ? `<span class="widget-meta">${unit}</span>` : ""}
  </div>
  ${grid}
  ${legend}
</div>`;
}
