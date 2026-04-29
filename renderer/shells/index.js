// Shell template loader. Shells live as .html files (authored form) and are loaded once
// at init. After init, the engine fills slot placeholders synchronously.
//
// Slot placeholders inside each shell:
//   {{HEADER}}, {{PRIMARY}}, {{CONTEXT}}, {{GRID}}, {{DRAWER}}
//
// A shell only contains the slots that apply to it; missing placeholders are left untouched.

const shellNames = ["single-focus", "investigation", "dashboard"];

const cache = new Map();

function stripTopComment(html) {
  // Strip the leading <!-- ... --> documentation block so it never reaches the rendered DOM.
  return html.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
}

export async function loadShells(baseUrl = "./shells/") {
  if (cache.size === shellNames.length) return cache;
  await Promise.all(shellNames.map(async name => {
    if (cache.has(name)) return;
    const url = `${baseUrl}${name}.html`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load shell ${name}: ${res.status}`);
    cache.set(name, stripTopComment(await res.text()));
  }));
  return cache;
}

export function getShell(name) {
  if (!cache.has(name)) {
    throw new Error(`Shell "${name}" not loaded. Call loadShells() first.`);
  }
  return cache.get(name);
}

// Used by the renderer's invalid-manifest fallback when shells failed to load.
// Mirrors the investigation shell exactly so the visual contract holds.
export const FALLBACK_SHELL = `<section class="hr-shell hr-shell-investigation" data-shell="investigation">
  <header class="hr-shell-header" data-slot="header">{{HEADER}}</header>
  <main class="hr-shell-primary" data-slot="primary">{{PRIMARY}}</main>
  <aside class="hr-shell-context" data-slot="context">{{CONTEXT}}</aside>
  {{DRAWER}}
</section>`;

export function preloadShellsSync(shellMap) {
  // Test-environment hook: lets harnesses inject shell HTML without going through fetch.
  for (const [name, html] of Object.entries(shellMap)) {
    cache.set(name, stripTopComment(html));
  }
}
