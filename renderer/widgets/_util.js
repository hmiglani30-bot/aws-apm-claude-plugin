// Shared widget helpers. Pure functions only — no DOM access, no globals.

export function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function severityToClass(severity) {
  switch (severity) {
    case "critical": return "sev-critical";
    case "warning": return "sev-warning";
    case "info": return "sev-info";
    case "success": return "sev-success";
    default: return "sev-neutral";
  }
}

export function statusToClass(status) {
  switch (status) {
    case "healthy": return "status-healthy";
    case "degraded": return "status-degraded";
    case "warning": return "status-warning";
    case "unhealthy": return "status-unhealthy";
    default: return "status-neutral";
  }
}

export function trendClass(direction, goodOrBad) {
  if (!direction) return "trend-neutral";
  if (goodOrBad === "good") return `trend-${direction}-good`;
  if (goodOrBad === "bad") return `trend-${direction}-bad`;
  return `trend-${direction}-neutral`;
}

export function trendArrow(direction) {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  return "—";
}

// Build SVG polyline points string scaled to the viewBox 0 0 100 30.
export function sparklinePoints(values) {
  if (!Array.isArray(values) || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = 100 / (values.length - 1);
  return values
    .map((v, i) => {
      const x = (i * step).toFixed(2);
      const y = (28 - ((v - min) / range) * 26).toFixed(2);
      return `${x},${y}`;
    })
    .join(" ");
}

export function svgSparkline(points, colorVar = "var(--link)") {
  const pts = sparklinePoints(points);
  if (!pts) return "";
  return `<svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
  <polyline fill="none" stroke="${colorVar}" stroke-width="1.5" points="${pts}" />
</svg>`;
}

export function colorVarFor(name) {
  switch (name) {
    case "blue": return "var(--link)";
    case "orange": return "var(--status-warning)";
    case "red": return "var(--status-error)";
    case "green": return "var(--status-success)";
    case "gray": return "var(--text-secondary)";
    default: return "var(--link)";
  }
}

// Format any value for display. Numbers with > 0.001 fractional component get fixed-2.
export function fmt(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return esc(value);
}
