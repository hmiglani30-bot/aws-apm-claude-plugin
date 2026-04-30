#!/usr/bin/env node
// render-standalone.mjs — CLI wrapper that reads a manifest JSON,
// runs it through the hybrid renderer, and writes a complete standalone HTML file.
//
// Usage: node render-standalone.mjs <manifest.json> <output.html>

import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(__dirname, "renderer");

// --- Load shell templates from disk (skip fetch) ---
const shellNames = ["single-focus", "investigation", "dashboard"];
const shellMap = {};
for (const name of shellNames) {
  shellMap[name] = readFileSync(join(rendererDir, "shells", `${name}.html`), "utf8");
}

// --- Import renderer ---
const { preloadShells, renderManifest } = await import(join(rendererDir, "render.js"));
preloadShells(shellMap);

// --- Read CSS ---
const css = readFileSync(join(rendererDir, "styles.css"), "utf8");

// --- Read interactions JS ---
let interactionsJs = "";
try {
  interactionsJs = readFileSync(join(rendererDir, "interactions.js"), "utf8");
} catch { /* optional */ }

// --- Read manifest ---
const manifestPath = process.argv[2];
const outputPath = process.argv[3];

if (!manifestPath || !outputPath) {
  console.error("Usage: node render-standalone.mjs <manifest.json> <output.html>");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// --- Render ---
const artifactHtml = renderManifest(manifest, { prompt: manifest.metadata?.query_intent || "" });

// --- Wrap in full HTML document ---
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${(manifest.metadata?.title || "AWS APM").replace(/</g, "&lt;")}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #0a1018;
      min-height: 100vh;
    }
    ${css}
  </style>
</head>
<body>
  <div class="hr-artifact">
    ${artifactHtml}
  </div>
  ${interactionsJs ? `<script>\n${interactionsJs}\n</script>` : ""}
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Rendered: ${outputPath}`);
