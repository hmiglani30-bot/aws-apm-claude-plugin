#!/usr/bin/env node
// CLI: render a manifest JSON to a self-contained HTML file.
//
// Usage:
//   node render-standalone.mjs <manifest.json> <out.html>
//
// Wraps renderer/render.js so it can run outside a browser. The output is a
// full HTML document with renderer/styles.css inlined and renderer/interactions.js
// embedded as a module script — viewable directly in any browser.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";

import {
  initRenderer,
  preloadShells,
  renderManifest,
} from "./renderer/render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  const shells = {};
  for (const name of ["single-focus", "investigation", "dashboard"]) {
    shells[name] = await readFile(
      resolve(__dirname, "renderer/shells", `${name}.html`),
      "utf8"
    );
  }
  preloadShells(shells);
  await initRenderer();
}

function htmlDoc({ title, styles, body, interactions }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #0a1018;
      min-height: 100vh;
    }
    ${styles}
  </style>
</head>
<body>
  <div class="hr-artifact">
    ${body}
  </div>
  <script>
${interactions}
  </script>
</body>
</html>`;
}

async function main() {
  const [, , manifestPath, outPath] = process.argv;
  if (!manifestPath || !outPath) {
    console.error("Usage: node render-standalone.mjs <manifest.json> <out.html>");
    process.exit(2);
  }

  await bootstrap();

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const styles = await readFile(resolve(__dirname, "renderer/styles.css"), "utf8");
  const interactions = await readFile(resolve(__dirname, "renderer/interactions.js"), "utf8");

  const body = renderManifest(manifest, { prompt: basename(manifestPath) });

  const title =
    (manifest && manifest.metadata && manifest.metadata.title) ||
    basename(manifestPath, ".manifest.json");

  await writeFile(outPath, htmlDoc({ title, styles, body, interactions }));
  console.log(`Rendered: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
