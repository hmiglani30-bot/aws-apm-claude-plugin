// interactions.js — opt-in client-side enhancements for rendered artifacts.
//
// The renderer produces a static HTML string with data-attributes annotated.
// The host calls bindInteractions(rootEl) after inserting that HTML to wire
// sort + search on tables. Keeping this OUT of the widget output preserves
// the "manifest in -> HTML out" purity contract of the renderer.

function compareCells(a, b, kind) {
  if (kind === "number") {
    const na = parseFloat(String(a).replace(/[^\d.\-]/g, ""));
    const nb = parseFloat(String(b).replace(/[^\d.\-]/g, ""));
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  }
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function bindTable(tableEl) {
  const tbody = tableEl.querySelector("tbody");
  if (!tbody) return;
  const headers = tableEl.querySelectorAll("th.sortable");

  headers.forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort-key");
      const kind = th.getAttribute("data-sort-kind") || "text";
      const current = th.getAttribute("aria-sort");
      const next = current === "ascending" ? "descending" : "ascending";

      headers.forEach(h => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", next);

      const rows = [...tbody.querySelectorAll("tr")].filter(r => !r.querySelector(".empty-row"));
      rows.sort((rowA, rowB) => {
        const a = rowA.querySelector(`td[data-col="${key}"]`)?.textContent.trim();
        const b = rowB.querySelector(`td[data-col="${key}"]`)?.textContent.trim();
        const cmp = compareCells(a, b, kind);
        return next === "ascending" ? cmp : -cmp;
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

function bindSearch(rootEl, tableId) {
  const input = rootEl.querySelector(`input[data-table-search="${tableId}"]`);
  const widget = rootEl.querySelector(`.widget-table[data-table-id="${tableId}"]`);
  if (!input || !widget) return;
  const tbody = widget.querySelector("tbody");
  if (!tbody) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const rows = tbody.querySelectorAll("tr");
    rows.forEach(row => {
      if (row.querySelector(".empty-row")) return;
      const text = row.textContent.toLowerCase();
      row.style.display = q && !text.includes(q) ? "none" : "";
    });
  });
}

export function bindInteractions(rootEl) {
  if (!rootEl) return;
  const tables = rootEl.querySelectorAll(".widget-table");
  tables.forEach(t => {
    bindTable(t);
    const id = t.getAttribute("data-table-id");
    if (id) bindSearch(rootEl, id);
  });
}
