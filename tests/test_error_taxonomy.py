"""Error taxonomy tests for the aws-apm Claude plugin.

These tests pin the *error taxonomy* the plugin's skills must handle. For
each known failure mode, at least one skill must document how to recognize
and surface it — silent failures are the worst on-call experience.

Taxonomy:
  1. No credentials                     (no AWS creds at all)
  2. Wrong region                       (creds work, but no data in this region)
  3. No Application Signals services    (AppSignals not enabled)
  4. No SLOs configured                 (services exist but no SLOs defined)
  5. No traces                          (X-Ray returns empty)
  6. No logs                            (Logs Insights returns empty)
  7. No CloudTrail access               (AccessDenied on LookupEvents)
  8. Throttling                         (any AWS API returns ThrottlingException)
  9. Partial data                       (some calls succeeded, some failed)
 10. Ambiguous service name             (user names a service that doesn't uniquely match)
 11. Multiple matching services         (search returned >1 candidate)

Each item is verified by searching skill markdown for the canonical phrase
the skill author documents as the handling rule. The point isn't to be
prescriptive about wording — it's to catch silent removal of a taxonomy
entry from the skill docs.

Run with:
    python -m unittest tests.test_error_taxonomy
"""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read_skill(name: str) -> str:
    return (ROOT / "skills" / name / "SKILL.md").read_text()


def _any_skill_contains(needles: tuple[str, ...]) -> tuple[bool, list[str]]:
    """Return (found_anywhere, list_of_skills_containing_at_least_one_needle)."""
    hits: list[str] = []
    for skill_dir in (ROOT / "skills").iterdir():
        if not skill_dir.is_dir():
            continue
        text = (skill_dir / "SKILL.md").read_text()
        if any(n in text for n in needles):
            hits.append(skill_dir.name)
    return bool(hits), sorted(hits)


class TestNoCredentials(unittest.TestCase):
    """A missing AWS credential file should surface a known error to the user."""

    def test_setup_skill_documents_no_credentials_case(self) -> None:
        skill = _read_skill("aws-apm-setup")
        self.assertIn("Unable to locate credentials", skill)
        # Must point the user to a fix.
        self.assertIn("aws configure", skill)


class TestWrongRegion(unittest.TestCase):
    """Creds work but the workload is in a different region."""

    def test_setup_skill_calls_out_wrong_region(self) -> None:
        skill = _read_skill("aws-apm-setup")
        self.assertIn("wrong region", skill)
        # The setup skill must instruct the user how to set the region.
        self.assertIn("AWS_REGION", skill)


class TestNoApplicationSignalsServices(unittest.TestCase):
    """If list_monitored_services returns empty, AppSignals likely isn't enabled."""

    def test_setup_skill_documents_no_services_case(self) -> None:
        skill = _read_skill("aws-apm-setup")
        self.assertIn("No services found", skill)
        self.assertIn("Application Signals not enabled", skill)


class TestNoSlosConfigured(unittest.TestCase):
    """If list_slos returns empty, SLO-skills must hand off, not fabricate."""

    def test_slo_skill_falls_through_to_other_skills(self) -> None:
        skill = _read_skill("slo-breach-investigation")
        self.assertIn("If no SLOs exist", skill)
        self.assertIn("service-health-card", skill)
        self.assertIn("error-spike-triage", skill)

    def test_health_card_renders_explicit_no_slo_note(self) -> None:
        skill = _read_skill("service-health-card")
        self.assertIn("No SLOs configured", skill)


class TestNoTraces(unittest.TestCase):
    """An empty trace search must not silently render a degraded artifact."""

    def test_trace_summary_handles_partial_or_missing_spans(self) -> None:
        skill = _read_skill("trace-waterfall-summary")
        self.assertIn("only a subset of spans", skill)
        self.assertIn("call it out", skill)
        # Must drop confidence accordingly.
        self.assertIn("metadata footer's `confidence`", skill)


