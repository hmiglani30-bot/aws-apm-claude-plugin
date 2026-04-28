"""Golden-output tests for the aws-apm Claude plugin.

Each investigation skill defines a *visual grammar* — verdict line shape,
ranked-hypothesis structure, metadata footer, deep-link block, confidence
labels, ruled-out section. These tests pin those shapes via regular
expressions and string-substring checks so a drift in any skill's canonical
output is caught at CI time rather than at 3am on-call.

The "golden output" is the *shape*, not the literal data — we check that
each skill's documented Markdown renders to a layout that matches the
shape, regardless of the substituted values.

Run with:
    python -m unittest tests.test_golden_outputs

Stdlib only.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read_skill(name: str) -> str:
    return (ROOT / "skills" / name / "SKILL.md").read_text()


# --- Stored expected output samples ------------------------------------------
# These are *shapes*, captured as the canonical example each skill documents.

GOLDEN_VERDICT_SLO_BREACH = (
    "🔴 **Fast burn at 28× normal** — `checkout-availability` will exhaust "
    "its remaining 12% budget in ~6h. Top hypothesis: bad deploy at 14:18 "
    "UTC (High confidence)."
)

GOLDEN_VERDICT_LATENCY = (
    "🟠 **p99 up 3.2× on `POST /checkout`** — 78% of the regression is "
    "downstream `payment-service` latency. Top hypothesis: payment-service "
    "degraded after its 14:05 UTC deploy (High confidence)."
)

GOLDEN_VERDICT_ERROR_SPIKE = (
    "🔴 **5xx rate up 14× since 14:20 UTC** on `POST /checkout` — single "
    "`NullPointerException` cluster, correlated with deploy at 14:18 UTC. "
    "Top hypothesis: bad deploy (High confidence)."
)


# --- Shape regexes ----------------------------------------------------------

# A verdict line: emoji, bold metric phrase, prose with em-dash, ending in "(<level> confidence)".
VERDICT_LINE_RE = re.compile(
    r"""
    [🔴🟠🟡🟢]                       # status emoji
    \s\*\*[^*]+\*\*                  # bolded metric/state phrase
    .*?                              # narrative (may include an em-dash and content before it)
    —                                # em-dash somewhere in the narrative
    .*?                              # rest of narrative
    \((High|Medium|Low)\sconfidence\)\.?  # confidence parenthetical
    """,
    re.VERBOSE | re.DOTALL,
)

# Ranked hypothesis header: "### #N · <claim> — Confidence: **<Level>**"
HYPOTHESIS_HEADER_RE = re.compile(
    r"^###\s#\d+\s·\s.+?\s—\sConfidence:\s\*\*(High|Medium|Low|<[^>]+>)\*\*\s*$",
    re.MULTILINE,
)

# Metadata footer block — at minimum has Source, Time range, MCP tools called, Confidence.
METADATA_REQUIRED_FIELDS = ("Source", "Time range", "MCP tools called", "Confidence")

# Deep link line shape: markdown link to a CloudWatch console surface.
DEEP_LINK_RE = re.compile(r"\[[^\]]+\]\(<[^>]+>\)")  # canonical form in skills uses <deep-link>

# Confidence labels: only Low / Medium / High allowed (case-sensitive in artifacts).
CONFIDENCE_LABEL_RE = re.compile(r"\b(Low|Medium|High)\b")


# --- Tests -------------------------------------------------------------------

class TestVerdictLineFormat(unittest.TestCase):
    """The verdict line must lead each investigation, with a documented shape."""

    def test_slo_breach_verdict_sample_matches_shape(self) -> None:
        self.assertRegex(GOLDEN_VERDICT_SLO_BREACH, VERDICT_LINE_RE)

    def test_latency_verdict_sample_matches_shape(self) -> None:
        self.assertRegex(GOLDEN_VERDICT_LATENCY, VERDICT_LINE_RE)

    def test_error_spike_verdict_sample_matches_shape(self) -> None:
        self.assertRegex(GOLDEN_VERDICT_ERROR_SPIKE, VERDICT_LINE_RE)

    def test_slo_skill_documents_verdict_shape(self) -> None:
        skill = _read_skill("slo-breach-investigation")
        self.assertIn("Lead with a one-line verdict", skill)
        # Skill must enumerate what the verdict NAMES (4 components).
        self.assertIn("burn-rate state", skill)
        self.assertIn("time-to-exhaustion", skill)

    def test_latency_skill_documents_verdict_shape(self) -> None:
        skill = _read_skill("latency-regression")
        self.assertIn("Lead with a one-line verdict", skill)
        self.assertIn("magnitude of the regression", skill)
        self.assertIn("worst operation", skill)

    def test_error_spike_skill_documents_verdict_shape(self) -> None:
        skill = _read_skill("error-spike-triage")
        self.assertIn("Lead with a one-line verdict", skill)
        self.assertIn("magnitude of the spike", skill)
        self.assertIn("dominant exception class", skill)


class TestRankedHypothesesStructure(unittest.TestCase):
    """The Top Suspected Cause artifact must produce 2–4 ranked hypotheses, each with the documented shape."""

    def setUp(self) -> None:
        self.skill = _read_skill("top-suspected-cause")

    def test_skill_canonical_layout_uses_ranked_header(self) -> None:
        # Two header lines in the canonical layout: #1 and #2.
        headers = HYPOTHESIS_HEADER_RE.findall(self.skill)
        self.assertGreaterEqual(len(headers), 2,
                                "canonical layout must show at least 2 ranked hypothesis headers")

    def test_each_hypothesis_has_evidence_and_next_step(self) -> None:
        for required in ("**Evidence**", "**Why this confidence:**", "**Next step (read-only):**"):
            self.assertIn(required, self.skill, f"hypothesis layout missing {required}")

    def test_evidence_uses_iconized_kinds(self) -> None:
        for icon in ("📈", "📜", "🧵", "🛠️"):
            self.assertIn(icon, self.skill, f"evidence kind icon missing: {icon}")

    def test_skill_caps_count_between_two_and_four(self) -> None:
        self.assertIn("2–4 hypotheses", self.skill)


class TestMetadataFooter(unittest.TestCase):
    """Every Tier-3 artifact ends with a metadata footer naming the investigation window."""

    def test_slo_explainer_footer_has_required_fields(self) -> None:
        skill = _read_skill("slo-breach-explainer")
        for field in METADATA_REQUIRED_FIELDS:
            self.assertIn(field, skill, f"slo-breach-explainer footer missing '{field}'")
        # Time range is explicit ISO start → end.
        self.assertIn("`<start>` → `<end>` (UTC)", skill)

    def test_health_card_footer_has_required_fields(self) -> None:
        skill = _read_skill("service-health-card")
        for field in METADATA_REQUIRED_FIELDS:
            self.assertIn(field, skill, f"service-health-card footer missing '{field}'")

    def test_top_suspected_cause_footer_has_required_fields(self) -> None:
        skill = _read_skill("top-suspected-cause")
        # Top Suspected Cause is embedded inside another artifact's footer when
        # rendered in Markdown; for the HTML template the footer placeholders
        # cover Source / Time range / MCP tools.
        self.assertIn("{{SOURCE_MCP_SERVERS}}", skill)
        self.assertIn("{{TIME_RANGE_START}}", skill)
        self.assertIn("{{MCP_TOOLS_LIST}}", skill)

    def test_trace_waterfall_footer_has_required_fields(self) -> None:
        skill = _read_skill("trace-waterfall-summary")
        for field in ("Source", "MCP tools called", "Confidence"):
            self.assertIn(field, skill, f"trace-waterfall-summary footer missing '{field}'")

    def test_validator_enforces_six_required_fields(self) -> None:
        validator = _read_skill("investigation-validator")
        for field in ("Source MCP server", "Time window", "Region", "Account",
                      "MCP tools called", "Confidence"):
            self.assertIn(field, validator,
                          f"validator must require '{field}' in metadata footer")


class TestDeepLinkFormat(unittest.TestCase):
    """Deep links in canonical layouts use markdown link syntax to a placeholder URL."""

    def test_slo_explainer_uses_deep_link_form(self) -> None:
        skill = _read_skill("slo-breach-explainer")
        # At least 4 deep-link entries (SLO detail, service map, logs insights, cloudtrail).
        self.assertGreaterEqual(len(DEEP_LINK_RE.findall(skill)), 4)

    def test_health_card_uses_deep_link_form(self) -> None:
        skill = _read_skill("service-health-card")
        self.assertGreaterEqual(len(DEEP_LINK_RE.findall(skill)), 3)

    def test_trace_waterfall_uses_deep_link_form(self) -> None:
        skill = _read_skill("trace-waterfall-summary")
        self.assertGreaterEqual(len(DEEP_LINK_RE.findall(skill)), 3)

    def test_validator_requires_explicit_time_range_on_links(self) -> None:
        validator = _read_skill("investigation-validator")
        self.assertIn("explicit time range", validator)
        # The skill text wraps mid-phrase, so collapse whitespace before matching.
        normalized = re.sub(r"\s+", " ", validator)
        self.assertIn('never link to a "now" view', normalized)

    def test_open_in_cloudwatch_skill_referenced_by_artifacts(self) -> None:
        for skill_name in ("slo-breach-explainer", "service-health-card",
                            "top-suspected-cause", "trace-waterfall-summary"):
            with self.subTest(skill=skill_name):
                skill = _read_skill(skill_name)
                self.assertIn("open-in-cloudwatch", skill,
                              f"{skill_name} must reference open-in-cloudwatch for deep links")


class TestConfidenceLevelLabels(unittest.TestCase):
    """Confidence labels are exactly Low / Medium / High — no other shapes."""

    def setUp(self) -> None:
        self.cause_skill = _read_skill("top-suspected-cause")

    def test_skill_documents_three_canonical_levels(self) -> None:
        for level in ("Low", "Medium", "High"):
            self.assertIn(level, self.cause_skill,
                          f"top-suspected-cause must document confidence level '{level}'")

    def test_skill_specifies_single_source_caps_at_medium(self) -> None:
        # The Single-Source Rule — load-bearing for the investigation-validator.
        self.assertIn("only one", self.cause_skill.lower())
        self.assertIn("caps at", self.cause_skill.lower())

    def test_validator_enforces_single_source_rule(self) -> None:
        validator = _read_skill("investigation-validator")
        self.assertIn("only ONE evidence source caps at Medium", validator)
        self.assertIn("≥2 independent sources", validator)

    def test_no_other_confidence_labels_used_in_canonical_block(self) -> None:
        # In the canonical layout block, the only confidence words used should
        # be Low / Medium / High (plus the angle-bracket placeholders).
        block = self.cause_skill.split("Canonical layout")[-1].split("## Ranking rules")[0]
        # Strip the placeholder angle-bracket form.
        cleaned = re.sub(r"<[^>]+>", "", block)
        forbidden = ("Certain", "Possible", "Probable", "Unlikely", "VeryHigh", "VeryLow")
        for token in forbidden:
            self.assertNotIn(token, cleaned,
                             f"non-canonical confidence label '{token}' leaked into layout")


class TestRuledOutSection(unittest.TestCase):
    """The 'Considered and ruled out' section is mandatory on the Top Suspected Cause artifact."""

    def setUp(self) -> None:
        self.skill = _read_skill("top-suspected-cause")
        self.validator = _read_skill("investigation-validator")

    def test_section_is_part_of_canonical_layout(self) -> None:
        self.assertIn("### Considered and ruled out", self.skill)

    def test_section_is_marked_mandatory(self) -> None:
        self.assertIn("**\"Considered and ruled out\" is mandatory**", self.skill)

    def test_validator_enforces_section_presence(self) -> None:
        # The validator skill has check #4 specifically for ruled-out section.
        self.assertIn("Considered and ruled out", self.validator)
        # And it must catch silent omissions.
        self.assertIn("do not silently omit", self.validator)

    def test_template_emits_ruled_out_block_even_when_empty(self) -> None:
        # The HTML template shape requires {{RULED_OUT_ITEMS}} always present.
        self.assertIn("{{RULED_OUT_ITEMS}}", self.skill)
        self.assertIn("None — all hypotheses", self.skill)


class TestInvestigationWindowInMetadata(unittest.TestCase):
    """Metadata footers must surface the investigation window explicitly."""

    def test_slo_explainer_lists_time_range(self) -> None:
        skill = _read_skill("slo-breach-explainer")
        self.assertIn("Time range", skill)

    def test_validator_requires_iso_time_range(self) -> None:
        validator = _read_skill("investigation-validator")
        # explicit ISO start → end in UTC, not "last hour"
        self.assertIn("ISO start → end in UTC", validator)


if __name__ == "__main__":
    unittest.main()
