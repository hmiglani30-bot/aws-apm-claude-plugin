# Hybrid renderer evals

Programmatic evaluation of `renderer/render.js` against 52 prompts spanning 5
categories (error investigation, latency / performance, SLO / service health,
CloudTrail / security, mixed / complex). Each prompt has a hand-authored
manifest representing what a SKILL-following LLM would emit for that prompt.

Each case is scored on 6 dimensions:

1. **Manifest validity** — passes JSON-Schema validation against
   `schemas/manifest.schema.json` (the LLM-side contract).
2. **Shell selection** — engine inferred a shell appropriate to the prompt.
3. **Widget relevance** — required widgets present, forbidden widgets absent.
4. **Widget count** — within a per-prompt expected range.
5. **Density budget** — `densityUsed <= budget` and the overflow drawer holds
   ≤ 50% of widgets.
6. **Rendering** — `renderManifest` produced clean HTML (correct root,
   no `widget-error` tags, no fallback-view marker, balanced angle brackets).

## Files

- `cases.mjs` — 52 prompts + manifests + per-case expectations
- `run-evals.mjs` — harness; writes `hybrid-renderer-eval-results.json`
- `build-scorecard.mjs` — turns the JSON into `hybrid-renderer-eval-results.html`
- `hybrid-renderer-eval-results.json` — raw per-case results
- `hybrid-renderer-eval-results.html` — human-readable scorecard

## Running

```bash
npm install              # ajv + ajv-formats (devDeps)
node evals/run-evals.mjs # produces JSON + console summary
node evals/build-scorecard.mjs
# Render to PDF (Chrome must be installed):
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$(pwd)/docs/hybrid-renderer-eval-scorecard.pdf" \
  "file://$(pwd)/evals/hybrid-renderer-eval-results.html"
```
