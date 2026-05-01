// app_map — service topology graph for AWS Application Signals.
//
// Data shape:
//   {
//     label?: string,
//     services: [
//       { id, name, status?: "healthy"|"degraded"|"unhealthy"|"neutral",
//         error_rate?: number, error_rate_unit?: string ("%" by default),
//         latency_ms?: number, on_critical_path?: boolean }
//     ],
//     edges: [
//       { from, to, traffic?: number, on_critical_path?: boolean }
//     ],
//     critical_path?: [service_id, ...]   // alternative way to mark nodes
//   }
//
// Layout: services are placed in columns by topological "level" (longest
// path from any root). Edges are bezier paths whose stroke width is
// proportional to traffic volume. Nodes and edges on the critical path
// receive a distinguishing class.

import { esc, fmt, statusToClass } from "./_util.js";

export const density = 3;

function computeLevels(services, edges) {
  const ids = services.map(s => s.id);
  const idSet = new Set(ids);
  const level = Object.fromEntries(ids.map(i => [i, 0]));
  // Iteratively relax: level[to] = max(level[to], level[from] + 1).
  // Safe upper bound on iterations = #services (DAG longest path).
  const maxIter = Math.max(8, services.length + 1);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const e of edges) {
      if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
      const next = level[e.from] + 1;
      if (next > level[e.to]) { level[e.to] = next; changed = true; }
    }
    if (!changed) break;
  }
  return level;
}

function edgeClass(edge, criticalSet) {
  if (edge.on_critical_path || (criticalSet.has(edge.from) && criticalSet.has(edge.to))) {
    return "app-map-edge edge-critical";
  }
  return "app-map-edge edge-default";
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "primary";
  const services = Array.isArray(data.services) ? data.services : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const criticalSet = new Set(Array.isArray(data.critical_path) ? data.critical_path : []);
  for (const s of services) if (s && s.on_critical_path) criticalSet.add(s.id);

  if (!services.length) {
    return `<div class="widget widget-app-map emph-${esc(emphasis)}">
  <div class="widget-header"><span>${esc(data.label || "Application Map")}</span></div>
  <div class="empty-row">No services in topology.</div>
</div>`;
  }

  const level = computeLevels(services, edges);
  const byLevel = {};
  for (const s of services) {
    const l = level[s.id] || 0;
    (byLevel[l] = byLevel[l] || []).push(s);
  }
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);

  const COL_W = 200;
  const ROW_H = 110;
  const NODE_W = 168;
  const NODE_H = 78;
  const PAD_X = 24;
  const PAD_Y = 32;

  const maxRows = Math.max(...Object.values(byLevel).map(arr => arr.length));
  const W = Math.max(640, levels.length * COL_W + PAD_X * 2);
  const H = Math.max(220, maxRows * ROW_H + PAD_Y * 2);

  const positions = {};
  for (const l of levels) {
    const arr = byLevel[l];
    const totalH = arr.length * ROW_H;
    const startY = (H - totalH) / 2 + (ROW_H - NODE_H) / 2;
    arr.forEach((s, i) => {
      positions[s.id] = {
        x: PAD_X + l * COL_W,
        y: startY + i * ROW_H,
      };
    });
  }

  const maxTraffic = Math.max(1, ...edges.map(e => Number(e.traffic) || 0));

  const edgesSvg = edges.map(e => {
    const p1 = positions[e.from];
    const p2 = positions[e.to];
    if (!p1 || !p2) return "";
    const x1 = p1.x + NODE_W;
    const y1 = p1.y + NODE_H / 2;
    const x2 = p2.x;
    const y2 = p2.y + NODE_H / 2;
    const cx1 = x1 + 60;
    const cx2 = x2 - 60;
    const w = e.traffic
      ? Math.max(1, Math.min(6, (Number(e.traffic) / maxTraffic) * 6))
      : 1.5;
    const cls = edgeClass(e, criticalSet);
    const trafficLabel = e.traffic !== undefined
      ? `<title>${esc(e.from)} → ${esc(e.to)}: ${esc(fmt(e.traffic))} req/s</title>`
      : `<title>${esc(e.from)} → ${esc(e.to)}</title>`;
    return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${y1.toFixed(1)}, ${cx2.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke-width="${w.toFixed(1)}" class="${cls}" fill="none">${trafficLabel}</path>`;
  }).join("");

  const nodesSvg = services.map(s => {
    const p = positions[s.id];
    if (!p) return "";
    const status = statusToClass(s.status);
    const isCrit = criticalSet.has(s.id);
    const cls = `app-map-node ${status}${isCrit ? " on-critical-path" : ""}`;
    const errPart = s.error_rate !== undefined
      ? `<text x="${(p.x + 14).toFixed(1)}" y="${(p.y + 60).toFixed(1)}" class="node-metric">err ${esc(fmt(s.error_rate))}${esc(s.error_rate_unit || "%")}</text>`
      : "";
    const latPart = s.latency_ms !== undefined
      ? `<text x="${(p.x + NODE_W - 14).toFixed(1)}" y="${(p.y + 60).toFixed(1)}" class="node-metric" text-anchor="end">p99 ${esc(fmt(s.latency_ms))}ms</text>`
      : "";
    return `<g class="${cls}" aria-label="${esc(s.name)} status ${esc(s.status || "neutral")}">
      <rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${NODE_W}" height="${NODE_H}" rx="8" class="node-rect" />
      <circle cx="${(p.x + 16).toFixed(1)}" cy="${(p.y + 22).toFixed(1)}" r="5" class="node-status-dot" />
      <text x="${(p.x + 28).toFixed(1)}" y="${(p.y + 26).toFixed(1)}" class="node-name">${esc(s.name)}</text>
      ${errPart}
      ${latPart}
    </g>`;
  }).join("");

  const legend = `<div class="app-map-legend">
    <span class="legend-item legend-healthy"><span class="legend-dot" aria-hidden="true"></span>healthy</span>
    <span class="legend-item legend-degraded"><span class="legend-dot" aria-hidden="true"></span>degraded</span>
    <span class="legend-item legend-unhealthy"><span class="legend-dot" aria-hidden="true"></span>unhealthy</span>
    <span class="legend-item legend-critical"><span class="legend-dash" aria-hidden="true"></span>critical path</span>
  </div>`;

  return `<div class="widget widget-app-map emph-${esc(emphasis)}">
  <div class="widget-header">
    <span>${esc(data.label || "Application Map")}</span>
    <span class="widget-meta">${services.length} services · ${edges.length} dependencies</span>
  </div>
  <div class="app-map-canvas">
    <svg viewBox="0 0 ${W} ${H}" class="app-map-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Service topology">
      <g class="app-map-edges">${edgesSvg}</g>
      <g class="app-map-nodes">${nodesSvg}</g>
    </svg>
  </div>
  ${legend}
</div>`;
}
