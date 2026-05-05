// Static skill-routing eval.
//
// The natural-language eval prompts in eval-prompts.md need a live model to
// score. This static analyzer is the cheap, in-CI proxy: it scans the skill
// and command files for known divergence-risk patterns, chain depth, and
// word budgets, and fails the build when any threshold is exceeded.
//
// Findings are advisory — the goal is to keep the skill text from drifting
// back into "narrate the rendering pipeline" territory between releases.
//
// Run:
//   node evals/skill-routing-static.mjs            # human summary
//   node evals/skill-routing-static.mjs --json     # machine output

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Tunables — every threshold is here so it's easy to relax/tighten.
// ---------------------------------------------------------------------------

// Skills are ordered by how much pipeline-internal vocabulary they're
// allowed to use. Investigation skills MUST stay user-facing; the rendering-
// layer skills (hybrid-renderer, widget-catalog) are *exempt* because they
// are by definition about the pipeline.
const PIPELINE_VOCABULARY_EXEMPT = new Set([
  "hybrid-renderer",
  "widget-catalog",
]);

// Words that, when found inside an investigation skill body or command
// instructions, suggest the model has been trained to *narrate* internal
// pipeline behavior to the user instead of using it silently.
const DIVERGENCE_TOKENS = [
  "density budget",
  "shell selection",
  "manifest schema",
  "manifest validity",
  "single-focus shell",
  "investigation shell",
  "dashboard shell",
  "slot overflow",
  "renderer pipeline",
  "rendering pipeline",
  "rendering grammar",
  "rendering philosophy",
  "visual grammar",
];

// Hard upper bound on how many *other* skills a single skill chains to.
// Exceeding this means the chain is too deep — every cross-skill mention is
// a potential extra round-trip in the runtime. The cap accommodates the
// canonical max workflow (slo-breach-investigation): ~11 sibling skills for
// the operational chain (artifact, validator, ownership, deep-link, handoff
// alternates, copy-to-incident, etc.) plus the mandatory `hybrid-renderer`
// and `widget-catalog` rendering-lock refs, plus the two deferral pointers
// added by the "When NOT to activate" section (`slo-burn-rate` and
// `slo-compliance-report`). Anything above 15 is suspicious.
const MAX_CROSS_SKILL_REFS = 15;

// Skills below this size are healthy. Above MAX_LINES, the skill is a
// maintenance burden and likely a divergence vector. Hard cap at HARD_LINES;
// anything over that is a fail.
const SOFT_LINES = 350;
const HARD_LINES = 700;

const SKILL_NAMES = [
  "alarm-response",
  "alerting-design",
  "aws-apm-setup",
  "cloudtrail-explorer",
  "copy-to-incident",
  "create-alarm",
  "error-spike-triage",
  "hybrid-renderer",
  "incident-memory",
  "investigation-validator",
  "latency-regression",
  "observability-gap-analysis",
  "open-in-cloudwatch",
  "service-health-card",
  "service-ownership",
  "slo-breach-explainer",
  "slo-breach-investigation",
  "slo-burn-rate",
  "slo-compliance-report",
  "top-suspected-cause",
  "trace-to-code",
  "trace-waterfall-summary",
  "widget-catalog",
];

const RENDERING_LOCK_TOKENS = [
  "hybrid-renderer",
  "widget-catalog",
  "render-standalone.mjs",
  "manifest",
];

// Investigation skills that produce visual artifacts MUST cite the rendering
// path explicitly so the runtime model knows to delegate, not hand-author.
const INVESTIGATION_SKILLS = [
  "alarm-response",
  "error-spike-triage",
  "latency-regression",
  "slo-breach-investigation",
  "slo-compliance-report",
  "service-health-card",
  "alerting-design",
  "create-alarm",
];

// ---------------------------------------------------------------------------
// Loaders.
// ---------------------------------------------------------------------------

async function loadSkill(name) {
  const path = resolve(ROOT, "skills", name, "SKILL.md");
  const body = await readFile(path, "utf8");
  return { name, path, body };
}

