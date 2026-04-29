import { esc, fmt, statusToClass, trendClass, trendArrow, svgSparkline } from "./_util.js";

export const density = 1;

export function render(data, hints = {}) {
  const status = statusToClass(data.status);
  const emphasis = hints.emphasis || "secondary";
  const size = hints.size_preference || "default";

  const trend = data.trend
    ? `<div class="stat-card-trend ${trendClass(data.trend.direction, data.trend.good_or_bad)}">
        <span class="trend-arrow">${trendArrow(data.trend.direction)}</span>
        <span class="trend-magnitude">${esc(data.trend.magnitude || "")}</span>
      </div>`
    : "";

  const baseline = data.baseline !== undefined
    ? `<div class="stat-card-baseline">${esc(data.baseline_label || "Baseline")}: ${fmt(data.baseline)}${data.unit ? " " + esc(data.unit) : ""}</div>`
    : "";

  const sparkline = Array.isArray(data.sparkline) && data.sparkline.length >= 2
    ? svgSparkline(data.sparkline)
    : "";

  return `<div class="widget widget-stat-card ${status} emph-${esc(emphasis)} size-${esc(size)}">
  <div class="stat-card-label">${esc(data.label)}</div>
  <div class="stat-card-value">
    <span class="value-number">${fmt(data.value)}</span>
    ${data.unit ? `<span class="value-unit">${esc(data.unit)}</span>` : ""}
  </div>
  ${sparkline}
  ${baseline}
  ${trend}
</div>`;
}
