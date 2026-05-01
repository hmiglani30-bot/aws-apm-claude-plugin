// diff_view — before/after comparison for config or code changes.
//
// Data shape:
//   {
//     label?: string,
//     before: { content: string, label?: string, language?: string },
//     after:  { content: string, label?: string, language?: string },
//     metadata?: { what?: string, who?: string, when?: string },
//     mode?: "unified" (default) | "side-by-side"
//   }
//
// Computes a line-by-line diff via LCS on small inputs and falls back to a
// naive paired alignment for very large inputs (>2000 combined lines).

import { esc } from "./_util.js";

export const density = 3;

function splitLines(s) {
  if (typeof s !== "string") return [];
  if (s === "") return [];
  return s.split(/\r?\n/);
}

function diffLines(a, b) {
  const m = a.length;
  const n = b.length;

  // Naive alignment fallback for huge inputs to keep this O(m+n).
  if (m + n > 2000) {
    const out = [];
    const max = Math.max(m, n);
    for (let i = 0; i < max; i++) {
      const al = i < m ? a[i] : undefined;
      const bl = i < n ? b[i] : undefined;
      if (al !== undefined && bl !== undefined && al === bl) {
        out.push({ op: "=", line: al });
      } else {
        if (al !== undefined) out.push({ op: "-", line: al });
        if (bl !== undefined) out.push({ op: "+", line: bl });
      }
    }
    return out;
  }

  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { out.push({ op: "=", line: a[i - 1] }); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { out.push({ op: "-", line: a[i - 1] }); i--; }
    else { out.push({ op: "+", line: b[j - 1] }); j--; }
  }
  while (i > 0) { out.push({ op: "-", line: a[i - 1] }); i--; }
  while (j > 0) { out.push({ op: "+", line: b[j - 1] }); j--; }
  return out.reverse();
}

function lineNumber(n) {
  return n === null || n === undefined ? "" : String(n);
}

function renderUnified(diff) {
  let oldNo = 0;
  let newNo = 0;
  const lines = diff.map(d => {
    let cls;
    let sym;
    let l;
    let r;
    if (d.op === "+") { cls = "diff-add"; sym = "+"; oldNo += 0; newNo += 1; l = ""; r = newNo; }
    else if (d.op === "-") { cls = "diff-remove"; sym = "-"; oldNo += 1; l = oldNo; r = ""; }
    else { cls = "diff-context"; sym = " "; oldNo += 1; newNo += 1; l = oldNo; r = newNo; }
    return `<div class="diff-line ${cls}">
      <span class="diff-lineno diff-lineno-old">${lineNumber(l)}</span>
      <span class="diff-lineno diff-lineno-new">${lineNumber(r)}</span>
      <span class="diff-gutter" aria-hidden="true">${sym}</span>
      <span class="diff-text">${esc(d.line)}</span>
    </div>`;
  }).join("");
  return `<div class="diff-unified">${lines}</div>`;
}

function renderSideBySide(diff, beforeLabel, afterLabel) {
  // Pair adjacent removes/adds so they sit on the same row.
  const rows = [];
  let i = 0;
  let oldNo = 0;
  let newNo = 0;
  while (i < diff.length) {
    const cur = diff[i];
    if (cur.op === "=") {
      oldNo += 1;
      newNo += 1;
      rows.push({
        leftNo: oldNo, left: cur.line, leftCls: "diff-context",
        rightNo: newNo, right: cur.line, rightCls: "diff-context",
      });
      i++;
      continue;
    }
    const removes = [];
    while (i < diff.length && diff[i].op === "-") { removes.push(diff[i].line); i++; }
    const adds = [];
    while (i < diff.length && diff[i].op === "+") { adds.push(diff[i].line); i++; }
    const max = Math.max(removes.length, adds.length);
    for (let k = 0; k < max; k++) {
      const hasL = k < removes.length;
      const hasR = k < adds.length;
      if (hasL) oldNo += 1;
      if (hasR) newNo += 1;
      rows.push({
        leftNo: hasL ? oldNo : "", left: hasL ? removes[k] : "",
        leftCls: hasL ? "diff-remove" : "diff-empty",
        rightNo: hasR ? newNo : "", right: hasR ? adds[k] : "",
        rightCls: hasR ? "diff-add" : "diff-empty",
      });
    }
  }

  const head = `<div class="diff-row diff-head">
    <div class="diff-side diff-left-head">${esc(beforeLabel || "Before")}</div>
    <div class="diff-side diff-right-head">${esc(afterLabel || "After")}</div>
  </div>`;
  const body = rows.map(r => `<div class="diff-row">
    <div class="diff-side ${r.leftCls}">
      <span class="diff-lineno">${lineNumber(r.leftNo)}</span>
      <span class="diff-text">${esc(r.left)}</span>
    </div>
    <div class="diff-side ${r.rightCls}">
      <span class="diff-lineno">${lineNumber(r.rightNo)}</span>
      <span class="diff-text">${esc(r.right)}</span>
    </div>
  </div>`).join("");
  return `<div class="diff-side-by-side">${head}${body}</div>`;
}

function renderMeta(meta) {
  if (!meta) return "";
  const parts = [];
  if (meta.what) parts.push(`<span class="diff-meta-item"><span class="lbl">Changed</span> ${esc(meta.what)}</span>`);
  if (meta.who)  parts.push(`<span class="diff-meta-item"><span class="lbl">By</span> ${esc(meta.who)}</span>`);
  if (meta.when) parts.push(`<span class="diff-meta-item"><span class="lbl">When</span> ${esc(meta.when)}</span>`);
  if (!parts.length) return "";
  return `<div class="diff-meta">${parts.join("")}</div>`;
}

export function render(data, hints = {}) {
  const emphasis = hints.emphasis || "primary";
  const mode = data.mode === "side-by-side" ? "side-by-side" : "unified";
  const before = data.before || {};
  const after = data.after || {};
  const a = splitLines(before.content || "");
  const b = splitLines(after.content || "");
  const diff = diffLines(a, b);
  const adds = diff.reduce((n, d) => n + (d.op === "+" ? 1 : 0), 0);
  const removes = diff.reduce((n, d) => n + (d.op === "-" ? 1 : 0), 0);

  const body = mode === "side-by-side"
    ? renderSideBySide(diff, before.label, after.label)
    : renderUnified(diff);

  const lang = before.language || after.language;

  return `<div class="widget widget-diff-view emph-${esc(emphasis)} diff-mode-${mode}">
  <div class="widget-header">
    <span>${esc(data.label || "Diff")}</span>
    <span class="widget-meta">
      ${lang ? `<code>${esc(lang)}</code> · ` : ""}<span class="diff-add-count">+${adds}</span> <span class="diff-remove-count">−${removes}</span>
    </span>
  </div>
  ${renderMeta(data.metadata)}
  <div class="diff-body">${body}</div>
</div>`;
}
