// Hybrid renderer evaluation harness.
//
// Runs the eval cases through the renderer and scores each on 7 dimensions:
//   1. Manifest validity   — passes JSON-Schema validation (ajv, the contract)
//   2. Shell selection     — engine inferred the shell we expected
//   3. Widget relevance    — required widgets present, forbidden absent
//   4. Widget count        — within the per-prompt expected range
//   5. Density budget      — densityUsed <= budget AND drawer overflow not excessive
//   6. Rendering           — renderManifest produced valid HTML, no widget-error tags
//   7. HTML quality        — escaping, status mapping, sortable a11y, link safety,
//                            trace bar containment — battery of static HTML checks
//
// Output:
//   evals/hybrid-renderer-eval-results.json — raw per-case results
//   evals/hybrid-renderer-eval-results.html — human-readable scorecard (HTML source for PDF)
//
// PDF generation is a separate step (see make-pdf.sh) using Chrome headless.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  initRenderer,
  preloadShells,
  renderManifest,
  validateManifest,
  inferShell,
  planLayout,
  cacheClear,
} from "../renderer/render.js";

import { CASES, CATEGORIES } from "./cases.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Bootstrap: preload shells from disk so the renderer doesn't need fetch().
// ---------------------------------------------------------------------------

async function bootstrapRenderer() {
  const shells = {};
  for (const name of ["single-focus", "investigation", "dashboard"]) {
    shells[name] = await readFile(resolve(ROOT, "renderer/shells", `${name}.html`), "utf8");
  }
  preloadShells(shells);
  await initRenderer();
}

// ---------------------------------------------------------------------------
// Schema validator — ajv against the actual contract in schemas/.
// ---------------------------------------------------------------------------

