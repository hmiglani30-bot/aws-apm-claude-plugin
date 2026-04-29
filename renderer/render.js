// render.js — public entry point.
//
// Single function the skill calls after the LLM emits a manifest:
//
//   await initRenderer({ shellsBaseUrl })   // once at startup
//   const html = renderManifest(manifestJSON, { prompt })
//
// renderManifest is synchronous, deterministic, and never throws on bad input —
// invalid manifests fall back to the investigation shell with a raw data table.
//
// Optional manifest cache: when a `prompt` is supplied, identical
// (prompt, query_intent) pairs return the cached HTML for 30 minutes.

import { renderToHtml, validateManifest, planLayout, inferShell } from "./engine.js";
import { loadShells, preloadShellsSync } from "./shells/index.js";
import { makeCacheKey, get as cacheGet, set as cacheSet, clear as cacheClear } from "./cache.js";

let initPromise = null;

export function initRenderer(opts = {}) {
  if (!initPromise) {
    initPromise = loadShells(opts.shellsBaseUrl || "./shells/");
  }
  return initPromise;
}

// For test environments / non-fetch contexts, callers can preload shell HTML
// directly rather than going through fetch. Marks init as complete.
export function preloadShells(shellMap) {
  preloadShellsSync(shellMap);
  initPromise = Promise.resolve();
}

export function renderManifest(manifest, opts = {}) {
  const queryIntent = manifest && manifest.metadata && manifest.metadata.query_intent;
  const cacheKey = opts.prompt ? makeCacheKey(opts.prompt, queryIntent) : null;

  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;
  }

  const html = renderToHtml(manifest);

  if (cacheKey) cacheSet(cacheKey, html);

  return html;
}

// Re-exports for callers that want lower-level access (validation-only,
// layout planning, manual cache ops).
export { validateManifest, planLayout, inferShell, cacheClear };
