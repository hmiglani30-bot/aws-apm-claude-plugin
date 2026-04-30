import { esc, fmt } from "./_util.js";

export const density = 2;

let tableUid = 0;

function renderCell(value, kind) {
  if (value === null || value === undefined) return `<span class="cell-empty">—</span>`;
  switch (kind) {
    case "number":
      return fmt(value);
    case "code":
      return `<code>${esc(value)}</code>`;
    case "link":
      if (typeof value === "object" && value.href) {
        return `<a href="${esc(value.href)}" target="_blank" rel="noreferrer noopener">${esc(value.label || value.href)}</a>`;
      }
      return `<a href="${esc(value)}" target="_blank" rel="noreferrer noopener">${esc(value)}</a>`;
    case "status": {
      const map = {
        healthy: "ok", ok: "ok",
        warning: "warn", warn: "warn", degraded: "warn",
        error: "err", critical: "err", unhealthy: "err",
      };
      const cls = map[String(value).toLowerCase()] || "neutral";
      return `<span class="cell-status cell-status-${cls}" aria-label="Status: ${esc(value)}"><span class="dot" aria-hidden="true"></span>${esc(value)}</span>`;
    }
    default:
      return esc(value);
  }
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "secondary";
  const cols = Array.isArray(data.columns) ? data.columns : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const searchable = data.searchable !== false;
  const sortable = data.sortable !== false;
  const id = `tbl-${++tableUid}-${Math.random().toString(36).slice(2, 7)}`;

  const head = cols.map((c, i) => {
    const align = c.align ? `align-${c.align}` : "";
    const sortAttr = sortable
      ? `data-sort-key="${esc(c.key)}" data-sort-kind="${esc(c.kind || "text")}" tabindex="0" role="button" aria-sort="none" aria-label="Sort by ${esc(c.label)}"`
      : "";
    return `<th class="${align} ${sortable ? "sortable" : ""}" ${sortAttr}>${esc(c.label)}${sortable ? `<span class="sort-indicator" aria-hidden="true"></span>` : ""}</th>`;
  }).join("");

  const body = rows.length === 0
    ? `<tr><td colspan="${cols.length}" class="empty-row">${esc(data.empty_message || "No rows.")}</td></tr>`
    : rows.map(r => {
        const tds = cols.map(c => {
          const align = c.align ? `align-${c.align}` : "";
          return `<td class="${align}" data-col="${esc(c.key)}">${renderCell(r[c.key], c.kind)}</td>`;
        }).join("");
        return `<tr>${tds}</tr>`;
      }).join("");

  return `<div class="widget widget-table emph-${esc(emphasis)}" data-table-id="${id}">
  <div class="widget-header">
    <span>${esc(data.label || "")}</span>
    ${searchable ? `<input type="search" class="table-search" placeholder="Filter…" aria-label="Filter rows" data-table-search="${id}" />` : ""}
  </div>
  <div class="table-scroll">
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</div>`;
}