async function buildSchemaValidator() {
  const schema = JSON.parse(
    await readFile(resolve(ROOT, "schemas/manifest.schema.json"), "utf8")
  );
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

// ---------------------------------------------------------------------------
// Per-case scoring.
// ---------------------------------------------------------------------------

function scoreShell(plan, expected) {
  if (!expected || !expected.shell) return { pass: true, note: "no expectation" };
  const allowed = Array.isArray(expected.shell) ? expected.shell : [expected.shell];
  const pass = allowed.includes(plan.shell);
  return {
    pass,
    note: pass
      ? `inferred ${plan.shell}`
      : `expected ${allowed.join("|")}, got ${plan.shell}`,
  };
}

function scoreWidgetRelevance(manifest, expected) {
  if (!expected) return { pass: true, note: "no expectation" };
  const types = new Set((manifest.widgets || []).map(w => w.type));
  const issues = [];

  // mustInclude: every type in this list must be present
  for (const t of expected.mustInclude || []) {
    if (!types.has(t)) issues.push(`missing required widget: ${t}`);
  }
  // mustIncludeAny / mustIncludeAny2: each is an any-of group; at least one
  // type per group must be present. Two groups capture the common pattern
  // "needs an at-a-glance number AND needs a structured detail widget".
  for (const key of ["mustIncludeAny", "mustIncludeAny2"]) {
    const group = expected[key];
    if (group && group.length && !group.some(t => types.has(t))) {
      issues.push(`missing any-of (${key}): ${group.join("|")}`);
    }
  }
  // forbidden: none may be present
  for (const t of expected.forbidden || []) {
    if (types.has(t)) issues.push(`forbidden widget present: ${t}`);
  }

  return {
    pass: issues.length === 0,
    note: issues.length ? issues.join("; ") : `widgets=[${[...types].join(",")}]`,
  };
}

function scoreWidgetCount(manifest, expected) {
  const count = (manifest.widgets || []).length;
  if (!expected || !expected.widgetCount) {
    // sane defaults: 1..24
    const pass = count >= 1 && count <= 24;
    return { pass, note: `${count} widgets` };
  }
  const [min, max] = expected.widgetCount;
  const pass = count >= min && count <= max;
  return {
    pass,
    note: pass ? `${count} widgets (in [${min},${max}])` : `${count} widgets, expected [${min},${max}]`,
  };
}

function scoreDensityBudget(plan, manifest) {
  const issues = [];
  if (plan.densityUsed > plan.budget) {
    issues.push(`density ${plan.densityUsed} exceeds shell budget ${plan.budget}`);
  }
  // Drawer overflow: if more than half of widgets ended up in the drawer,
  // the LLM probably picked too many widgets for the inferred shell.
  const total = (manifest.widgets || []).length;
  const overflowRatio = total ? plan.drawer.length / total : 0;
  if (overflowRatio > 0.5) {
    issues.push(`drawer holds ${plan.drawer.length}/${total} widgets — too much overflow`);
  }
  return {
    pass: issues.length === 0,
    note: issues.length
      ? issues.join("; ")
      : `density ${plan.densityUsed}/${plan.budget}, drawer ${plan.drawer.length}/${total}`,
  };
}

function scoreRendering(html) {
  const issues = [];
  if (typeof html !== "string" || html.length < 50) issues.push("html empty/too short");
  if (!html.includes("hr-artifact")) issues.push("missing hr-artifact root");
  if (html.includes("widget-error")) issues.push("widget-error present (a widget threw)");
  if (html.includes("Manifest invalid — degraded view")) issues.push("renderer fell back to degraded view");
  // Light sanity: roughly balanced angle brackets
  const opens = (html.match(/</g) || []).length;
  const closes = (html.match(/>/g) || []).length;
  if (Math.abs(opens - closes) > 4) issues.push(`unbalanced angle brackets ${opens}/${closes}`);
  return {
    pass: issues.length === 0,
    note: issues.length ? issues.join("; ") : `${html.length} chars`,
  };
}

// HTML-quality checks. Each check returns null if it doesn't apply to this
// artifact, an empty string on success, or an issue description on failure.
// We run them all and aggregate, so one case can flag several real defects.

function checkHtmlEscaping(html, manifest) {
  // Look for executable-form attack shapes — patterns that only occur when
  // user-supplied HTML survives unescaped. Plain text containing the string
  // "javascript:alert" inside a log message is fine; an href="javascript:..."
  // attribute is not.
  const lower = html.toLowerCase();
  const probes = [
    // The renderer never emits a <script> tag itself, so any occurrence comes
    // from un-escaped input.
    { pattern: /<script\b/, label: "<script> tag" },
    // The renderer never emits <img>; finding one means an attacker-shaped
    // tag survived.
    { pattern: /<img\b/, label: "<img> tag" },
    // Inline event handler in an actual attribute position (preceded by a
    // tag-opening or whitespace, followed by "=").
    { pattern: /<[^>]*\son\w+\s*=/, label: "inline event handler" },
    // javascript:/data: URI inside href/src — only dangerous in attributes.
    { pattern: /(?:href|src)\s*=\s*["']?\s*(?:javascript|data):/, label: "javascript:/data: URI in href/src" },
  ];
  for (const { pattern, label } of probes) {
    if (pattern.test(lower)) {
      return `unescaped HTML detected: ${label}`;
    }
  }
  return "";
}

function checkSortableAriaSort(html) {
  // Every sortable th must declare aria-sort initially (typically "none") so
  // assistive tech announces the column as sortable before any click.
  const sortableThs = html.match(/<th[^>]*\bsortable\b[^>]*>/g) || [];
  if (!sortableThs.length) return null; // not applicable
  const missing = sortableThs.filter(t => !/\baria-sort=/.test(t));
  if (missing.length) {
    return `${missing.length}/${sortableThs.length} sortable <th> missing aria-sort`;
  }
  return "";
}

function checkSortableKeyboard(html) {
  // Sortable headers must be keyboard-focusable. Without tabindex on a non-button
  // element, sort is mouse-only.
  const sortableThs = html.match(/<th[^>]*\bsortable\b[^>]*>/g) || [];
  if (!sortableThs.length) return null;
  const missing = sortableThs.filter(t => !/\btabindex=/.test(t));
  if (missing.length) {
    return `${missing.length}/${sortableThs.length} sortable <th> not keyboard-focusable (no tabindex)`;
  }
  return "";
}

function checkStatusCellMapping(html) {
  // Status cells should use ok/warn/err for known severity values. Any cell that
  // ended up with cell-status-neutral while the visible text is a known status
  // means the type→class map missed it (e.g., "degraded" → neutral).
  const re = /<span class="cell-status cell-status-(\w+)"><span class="dot"><\/span>([^<]+)<\/span>/g;
  const knownGood = {
    healthy: "ok", ok: "ok",
    warning: "warn", warn: "warn", degraded: "warn",
    error: "err", critical: "err", unhealthy: "err",
  };
  const issues = [];
  let m;
  let saw = false;
  while ((m = re.exec(html)) !== null) {
    saw = true;
    const cls = m[1];
    const text = m[2].trim().toLowerCase();
    const want = knownGood[text];
    if (want && cls !== want) {
      issues.push(`"${text}" → cell-status-${cls} (expected cell-status-${want})`);
    }
  }
  if (!saw) return null;
  return issues.length ? issues.slice(0, 3).join("; ") : "";
}

function checkLinkSafety(html) {
  // Every <a target="_blank"> must carry rel="noreferrer noopener" — opening
  // an attacker-controlled URL without these leaks window.opener access and
  // referrer to the destination.
  const anchors = html.match(/<a [^>]*target="_blank"[^>]*>/g) || [];
  if (!anchors.length) return null;
  const bad = anchors.filter(a => {
    const m = a.match(/\brel="([^"]*)"/);
    if (!m) return true;
    const rel = m[1];
    return !rel.includes("noreferrer") || !rel.includes("noopener");
  });
  if (bad.length) {
    return `${bad.length}/${anchors.length} target=_blank links missing rel=noreferrer noopener`;
  }
  return "";
}

function checkTraceBarContainment(html) {
  // Every waterfall bar must satisfy left% + width% <= 100. Bars that overflow
  // the track render outside the row — they look like the trace went past the
  // total duration, which is wrong (and typically caused by start_ms outside
  // [0, total_duration_ms]).
  const re = /left:\s*([\d.]+)%; width:\s*([\d.]+)%/g;
  const issues = [];
  let m;
  let saw = false;
  while ((m = re.exec(html)) !== null) {
    saw = true;
    const sum = parseFloat(m[1]) + parseFloat(m[2]);
    // 0.5% slack for floating-point noise
    if (sum > 100.5) {
      issues.push(`bar at left=${m[1]}% width=${m[2]}% overflows track (sum=${sum.toFixed(2)}%)`);
    }
  }
  if (!saw) return null;
  return issues.length ? issues.slice(0, 3).join("; ") : "";
}

function checkArtifactLandmark(html) {
  // The top-level <article> should expose an accessible name so it can be
  // announced as a region in screen-reader landmark navigation. Either an
  // aria-labelledby pointing to the title, or an aria-label, satisfies this.
  const article = html.match(/<article class="hr-artifact"[^>]*>/);
  if (!article) return null;
  const tag = article[0];
  if (!/\baria-(labelledby|label)=/.test(tag)) {
    return "<article> has no aria-label / aria-labelledby — not announced as a named region";
  }
  return "";
}

function scoreHtmlQuality(html, manifest) {
  const checks = [
    ["escaping", checkHtmlEscaping(html, manifest)],
    ["aria_sort", checkSortableAriaSort(html)],
    ["sort_keyboard", checkSortableKeyboard(html)],
    ["status_map", checkStatusCellMapping(html)],
    ["link_safety", checkLinkSafety(html)],
    ["trace_bar_containment", checkTraceBarContainment(html)],
    ["landmark", checkArtifactLandmark(html)],
  ];
  const issues = [];
  const okSubchecks = [];
  const skipped = [];
  for (const [name, result] of checks) {
    if (result === null) skipped.push(name);
    else if (result === "") okSubchecks.push(name);
    else issues.push(`${name}: ${result}`);
  }
  return {
    pass: issues.length === 0,
    note: issues.length
      ? issues.join(" | ")
      : `passed [${okSubchecks.join(",") || "none-applicable"}]${skipped.length ? `, skipped [${skipped.join(",")}]` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Run a single case end-to-end.
// ---------------------------------------------------------------------------

function runCase(testCase, validateSchema) {
  const { id, category, prompt, expected, manifest } = testCase;
  const result = {
    id,
    category,
    prompt,
    expected,
    scores: {},
    summary: { passed: 0, failed: 0, total: 7 },
    error: null,
  };

  // 1) Manifest validity (against the JSON-Schema contract)
  const schemaOk = validateSchema(manifest);
  result.scores.manifest_validity = {
    pass: schemaOk,
    note: schemaOk
      ? "valid against schemas/manifest.schema.json"
      : (validateSchema.errors || [])
          .map(e => `${e.instancePath || "/"}: ${e.message}`)
          .slice(0, 3)
          .join("; "),
  };

  // Even if schema invalid, the engine has its own lightweight validator —
  // surface that too as a diagnostic.
  const engineV = validateManifest(manifest);
  result.engine_validation = engineV;

  // 2-5) Shell, widget relevance, count, density — only meaningful if we can
  //      plan a layout. If the engine validator rejects it, planLayout would
  //      crash; protect with try/catch and mark all four as fail.
  let plan = null;
  try {
    plan = planLayout(manifest);
    result.plan = {
      shell: plan.shell,
      densityUsed: plan.densityUsed,
      budget: plan.budget,
      drawer: plan.drawer.length,
      slots: Object.fromEntries(
        Object.entries(plan.slots).map(([k, v]) => [k, v.map(w => w.type)])
      ),
    };
  } catch (err) {
    result.error = `planLayout threw: ${err.message}`;
  }

  if (plan) {
    result.scores.shell_selection = scoreShell(plan, expected);
    result.scores.density_budget = scoreDensityBudget(plan, manifest);
  } else {
    result.scores.shell_selection = { pass: false, note: "no plan (manifest unprocessable)" };
    result.scores.density_budget = { pass: false, note: "no plan" };
  }
  result.scores.widget_relevance = scoreWidgetRelevance(manifest, expected);
  result.scores.widget_count = scoreWidgetCount(manifest, expected);

  // 6) Rendering — renderManifest is documented to never throw
  let html = "";
  try {
    cacheClear();
    html = renderManifest(manifest, { prompt });
    result.html_length = html.length;
  } catch (err) {
    result.error = (result.error ? result.error + " | " : "") + `renderManifest threw: ${err.message}`;
  }
  result.scores.rendering = scoreRendering(html);
  result.scores.html_quality = scoreHtmlQuality(html, manifest);

  // Summary
  for (const s of Object.values(result.scores)) {
    if (s.pass) result.summary.passed++; else result.summary.failed++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Aggregate.
// ---------------------------------------------------------------------------

function aggregate(results) {
  const dims = ["manifest_validity", "shell_selection", "widget_relevance", "widget_count", "density_budget", "rendering", "html_quality"];
  const overall = { total_cases: results.length, all_dim_pass: 0, per_dim: {} };
  for (const d of dims) overall.per_dim[d] = { pass: 0, fail: 0 };
  const byCategory = {};
  for (const r of results) {
    if (r.summary.failed === 0) overall.all_dim_pass++;
    for (const d of dims) {
      if (r.scores[d] && r.scores[d].pass) overall.per_dim[d].pass++;
      else overall.per_dim[d].fail++;
    }
    byCategory[r.category] ??= { total: 0, all_dim_pass: 0, per_dim: {} };
    for (const d of dims) byCategory[r.category].per_dim[d] ??= { pass: 0, fail: 0 };
    byCategory[r.category].total++;
    if (r.summary.failed === 0) byCategory[r.category].all_dim_pass++;
    for (const d of dims) {
      if (r.scores[d] && r.scores[d].pass) byCategory[r.category].per_dim[d].pass++;
      else byCategory[r.category].per_dim[d].fail++;
    }
  }
  return { overall, byCategory };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  await bootstrapRenderer();
  const validateSchema = await buildSchemaValidator();

  const results = CASES.map(c => runCase(c, validateSchema));
  const summary = aggregate(results);

  const output = {
    generated_at: new Date().toISOString(),
    renderer_branch: "feature/hybrid-renderer",
    total_prompts: results.length,
    categories: CATEGORIES,
    summary,
    results,
  };

  await writeFile(
    resolve(__dirname, "hybrid-renderer-eval-results.json"),
    JSON.stringify(output, null, 2)
  );

  // Console summary
  const dims = ["manifest_validity", "shell_selection", "widget_relevance", "widget_count", "density_budget", "rendering", "html_quality"];
  console.log(`\nHybrid renderer eval — ${results.length} prompts`);
  console.log(`  All-dimensions pass: ${summary.overall.all_dim_pass}/${results.length} (${((summary.overall.all_dim_pass / results.length) * 100).toFixed(1)}%)`);
  for (const d of dims) {
    const p = summary.overall.per_dim[d].pass;
    console.log(`  ${d.padEnd(20)} ${p}/${results.length}`);
  }
  console.log("\nFailures:");
  let failures = 0;
  for (const r of results) {
    if (r.summary.failed > 0) {
      failures++;
      const failed = Object.entries(r.scores).filter(([, v]) => !v.pass).map(([k]) => k).join(",");
      console.log(`  [${r.id}] ${r.prompt.slice(0, 60)}…  fails=[${failed}]`);
    }
  }
  if (!failures) console.log("  (none)");

  return output;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
