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
// belong in a lighter mode (per CLAUDE.md rule 6 intent taxonomy).
//
// Auto-detection — a skill is a "heavy investigation skill" if both:
//   (a) Body has at least 3 "### Phase N" headings (multi-phase RCA signal —
//       distinguishes investigations from one-shot reports).
//   (b) Skill produces a Tier-3 investigation artifact (named in the body),
//       OR its YAML description (the prose part, before any "Trigger
//       phrases:" block) contains "fix plan".
//
// This replaces the hardcoded ACTIVATION_GUARDED_SKILLS list — adding a new
// investigation skill to the repo automatically pulls it into the guarded
// set, so the next CI run will fail until a "When NOT to activate" section
// is added. The trip-wire pattern.
//
// We use Tier-3 artifact emission as the canonical signal because:
//   • It avoids the false-positive of skill names containing "triage"
//     (e.g. references to `error-spike-triage` in other skills' trigger
//     phrases) being read as that skill's own intent.
//   • It avoids the false-positive of "investigation" appearing in a
//     deferral phrase ("not the full breach investigation") being read as
//     activation intent.
//   • It is a structural property of the skill, not a vocabulary quirk.

const TIER_3_ARTIFACT_NAMES = [
  "Service Health Card",
  "SLO Breach Explainer",
  "Top Suspected Cause",
  "Trace Waterfall Summary",
];

