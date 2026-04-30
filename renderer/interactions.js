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

  const sortBy = th => {
    const key = th.getAttribute("data-sort-key");
    const kind = th.getAttribute("data-sort-kind") || "text";
    const current = th.getAttribute("aria-sort");
    const next = current === "ascending" ? "descending" : "ascending";

    // Reset other columns to "none" rather than removing the attribute, so
    // assistive tech keeps announcing them as sortable.
    headers.forEach(h => { if (h !== th) h.setAttribute("aria-sort", "none"); });
    th.setAttribute("aria-sort", next);

    const rows = [...tbody.querySelectorAll("tr")].filter(r => !r.querySelector(".empty-row"));
    rows.sort((rowA, rowB) => {
      const a = rowA.querySelector(`td[data-col="${key}"]`)?.textContent.trim();
      const b = rowB.querySelector(`td[data-col="${key}"]`)?.textContent.trim();
      const cmp = compareCells(a, b, kind);
      return next === "ascending" ? cmp : -cmp;
    });
    rows.forEach(r => tbody.appendChild(r));
  };

  headers.forEach(th => {
    th.addEventListener("click", () => sortBy(th));
    th.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        sortBy(th);
      }
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

function bindCopyButtons(rootEl) {
  const buttons = rootEl.querySelectorAll(".af-copy-btn[data-copy-target]");
  buttons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-copy-target");
      const target = rootEl.querySelector(`#${CSS.escape(targetId)}`);
      if (!target) return;
      const text = target.textContent || "";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        const original = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("copied");
        }, 1500);
      } catch {
        // Silent — fall back to user manually selecting the <pre>.
      }
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
  bindCopyButtons(rootEl);
}
