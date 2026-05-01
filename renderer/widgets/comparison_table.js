// comparison_table — A/B (or N-way) metric comparison table.
//
// Data shape:
//   {
//     label?: string,
//     metric_label?: string,           // header for the first column ("Metric")
//     columns: [{ key, label, sublabel? }],   // 2+ comparison columns
//     rows: [
//       {
//         metric: string,
//         unit?: string,
//         values: { [columnKey]: number|string },
//         delta?: {
//           [columnKey]: {
//             magnitude?: string ("+24%"),
//             direction?: "up"|"down"|"flat",
//             good_or_bad?: "good"|"bad"|"neutral",
//             highlight?: boolean
//           }
//         }
//       }
//     ],
//     threshold?: number              // |Δ%| ≥ threshold => highlight (default 10)
//   }
//
// When no explicit delta is provided for the last column, the renderer
// computes (last - first) / |first| × 100 and highlights cells whose
// absolute change meets the threshold.

import { esc, fmt, trendArrow, trendClass } from "./_util.js";

export const density = 2;

function computeDelta(a, b) {
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  const diff = b - a;
  const denom = Math.abs(a);
  const pct = denom === 0 ? null : (diff / denom) * 100;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const magnitude = pct === null
    ? `${diff >= 0 ? "+" : ""}${fmt(diff)}`
    : `${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  return { magnitude, direction, pct };
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "secondary";
  const cols = Array.isArray(data.columns) ? data.columns : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const metricLabel = data.metric_label || "Metric";
  const threshold = typeof data.threshold === "number" ? data.threshold : 10;
  const showDelta = cols.length >= 2;
  const baseKey = cols[0] && cols[0].key;
  const lastKey = cols[cols.length - 1] && cols[cols.length - 1].key;

  const head = `<thead><tr>
    <th class="ct-metric-head">${esc(metricLabel)}</th>
    ${cols.map(c => `<th class="ct-col-head">
      <div class="ct-col-label">${esc(c.label)}</div>
      ${c.sublabel ? `<div class="ct-col-sub">${esc(c.sublabel)}</div>` : ""}
    </th>`).join("")}
    ${showDelta ? `<th class="ct-delta-head">Δ</th>` : ""}
  </tr></thead>`;

  const body = rows.length === 0
    ? `<tr><td colspan="${cols.length + (showDelta ? 2 : 1)}" class="empty-row">No metrics to compare.</td></tr>`
    : rows.map(r => {
        const values = r.values || {};
        const unitHtml = r.unit ? `<span class="ct-unit">${esc(r.unit)}</span>` : "";

        const valueCells = cols.map(c => {
          const v = values[c.key];
          const explicit = r.delta && r.delta[c.key];
          const cls = explicit ? trendClass(explicit.direction, explicit.good_or_bad) : "";
          const highlight = explicit && explicit.highlight ? "ct-highlight" : "";
          return `<td class="ct-value ${cls} ${highlight}" data-col="${esc(c.key)}">
            <span class="ct-value-num">${fmt(v)}</span>${unitHtml}
          </td>`;
        }).join("");

        let deltaCell = "";
        if (showDelta) {
          const explicit = r.delta && r.delta[lastKey];
          if (explicit) {
            const cls = trendClass(explicit.direction, explicit.good_or_bad);
            const highlight = explicit.highlight ? "ct-highlight" : "";
            deltaCell = `<td class="ct-delta ${cls} ${highlight}">
              <span class="trend-arrow">${trendArrow(explicit.direction)}</span>
              <span class="trend-magnitude">${esc(explicit.magnitude || "")}</span>
            </td>`;
          } else {
            const auto = computeDelta(values[baseKey], values[lastKey]);
            if (auto) {
              const exceeded = auto.pct !== null && Math.abs(auto.pct) >= threshold;
              const cls = trendClass(auto.direction, "neutral");
              deltaCell = `<td class="ct-delta ${cls} ${exceeded ? "ct-highlight" : ""}">
                <span class="trend-arrow">${trendArrow(auto.direction)}</span>
                <span class="trend-magnitude">${esc(auto.magnitude)}</span>
              </td>`;
            } else {
              deltaCell = `<td class="ct-delta ct-delta-empty">—</td>`;
            }
          }
        }

        return `<tr>
          <td class="ct-metric">${esc(r.metric)}</td>
          ${valueCells}
          ${deltaCell}
        </tr>`;
      }).join("");

  return `<div class="widget widget-comparison-table emph-${esc(emphasis)}">
  <div class="widget-header">
    <span>${esc(data.label || "Comparison")}</span>
    ${showDelta ? `<span class="widget-meta">Highlight ≥ ${fmt(threshold)}%</span>` : ""}
  </div>
  <div class="ct-scroll">
    <table class="ct-table">
      ${head}
      <tbody>${body}</tbody>
    </table>
  </div>
</div>`;
}