function isHeavyInvestigationSkill(body) {
  // (a) Multi-phase signal — count ### Phase N headings.
  const phaseHeadings = (body.match(/^###\s+Phase\s+\d/gim) || []).length;
  if (phaseHeadings < 3) return false;

  // (b) Tier-3 artifact emission — match in body (artifact skills name
  // their output). Or "fix plan" in the YAML description.
  const emitsTier3Artifact = TIER_3_ARTIFACT_NAMES.some(name => body.includes(name));

  // YAML description: pull only the prose section, before "Trigger phrases:".
  const yamlEnd = body.indexOf("\n---", 4);
  const yaml = yamlEnd > 0 ? body.slice(0, yamlEnd) : body.slice(0, 1500);
  const descMatch = yaml.match(/description:\s*>([\s\S]*?)(?:\nmetadata:|\n---|$)/i);
  let desc = descMatch ? descMatch[1] : "";
  const triggerPhrasesIdx = desc.toLowerCase().indexOf("trigger phrases:");
  if (triggerPhrasesIdx > -1) desc = desc.slice(0, triggerPhrasesIdx);
  const hasFixPlan = /\bfix plan\b/i.test(desc);

  return emitsTier3Artifact || hasFixPlan;
}

function checkActivationGuard({ name, body }) {
  if (!isHeavyInvestigationSkill(body)) {
    return { name: "activation_guard", pass: true, note: "n/a (auto-detect: not a heavy investigation skill)" };
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
    note: pass ? "activation guard + deferral route present (auto-detected as investigation skill)" : reasons.join("; "),
  };
}

// Unfilled placeholders / quality markers in shipped skill or command text.
// Catches:
//   • TODO: / FIXME: / XXX: with colon (the conventional "this needs work"
//     marker — bare `<TODO>` inside angle brackets in documentation is fine)
//   • Literal placeholder shapes that should never reach a shipped doc:
//     {{TODO}}, {{FIXME}}, {{XXX}}, {{ }}, {{ ... }}, {{PLACEHOLDER}}.
// Skill files that document HTML-template placeholders (e.g. listing
// {{SERVICE_NAME}} in a "Placeholder reference" table) are NOT flagged —
// those are intentional documentation, not unfilled output.

// Quality markers that indicate genuinely unfilled / draft content. These
// must never appear in shipped skill, command, or template text.
//
// Note on `{{PLACEHOLDER}}`: skills in this repo legitimately reference the
// literal string `{{PLACEHOLDER}}` as a generic placeholder name when
// describing how artifact templates are populated (e.g., "Populate every
// `{{PLACEHOLDER}}`"). That is documentation, not an unfilled output, and is
// allowed. The check still catches genuinely-unfilled cases via the more
// specific TODO/FIXME/XXX-inside-{{}} pattern, the empty `{{ }}` case, and
// the placeholder-name `{{ ... }}` case.
const QUALITY_MARKER_PATTERNS = [
  { re: /\bTODO:/g, label: "TODO:" },
  { re: /\bFIXME:/g, label: "FIXME:" },
  { re: /\bXXX:/g, label: "XXX:" },
  { re: /\{\{\s*(?:TODO|FIXME|XXX|FILL_THIS|FILL THIS|HERE|FILL_HERE|REPLACE_ME|REPLACE ME)\s*\}\}/gi, label: "{{TODO/FIXME/XXX/FILL_HERE}}" },
  { re: /\{\{\s*\.\.\.\s*\}\}/g, label: "{{ ... }}" },
  { re: /\{\{\s*\}\}/g, label: "{{ }} (empty placeholder)" },
];

function checkQualityMarkers({ body }) {
  const hits = [];
  for (const { re, label } of QUALITY_MARKER_PATTERNS) {
    const matches = body.match(re);
    if (matches) hits.push(`${label} ×${matches.length}`);
  }
  return {
    name: "quality_markers",
    pass: hits.length === 0,
    note: hits.length === 0 ? "no TODO/FIXME/XXX/unfilled placeholders" : `unfilled markers: ${hits.join(", ")}`,
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
    checkQualityMarkers(skill),
  ];
  const passed = checks.filter(c => c.pass).length;
  return { name: skill.name, checks, passed, total: checks.length };
}

function runCommandChecks(cmd) {
  // Commands are thinner — divergence vocabulary + quality markers only.
  const checks = [
    checkDivergenceVocabulary(cmd),
    checkQualityMarkers(cmd),
  ];
  const passed = checks.filter(c => c.pass).length;
  return { name: cmd.name, checks, passed, total: checks.length };
}

// ---------------------------------------------------------------------------
// Cohort E — artifact-template shareability + deep-link + safety checks.
//
// These are the product-claim assertions in evals/eval-prompts.md cohort E
// that can be verified statically against the templates under artifacts/.
// Live AWS testing still validates the runtime substitution, but the
// templates' structural commitments are checkable from the source files.
// ---------------------------------------------------------------------------

// Most artifact templates describe an AWS resource (a service, an SLO, a
// trace, an alarm portfolio, a CloudTrail window) and so MUST surface
// region + account in their footer for cross-account / cross-region setups.
// The observability gap report is the lone exception: it audits a
// codebase, not an AWS resource, so AWS_ACCOUNT does not apply.
// observability-gap-report audits a codebase, not an AWS resource — neither
// region nor account belongs in its hero. The exempt set covers the region
// AND account requirements; AWS-resource artifacts must have both.
const ARTIFACT_REGION_ACCOUNT_EXEMPT = new Set([
  "observability-gap-report.html",
]);

// External-resource patterns that would break offline / shareable rendering.
// Any HTTP(S) reference inside a <link rel="stylesheet">, <script src=>,
// <img src=> tag, or @import / url() in a <style> block is a fail. AWS
// console links inside <a href="..."> are obviously fine — those are the
// whole point of the deep-link block.
const EXTERNAL_RESOURCE_PATTERNS = [
  { re: /<link[^>]+\bhref\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi, label: "external <link href=>" },
  { re: /<script[^>]+\bsrc\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi, label: "external <script src=>" },
  { re: /<img[^>]+\bsrc\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi, label: "external <img src=>" },
  { re: /@import\s+(?:url\()?["']https?:\/\//gi, label: "@import https" },
  { re: /url\(\s*["']?https?:\/\//gi, label: "url(https://...)" },
];

function checkTemplatePlaceholders({ name, body }) {
  // Templates legitimately contain {{NAMED_PLACEHOLDERS}}. We're looking for
  // the *unfilled / malformed* variety only — same patterns as the
  // skill-text quality markers, plus one template-specific case where a
  // designer left a comment-style "FIXME-FILL-ME" as the placeholder.
  const hits = [];
  for (const { re, label } of QUALITY_MARKER_PATTERNS) {
    const matches = body.match(re);
    if (matches) hits.push(`${label} ×${matches.length}`);
  }
  return {
    name: "no_unfilled_placeholders",
    pass: hits.length === 0,
    note: hits.length === 0 ? "no TODO/FIXME/XXX/empty placeholders in template" : `unfilled markers: ${hits.join(", ")}`,
  };
}

function checkTemplateNoExternalResources({ body }) {
  const hits = [];
  for (const { re, label } of EXTERNAL_RESOURCE_PATTERNS) {
    const matches = body.match(re);
    if (matches) hits.push(`${label} ×${matches.length}`);
  }
  return {
    name: "no_external_resources",
    pass: hits.length === 0,
    note: hits.length === 0 ? "self-contained (no CDN / external CSS / JS / fonts)" : `external resources detected: ${hits.join(", ")}`,
  };
}

function checkTemplateShareability({ name, body }) {
  // S1 title — every artifact template must name its primary subject in the
  // hero (service, SLO, trace ID, investigation, alarm-portfolio scope, etc.)
  const titleNames = [
    "SERVICE_NAME", "SLO_NAME", "TRACE_ID_SHORT", "INVESTIGATION_TITLE",
    "INCIDENT_TITLE", "ANALYZED_PATH", "PLAN_TITLE", "REPORT_TITLE",
    "SCOPE", "TIME_RANGE_START",
  ];
  const hasTitle =
    titleNames.some(t => new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`).test(body)) ||
    /<h1[^>]*>[\s\S]{1,200}<\/h1>/i.test(body);

  // S3 region + account — both must appear in templates that describe AWS
  // resources. The exempt set is for code-audit artifacts where neither
  // region nor account is meaningful.
  const awsResourceArtifact = !ARTIFACT_REGION_ACCOUNT_EXEMPT.has(name);
  const hasRegion = /\{\{\s*AWS_REGION\s*\}\}/.test(body);
  const hasAccount = /\{\{\s*AWS_ACCOUNT\s*\}\}/.test(body);

  // S2 time window — at least one window-naming placeholder.
  const windowNames = [
    "GENERATED_AT", "TIME_WINDOW", "TIME_RANGE", "TIME_RANGE_START", "TIME_RANGE_END",
    "BREACH_START_ISO", "TRACE_TIMESTAMP", "INCIDENT_DATE", "INVESTIGATION_WINDOW",
  ];
  const hasWindow = windowNames.some(t => new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`).test(body));

  // S7 deep links — at least one {{LINK_*}} placeholder.
  const hasDeepLinks = /\{\{\s*LINK_[A-Z_]+\s*\}\}/.test(body);

  const issues = [];
  if (!hasTitle) issues.push("title (S1) — no hero / titled-subject placeholder");
  if (awsResourceArtifact && !hasRegion) issues.push("region (S3a) — missing {{AWS_REGION}}");
  if (awsResourceArtifact && !hasAccount) issues.push("account (S3b) — missing {{AWS_ACCOUNT}}");
  if (!hasWindow) issues.push("time window (S2) — no GENERATED_AT / TIME_RANGE / equivalent");
  if (!hasDeepLinks) issues.push("deep links (S7) — no {{LINK_*}} block");

  return {
    name: "shareability_fields",
    pass: issues.length === 0,
    note: issues.length === 0
      ? "title + " + (awsResourceArtifact ? "region + account + " : "(region/account exempt — code audit) + ") + "window + deep-link block"
      : issues.join("; "),
  };
}

function checkTemplateInvestigationFields({ name, body }) {
  // Investigation artifacts (the four heavy Tier-3 templates) must have:
  //   • Confidence placeholder  — every cited cause / finding ships with a
  //     Low/Medium/High confidence indicator
  //   • "Open in CloudWatch"-style text near the deep link block — the
  //     reader needs to know the link block is the AWS console doorway
  //   • A hero / copyable summary placeholder so the verdict line can be
  //     selected and pasted into Slack
  const investigationArtifacts = new Set([
    "service-health-card.html",
    "slo-breach-explainer.html",
    "top-suspected-cause.html",
    "trace-waterfall.html",
    "investigation-summary.html",
    "alerting-plan.html",
  ]);
  if (!investigationArtifacts.has(name)) {
    return { name: "investigation_fields", pass: true, note: "n/a (not an investigation artifact)" };
  }

  const hasConfidence =
    /\{\{\s*(?:CONFIDENCE|HERO_CONFIDENCE|ATTRIBUTION_CONFIDENCE)\s*\}\}/.test(body);

  const hasOpenInCloudWatch =
    /open in cloudwatch|open in console|aws console|cloudwatch console/i.test(body);

  const heroNames = [
    "HERO_VERDICT_LINE", "HERO_VERDICT", "HERO_TOP_OBSERVATION",
    "HERO_TOP_HYPOTHESIS", "HERO_TIME_HOG", "HERO_NEXT_ACTION",
    "EXEC_SUMMARY", "VERDICT", "BURN_CLASSIFICATION",
  ];
  const hasHero = heroNames.some(t => new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`).test(body));

  const issues = [];
  if (!hasConfidence) issues.push("confidence — no {{CONFIDENCE}} / {{HERO_CONFIDENCE}} / {{ATTRIBUTION_CONFIDENCE}}");
  if (!hasOpenInCloudWatch) issues.push('"Open in CloudWatch" — no console-doorway language near the deep-link block');
  if (!hasHero) issues.push("copyable summary — no hero verdict / next-action placeholder for select-copy");

  return {
    name: "investigation_fields",
    pass: issues.length === 0,
    note: issues.length === 0
      ? "confidence + Open-in-CloudWatch + copyable hero summary present"
      : issues.join("; "),
  };
}

function runArtifactChecks(artifact) {
  const checks = [
    checkTemplatePlaceholders(artifact),
    checkTemplateNoExternalResources(artifact),
    checkTemplateShareability(artifact),
    checkTemplateInvestigationFields(artifact),
  ];
  const passed = checks.filter(c => c.pass).length;
  return { name: artifact.name, checks, passed, total: checks.length };
}

async function loadArtifacts() {
  const dir = resolve(ROOT, "artifacts");
  const entries = await readdir(dir);
  const out = [];
  for (const f of entries.filter(e => e.endsWith(".html"))) {
    const path = resolve(dir, f);
    out.push({ name: f, path, body: await readFile(path, "utf8") });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const json = process.argv.includes("--json");

  const skills = await Promise.all(SKILL_NAMES.map(loadSkill));
  const commands = await loadCommands();
  const artifacts = await loadArtifacts();

  const skillResults = skills.map(runSkillChecks);
  const commandResults = commands.map(runCommandChecks);
  const artifactResults = artifacts.map(runArtifactChecks);

  const skillsPassed = skillResults.filter(r => r.passed === r.total).length;
  const commandsPassed = commandResults.filter(r => r.passed === r.total).length;
  const artifactsPassed = artifactResults.filter(r => r.passed === r.total).length;

  const summary = {
    skills: { total: skillResults.length, all_pass: skillsPassed },
    commands: { total: commandResults.length, all_pass: commandsPassed },
    artifacts: { total: artifactResults.length, all_pass: artifactsPassed },
    per_check: {},
  };
  const skillDims = [
    "size", "divergence_vocabulary", "cross_skill_refs",
    "rendering_lock", "text_only_escape", "activation_guard",
    "quality_markers",
  ];
  const artifactDims = [
    "no_unfilled_placeholders", "no_external_resources",
    "shareability_fields", "investigation_fields",
  ];
  for (const d of skillDims) {
    summary.per_check[d] = { pass: 0, fail: 0 };
    for (const r of skillResults) {
      const c = r.checks.find(x => x.name === d);
      if (!c) continue;
      if (c.pass) summary.per_check[d].pass++;
      else summary.per_check[d].fail++;
    }
  }
  for (const d of artifactDims) {
    summary.per_check[d] = { pass: 0, fail: 0 };
    for (const r of artifactResults) {
      const c = r.checks.find(x => x.name === d);
      if (!c) continue;
      if (c.pass) summary.per_check[d].pass++;
      else summary.per_check[d].fail++;
    }
  }

  if (json) {
    console.log(JSON.stringify({
      summary,
      skills: skillResults,
      commands: commandResults,
      artifacts: artifactResults,
    }, null, 2));
    return;
  }

  console.log(`\nSkill-routing + artifact static eval`);
  console.log(`  Skills:    ${skillsPassed}/${skillResults.length} all-checks-pass`);
  console.log(`  Commands:  ${commandsPassed}/${commandResults.length} all-checks-pass`);
  console.log(`  Artifacts: ${artifactsPassed}/${artifactResults.length} all-checks-pass (Cohort E static)`);
  console.log(`\nBy skill / command check:`);
  for (const d of skillDims) {
    const p = summary.per_check[d];
    console.log(`  ${d.padEnd(24)} ${p.pass} pass · ${p.fail} fail`);
  }
  console.log(`\nBy artifact check:`);
  for (const d of artifactDims) {
    const p = summary.per_check[d];
    console.log(`  ${d.padEnd(24)} ${p.pass} pass · ${p.fail} fail`);
  }
  console.log(`\nFailures:`);
  let any = false;
  for (const r of [...skillResults, ...commandResults, ...artifactResults]) {
    const failed = r.checks.filter(c => !c.pass);
    if (!failed.length) continue;
    any = true;
    console.log(`  [${r.name}]`);
    for (const c of failed) console.log(`    - ${c.name}: ${c.note}`);
  }
  if (!any) console.log("  (none)");

  // Non-zero exit when any check fails — useful in CI.
  const hardFail =
    skillResults.some(r => r.checks.some(c => !c.pass)) ||
    commandResults.some(r => r.checks.some(c => !c.pass)) ||
    artifactResults.some(r => r.checks.some(c => !c.pass));
  if (hardFail) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