class TestNoLogs(unittest.TestCase):
    """A Logs Insights query that returns zero matches needs explicit handling."""

    def test_a_skill_documents_empty_logs_handling(self) -> None:
        # Either error-spike-triage or aws-apm-setup must say what to do
        # when Logs Insights returns nothing — most likely cause is no log
        # group with that pattern, wrong region, or wrong filter.
        found, hits = _any_skill_contains((
            "no log group", "log group", "Logs Insights",
        ))
        self.assertTrue(found, "no skill mentions Logs Insights / log groups")
        self.assertIn("error-spike-triage", hits)


class TestNoCloudTrailAccess(unittest.TestCase):
    """AccessDenied on cloudtrail:LookupEvents must be surfaced, not retried."""

    def test_setup_skill_documents_accessdenied(self) -> None:
        skill = _read_skill("aws-apm-setup")
        self.assertIn("AccessDenied", skill)
        # IAM section must list cloudtrail:LookupEvents
        self.assertIn("cloudtrail:LookupEvents", skill)


class TestThrottling(unittest.TestCase):
    """A ThrottlingException from any AWS API needs a handling rule."""

    def test_a_skill_documents_throttling_or_general_retry_rule(self) -> None:
        # The plugin's general principle: surface errors verbatim, do not
        # retry silently. Combined with explicit Throttling handling for the
        # 'as-a-cause' case in error-spike-triage.
        setup = _read_skill("aws-apm-setup")
        self.assertIn("surface the error verbatim", setup)
        self.assertIn("do not retry silently", setup)
        # Error-spike-triage explicitly names throttling as a hypothesis class.
        spike = _read_skill("error-spike-triage")
        self.assertIn("Throttling", spike)


class TestPartialData(unittest.TestCase):
    """If some MCP calls succeed and others fail, the artifact must reflect this."""

    def test_validator_flags_partial_or_placeholder_text(self) -> None:
        validator = _read_skill("investigation-validator")
        # Validator catches the structural symptom of partial data: empty fields
        # or `<TODO>` placeholders make it through to the rendered artifact.
        self.assertIn("placeholder text", validator)
        self.assertIn("Empty `<region>` or `<TODO>` is a Fail", validator)

    def test_explainer_refuses_to_render_with_missing_inputs(self) -> None:
        skill = _read_skill("slo-breach-explainer")
        self.assertIn("If any of these are missing, do not render", skill)

    def test_trace_summary_reduces_confidence_under_partial_spans(self) -> None:
        skill = _read_skill("trace-waterfall-summary")
        self.assertIn("only a subset", skill)
        self.assertIn("confidence", skill.lower())


class TestAmbiguousServiceName(unittest.TestCase):
    """If a user names a service that's ambiguous, skills should disambiguate."""

    def test_slo_skill_handles_ambiguous_service_unhealthy_report(self) -> None:
        skill = _read_skill("slo-breach-investigation")
        # Skill says it triggers on "An ambiguous 'service unhealthy' report"
        # and lists SLOs first before committing to the workflow.
        self.assertIn("ambiguous", skill.lower())
        self.assertIn("list SLOs first", skill)


class TestMultipleMatchingServices(unittest.TestCase):
    """If list_monitored_services returns >1 match for a name, the user must pick one."""

    def test_a_skill_documents_multi_match_disambiguation(self) -> None:
        # Either aws-apm-setup or one of the workflow skills should describe
        # what to do when the user's reference matches multiple services.
        # Phrasing options: "multiple", "more than one", "disambigu", "pick one".
        found, hits = _any_skill_contains((
            "multiple matching", "more than one service",
            "disambiguate", "ask the user to pick",
            "pick one", "multiple services",
        ))
        # If the taxonomy item isn't yet documented, this asserts the gap so
        # the maintainer can fix it deliberately.
        self.assertTrue(
            found,
            "no skill documents how to handle multiple matching services. "
            "Add guidance to aws-apm-setup or slo-breach-investigation.")
        self.assertGreater(len(hits), 0)


if __name__ == "__main__":
    unittest.main()
