"""Artifact rendering tests for the aws-apm Claude plugin.

For each HTML artifact template:
1. Discover all `{{PLACEHOLDER}}` tokens.
2. Substitute each with a deterministic sample value (per-token).
3. Verify NO `{{...}}` token remains afterwards (no orphan placeholders).
4. Verify required sections are present (confidence, metadata footer, deep
   links).
5. Verify Cloudscape dark-theme CSS tokens are intact (the visual grammar).

These tests use only the stdlib — they don't actually render the HTML in a
browser. The point is to catch missed placeholders and missing structural
sections at CI time, before an artifact lands in front of an on-call
engineer with `{{SLO_NAME}}` literally printed in the title bar.

Run with:
    python -m unittest tests.test_artifact_rendering
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = ROOT / "artifacts"

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")

# Cloudscape dark-theme tokens that every artifact must carry.
CLOUDSCAPE_TOKENS = ("#0f1b2a", "#192534", "#539fe5")

# Required section markers — these need to survive substitution.
# The strings must be substrings of the post-substitution HTML.
REQUIRED_SECTION_MARKERS = {
    "slo-breach-explainer.html": (
        "Confidence",            # confidence label in the metadata footer
        "Time range",            # investigation window in the footer
        "CloudWatch Console",    # deep-link block
        "MCP tools",             # MCP-tools-called field in footer
    ),
    "service-health-card.html": (
        "Confidence",
        "CloudWatch Console",
        "MCP tools",
    ),
    "trace-waterfall.html": (
        "Confidence",
        "CloudWatch Console",
        "MCP tools",
    ),
    "top-suspected-cause.html": (
        "confidence",            # per-hypothesis confidence badge ("High confidence" etc.)
        "CloudWatch Console",    # falsifiable next-step deep link
        "MCP tools",
    ),
    "investigation-summary.html": (
        "Confidence",            # root-cause confidence in the footer
        "Time range",            # investigation window in the footer
        "CloudWatch Console",
        "MCP tools",
    ),
    "alerting-plan.html": (
        "Confidence",            # confidence label in the metadata footer
        "CloudWatch Console",    # deep-link block
        "MCP tools",             # MCP-tools-called field in footer
        "Time window",           # window covered by the plan
    ),
    "observability-gap-report.html": (
        "CloudWatch Console",    # deep-link block (citation)
        "Path analyzed",         # footer field
        "AWS docs MCP",          # source-of-truth attribution in footer
        "Generated",             # generated-at timestamp in footer
    ),
}


def _sample_value(name: str) -> str:
    """Return a placeholder-name-aware sample string.

    The sample type matters: a placeholder named `*_PCT` should slot into the
    inline CSS `width: <value>%` without breaking the HTML; a `*_ROWS`
    placeholder needs a `<tr>` chunk; etc. Substituting "x" everywhere is too
    coarse and would let HTML breakage through.
    """
    if name.endswith("_ROWS") or name.endswith("_ROWS_OR_NONE") or name.endswith("_OR_EMPTY"):
        return "<tr><td>sample</td><td>sample</td><td>sample</td><td>sample</td></tr>"
    if name.endswith("_BLOCK_OPTIONAL") or name.endswith("_CARDS"):
        return '<div class="evidence-card">sample</div>'
    if name == "RANKED_HYPOTHESES_BLOCK":
        return '<div class="hypothesis">sample</div>'
    if name == "TIMELINE_EVENTS":
        return ('<div class="timeline-event detect"><div class="te-time">12:00</div>'
                '<div class="te-title">Detected</div><div class="te-detail">x</div></div>')
    if name == "REMEDIATION_STEPS":
        return ('<li><div class="rem-title">Sample step</div>'
                '<div class="rem-detail">Sample detail</div></li>')
    if name == "RULED_OUT_ITEMS":
        return "<li>None — all hypotheses retained.</li>"
    if name == "SLO_PILLS_OR_EMPTY":
        return '<div class="slo-pill healthy">Healthy</div>'
    if name == "WATERFALL_SPAN_ROWS":
        return ('<div class="span-meta depth-0">root</div>'
                '<div class="span-bar svc-1" style="left: 0%; width: 50%"></div>')
    if name == "TOP_SPANS_ROWS":
        return ('<tr><td>1</td><td>span</td><td>svc</td>'
                '<td>10ms</td><td>50%</td><td><code>X.y</code></td></tr>')
    if name == "ERROR_ROWS_OR_NONE":
        return "<tr><td colspan=\"3\">No errors in this trace.</td></tr>"
    if name == "RECENT_CHANGES_ROWS_OR_NONE":
        return '<tr><td colspan="4">No CloudTrail events in last 24h.</td></tr>"'
    if name == "CONTRIBUTING_CHANGES_ROWS":
        return ("<tr><td>14:18Z</td><td>UpdateService</td>"
                "<td>arn:aws:ecs::svc</td><td>deploy-bot</td></tr>")
    if name == "CORRELATED_EVENTS_ROWS":
        return ("<tr><td>14:18Z</td><td>UpdateService</td>"
                "<td>arn:aws:ecs::svc</td><td>deploy-bot</td></tr>")
    if name == "IMPACTED_OPERATIONS_ROWS":
        return ("<tr><td>POST /checkout</td><td class=\"numeric\">120</td>"
                "<td>62%</td><td>4200ms</td><td>18%</td></tr>")
    if name == "SPARKLINE" or name.endswith("_SPARKLINE"):
        return "0,15 25,10 50,12 75,8 100,5"
    if name.endswith("_PCT"):
        return "42"
    if name.endswith("_CLASS"):
        return "healthy"
    if name == "VERDICT":
        return "Healthy"
    if name == "TRACE_STATUS":
        return "ok"
    if name == "BURN_CLASSIFICATION":
        return "Fast burn"
    if name in ("CONFIDENCE", "CAUSAL_CONFIDENCE", "ATTRIBUTION_CONFIDENCE",
                "ROOT_CAUSE_CONFIDENCE",
                "HYP1_CONFIDENCE", "HYP2_CONFIDENCE", "HYP3_CONFIDENCE", "HYP4_CONFIDENCE"):
        return "High"
    if name in ("HYP1_CONFIDENCE_CLASS", "HYP2_CONFIDENCE_CLASS",
                "HYP3_CONFIDENCE_CLASS", "HYP4_CONFIDENCE_CLASS"):
        return "high"
    if name == "SEVERITY":
        return "SEV1"
    if name == "SEVERITY_CLASS":
        return "sev1"
    if name == "AWS_REGION":
        return "us-east-1"
    if name.startswith("LINK_") or name.endswith("_LINK"):
        return "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:"
    if name == "SAVE_ARTIFACT_BUTTON":
        return "Save artifact"
    if name == "SHARE_BUTTON":
        return "Share"
    return f"sample-{name.lower()}"


def _substitute(html: str) -> tuple[str, set[str]]:
    """Replace every `{{NAME}}` with a sample value. Return (rendered_html, names_seen)."""
    names = set(PLACEHOLDER_RE.findall(html))
    rendered = html
    for name in names:
        rendered = rendered.replace("{{" + name + "}}", _sample_value(name))
    return rendered, names


class TestArtifactRendering(unittest.TestCase):

    def test_artifacts_dir_present(self) -> None:
        self.assertTrue(ARTIFACTS_DIR.is_dir(), f"missing {ARTIFACTS_DIR}")

    def test_each_artifact_has_at_least_one_placeholder(self) -> None:
        for artifact in ARTIFACTS_DIR.glob("*.html"):
            with self.subTest(artifact=artifact.name):
                placeholders = PLACEHOLDER_RE.findall(artifact.read_text())
                self.assertGreater(
                    len(placeholders), 0,
                    f"{artifact.name}: artifact template has no {{{{PLACEHOLDERS}}}} — "
                    "either it's not a template or it's been pre-rendered")

    def test_substitution_leaves_no_placeholder_behind(self) -> None:
        """After substituting every placeholder, no `{{...}}` token remains."""
        for artifact in ARTIFACTS_DIR.glob("*.html"):
            with self.subTest(artifact=artifact.name):
                html = artifact.read_text()
                rendered, names_seen = _substitute(html)
                leftover = PLACEHOLDER_RE.findall(rendered)
                self.assertEqual(
                    leftover, [],
                    f"{artifact.name}: leftover placeholders after substitution: {leftover}")
                self.assertGreater(
                    len(names_seen), 0,
                    f"{artifact.name}: substitution covered no placeholders")

    def test_required_sections_survive_substitution(self) -> None:
        """Confidence label, metadata footer hints, deep-link block must be in the rendered HTML."""
        for artifact in ARTIFACTS_DIR.glob("*.html"):
            with self.subTest(artifact=artifact.name):
                rendered, _ = _substitute(artifact.read_text())
                required = REQUIRED_SECTION_MARKERS.get(artifact.name)
                self.assertIsNotNone(
                    required,
                    f"{artifact.name}: no required-section marker list in test config — "
                    "add one to REQUIRED_SECTION_MARKERS")
                for marker in required:  # type: ignore[union-attr]
                    self.assertIn(
                        marker, rendered,
                        f"{artifact.name}: required section marker '{marker}' missing")

    def test_cloudscape_tokens_present(self) -> None:
        """The Cloudscape dark-theme tokens are part of the visual grammar."""
        for artifact in ARTIFACTS_DIR.glob("*.html"):
            with self.subTest(artifact=artifact.name):
                html = artifact.read_text()
                for token in CLOUDSCAPE_TOKENS:
                    self.assertIn(
                        token, html,
                        f"{artifact.name}: missing Cloudscape token {token}")

    def test_doctype_and_html_lang_present(self) -> None:
        """Each artifact is a self-contained HTML document."""
        for artifact in ARTIFACTS_DIR.glob("*.html"):
            with self.subTest(artifact=artifact.name):
                html = artifact.read_text()
                self.assertIn("<!DOCTYPE html>", html)
                self.assertIn("<html lang=\"en\">", html)
                self.assertIn("</html>", html)

    def test_save_artifact_and_share_buttons_present(self) -> None:
        """Both interactive-action button placeholders are required by the visual grammar."""
        for artifact in ARTIFACTS_DIR.glob("*.html"):
            with self.subTest(artifact=artifact.name):
                html = artifact.read_text()
                self.assertIn("{{SAVE_ARTIFACT_BUTTON}}", html,
                              f"{artifact.name}: missing Save Artifact button placeholder")
                self.assertIn("{{SHARE_BUTTON}}", html,
                              f"{artifact.name}: missing Share button placeholder")


if __name__ == "__main__":
    unittest.main()
