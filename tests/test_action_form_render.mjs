// Renders data/manifests/create-alarm.manifest.json through the full
// pipeline (renderer/render.js) and asserts the HTML contains the
// expected form elements. Run with:
//
//   node tests/test_action_form_render.mjs
//
// Exits non-zero on any failed assertion.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  preloadShells,
  renderManifest,
  validateManifest,
  planLayout,
} from "../renderer/render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

// 1. Load shells synchronously (test environment has no fetch).
const shellNames = ["single-focus", "investigation", "dashboard"];
const shellMap = Object.fromEntries(
  shellNames.map(name => [
    name,
    readFileSync(join(ROOT, "renderer", "shells", `${name}.html`), "utf8"),
  ]),
);
preloadShells(shellMap);

// 2. Load the manifest from disk — no hand-built object.
const manifestPath = join(ROOT, "data", "manifests", "create-alarm.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

console.log(`\nRender pipeline: ${manifestPath}`);

// 3. Validate.
const v = validateManifest(manifest);
check("manifest validates", v.ok, v.errors.join("; "));

// 4. Layout.
const plan = planLayout(manifest);
check("infers single-focus shell (density-3 widget)", plan.shell === "single-focus", `got ${plan.shell}`);
check("density used > 0", plan.densityUsed > 0);
check("no drawer overflow on single widget", plan.drawer.length === 0);

// 5. Render.
const html = renderManifest(manifest);
check("renderManifest returns a non-empty string", typeof html === "string" && html.length > 100);

// 6. Structural assertions on the HTML.
const must = [
  ['hr-artifact wrapper present', 'class="hr-artifact"'],
  ['single-focus shell selected', 'data-shell="single-focus"'],
  ['action_form widget rendered', 'widget-action-form'],
  ['action_id attribute on widget', 'data-action-id="create_metric_alarm"'],
  ['form element', '<form'],
  ['novalidate', 'novalidate'],
  ['onsubmit blocked', 'onsubmit="return false;"'],
  ['Tier badge', 'Tier 4'],
  ['safety block rendered', 'af-safety'],
  ['safety note text', 'Tier 4 write'],
  ['context block — region', 'us-east-1'],
  ['context block — account', '123456789012'],
  ['context block — service', 'checkout-api'],
  ['AlarmName field label', 'Alarm name'],
  ['AlarmName prefilled value', 'checkout-api-Lambda-Errors-Sum-Critical'],
  ['Statistic select', '<select'],
  ['Statistic option Sum selected', 'value="Sum" selected'],
  ['ComparisonOperator option selected', 'value="GreaterThanThreshold" selected'],
  ['TreatMissingData option selected', 'value="notBreaching" selected'],
  ['Period number input', 'type="number"'],
  ['Period prefilled value 60', 'value="60"'],
  ['Threshold prefilled value 5', 'value="5"'],
  ['Dimensions textarea', '<textarea'],
  ['recommended source label visible', 'af-source-label'],
  ['CLI block present', 'af-cli-block'],
  ['CLI label "Copy CLI command"', 'Copy CLI command'],
  ['Copy button wired', 'data-copy-target='],
  ['CLI text contains aws cloudwatch', 'aws cloudwatch put-metric-alarm'],
  ['Deep link button', 'href="https://us-east-1.console.aws.amazon.com'],
  ['Reset button', 'type="reset"'],
  ['validation pattern surfaced on input', 'pattern="^[A-Za-z0-9_'],
];

for (const [name, needle] of must) {
  check(name, html.includes(needle), `missing: ${needle}`);
}

// 7. Negative assertions — security / safety properties.
const mustNot = [
  ['no action attribute on form (no submit target)', /<form[^>]*\saction=/],
  ['no method=post', /<form[^>]*\smethod=/i],
  ['no script tags injected from data', /<script/i],
  ['CLI command escaped (no raw double-dash injection)', /onerror=|<img\s/i],
];

for (const [name, regex] of mustNot) {
  check(name, !regex.test(html), `unexpected match for ${regex}`);
}

// 8. Persist rendered output for browser preview verification.
const renderedDir = join(ROOT, "data", "rendered");
const outPath = join(renderedDir, "create-alarm.html");
const fullPage = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Create Alarm — rendered preview</title>
<link rel="stylesheet" href="../../renderer/styles.css" />
<style>body { background:#0a121c; margin:0; padding:24px; font-family:"Open Sans","Segoe UI",sans-serif; } .frame { max-width:900px; margin:0 auto; }</style>
</head>
<body>
<div class="frame">
${html}
</div>
<script type="module">
import { bindInteractions } from "../../renderer/interactions.js";
bindInteractions(document.querySelector(".frame"));
</script>
</body>
</html>
`;
writeFileSync(outPath, fullPage);
console.log(`\nWrote ${outPath}`);

// Summary.
console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