async function loadCommands() {
  const dir = resolve(ROOT, "commands");
  const entries = await readdir(dir);
  const out = [];
  for (const f of entries.filter(e => e.endsWith(".md"))) {
    const path = resolve(dir, f);
    out.push({ name: basename(f, ".md"), path, body: await readFile(path, "utf8") });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks.
// ---------------------------------------------------------------------------

function checkDivergenceVocabulary({ name, body }) {
  if (PIPELINE_VOCABULARY_EXEMPT.has(name)) {
    return { name: "divergence_vocabulary", pass: true, note: "exempt (rendering-layer skill)" };
  }
  const hits = [];
  const lower = body.toLowerCase();
  for (const t of DIVERGENCE_TOKENS) {
    const re = new RegExp(`\\b${t.replace(/\s+/g, "\\s+")}\\b`, "g");
    const matches = lower.match(re);
    if (matches) hits.push(`${t} (${matches.length})`);
  }
  return {
    name: "divergence_vocabulary",
    pass: hits.length === 0,
    note: hits.length ? `pipeline vocabulary leaked: ${hits.join(", ")}` : "clean",
  };
}

function checkCrossSkillRefs({ name, body }) {
  const refs = new Set();
  for (const other of SKILL_NAMES) {
    if (other === name) continue;
    const re = new RegExp("`" + other + "`", "g");
    if (re.test(body)) refs.add(other);
  }
  const count = refs.size;
  return {
    name: "cross_skill_refs",
    pass: count <= MAX_CROSS_SKILL_REFS,
    note: count <= MAX_CROSS_SKILL_REFS
      ? `${count} refs (cap ${MAX_CROSS_SKILL_REFS})`
      : `${count} refs exceeds cap ${MAX_CROSS_SKILL_REFS}: ${[...refs].join(", ")}`,
    count,
    refs: [...refs],
  };
}

function checkSize({ body }) {
  const lines = body.split("\n").length;
  if (lines > HARD_LINES) {
    return { name: "size", pass: false, note: `${lines} lines exceeds hard cap ${HARD_LINES}` };
  }
  if (lines > SOFT_LINES) {
    return { name: "size", pass: true, note: `${lines} lines (soft cap ${SOFT_LINES} — review)` };
  }
  return { name: "size", pass: true, note: `${lines} lines` };
}

function checkRenderingLock({ name, body }) {
  if (!INVESTIGATION_SKILLS.includes(name)) {
    return { name: "rendering_lock", pass: true, note: "n/a (not an investigation skill)" };
  }
  const lower = body.toLowerCase();
  const present = RENDERING_LOCK_TOKENS.filter(t => lower.includes(t.toLowerCase()));
  // The skill must reference at least the pipeline name AND mention not authoring HTML.
  const mentionsPipeline = present.length >= 2;
  // The forbid-language must appear verbatim near the rendering-lock callout.
  // We accept "do not / never" + an "author / hand-author / generate / emit /
  // write" verb + "html" within the next ~20 chars (allowing backticks,
  // angle brackets, "raw / an / your own / new" qualifiers).
  const forbidPattern =
    /(?:do not|never|don't)\s+(?:hand[- ]?author|author|generate|emit|write|paste)[^.\n]{0,40}\bhtml/i;
  const forbidsHandAuthoredHtml = forbidPattern.test(body);
  const pass = mentionsPipeline && forbidsHandAuthoredHtml;
  const reasons = [];
  if (!mentionsPipeline) reasons.push("does not cite hybrid-renderer / widget-catalog / render-standalone.mjs");
  if (!forbidsHandAuthoredHtml) reasons.push("does not forbid hand-authored HTML");
  return {
    name: "rendering_lock",
    pass,
    note: pass
      ? `cites: [${present.join(", ")}] · forbids hand-authored HTML`
      : reasons.join("; "),
  };
}

function checkTextOnlyEscape({ name, body }) {
  // The hybrid-renderer skill must explicitly call out the text-only branch
  // — without it, the model defaults to widgets even for a single-number
  // lookup, which inflates latency and round-trips for trivial answers.
  if (name !== "hybrid-renderer") {
    return { name: "text_only_escape", pass: true, note: "n/a" };
  }
  const lower = body.toLowerCase();
  const hasTextOnly = lower.includes("text-only");
  const hasGate = /gate\s*\d/i.test(body);
  return {
    name: "text_only_escape",
    pass: hasTextOnly && hasGate,
    note: hasTextOnly && hasGate
      ? "text-only branch + decision gates documented"
      : "text-only branch missing or undocumented",
  };
}

// Heavy investigation skills MUST surface an explicit "do not activate for
// lookups / sweeps" escape, or the skill chain over-triggers on prompts that
// belong in a lighter mode (per CLAUDE.md rule 6 intent taxonomy). The check
// only applies to the four heavy investigation workflows; lighter skills
// (renderer, catalog, ownership, deep-link) don't have an activation budget
// big enough to warrant guarding.
const ACTIVATION_GUARDED_SKILLS = [
  "alarm-response",
  "error-spike-triage",
  "latency-regression",
  "slo-breach-investigation",
];

function checkActivationGuard({ name, body }) {
  if (!ACTIVATION_GUARDED_SKILLS.includes(name)) {
    return { name: "activation_guard", pass: true, note: "n/a (not a heavy investigation skill)" };
  }
  // Accept any of the canonical headings. Match the ## heading specifically
  // — a passing reference inside prose ("see When NOT to activate below")
  // does not satisfy the requirement.
  const headingPattern =
    /^##\s+(?:When NOT to activate|Do not activate|Lookup escape|When this should NOT activate)\b/im;
  const hasHeading = headingPattern.test(body);

  // The section must also tell the model what to do instead — otherwise the
  // guard is a prohibition without an escape route, which the model will
  // ignore in practice. Look for at least one "defer to" / "answer text-only"
  // / "route to" / "use <skill>" pattern within the body.
  const hasDeferral =
    /\b(?:defer to|answer text[- ]only|route (?:to|through)|use the\s+`[a-z-]+`|hand[- ]off to|prefer\s+`[a-z-]+`)\b/i.test(body);

  const pass = hasHeading && hasDeferral;
  const reasons = [];
  if (!hasHeading) reasons.push('missing a "When NOT to activate" / "Do not activate" / "Lookup escape" heading');
  if (!hasDeferral) reasons.push("section names no deferral target (text-only / sibling skill / direct MCP call)");
  return {
    name: "activation_guard",
    pass,
    note: pass ? "activation guard + deferral route present" : reasons.join("; "),
  };
}

function runSkillChecks(skill) {
  const checks = [
    checkSize(skill),
    checkDivergenceVocabulary(skill),
    checkCrossSkillRefs(skill),
    checkRenderingLock(skill),
    checkTextOnlyEscape(skill),
    checkActivationGuard(skill),
  ];
  const passed = checks.filter(c => c.pass).length;
  return { name: skill.name, checks, passed, total: checks.length };
}

function runCommandChecks(cmd) {
  // Commands are thinner — only the divergence-vocabulary check applies; the
  // command body should never paste pipeline internals at the user.
  const div = checkDivergenceVocabulary(cmd);
  return { name: cmd.name, checks: [div], passed: div.pass ? 1 : 0, total: 1 };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const json = process.argv.includes("--json");

  const skills = await Promise.all(SKILL_NAMES.map(loadSkill));
  const commands = await loadCommands();

  const skillResults = skills.map(runSkillChecks);
  const commandResults = commands.map(runCommandChecks);

  const skillsPassed = skillResults.filter(r => r.passed === r.total).length;
  const commandsPassed = commandResults.filter(r => r.passed === r.total).length;

  const summary = {
    skills: { total: skillResults.length, all_pass: skillsPassed },
    commands: { total: commandResults.length, all_pass: commandsPassed },
    per_check: {},
  };
  const dims = ["size", "divergence_vocabulary", "cross_skill_refs", "rendering_lock", "text_only_escape", "activation_guard"];
  for (const d of dims) {
    summary.per_check[d] = { pass: 0, fail: 0 };
    for (const r of skillResults) {
      const c = r.checks.find(x => x.name === d);
      if (!c) continue;
      if (c.pass) summary.per_check[d].pass++;
      else summary.per_check[d].fail++;
    }
  }

  if (json) {
    console.log(JSON.stringify({ summary, skills: skillResults, commands: commandResults }, null, 2));
    return;
  }

  console.log(`\nSkill-routing static eval`);
  console.log(`  Skills:   ${skillsPassed}/${skillResults.length} all-checks-pass`);
  console.log(`  Commands: ${commandsPassed}/${commandResults.length} all-checks-pass`);
  console.log(`\nBy check:`);
  for (const d of dims) {
    const p = summary.per_check[d];
    console.log(`  ${d.padEnd(24)} ${p.pass} pass · ${p.fail} fail`);
  }
  console.log(`\nFailures:`);
  let any = false;
  for (const r of [...skillResults, ...commandResults]) {
    const failed = r.checks.filter(c => !c.pass);
    if (!failed.length) continue;
    any = true;
    console.log(`  [${r.name}]`);
    for (const c of failed) console.log(`    - ${c.name}: ${c.note}`);
  }
  if (!any) console.log("  (none)");

  // Non-zero exit when any skill fails — useful in CI.
  const hardFail =
    skillResults.some(r => r.checks.some(c => !c.pass)) ||
    commandResults.some(r => r.checks.some(c => !c.pass));
  if (hardFail) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
