"""Behavioral tests for the aws-apm Claude plugin.

These tests use *mocked* MCP responses as fixtures and assert that the skill
markdown instructions reference the right phases, handle the relevant edge
cases, and route to the right sibling skill when their scope is exceeded.

Skills here are pure markdown — they don't have executable code paths. So a
"behavioral" test verifies the instructions address each scenario in writing:
the right phase numbers are present, the right MCP server is named, and the
right hand-off skill is referenced for fall-through cases.

Run with:
    python -m unittest tests.test_behavioral

Stdlib only — no third-party deps.
"""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read_skill(name: str) -> str:
    return (ROOT / "skills" / name / "SKILL.md").read_text()


# --- Mocked MCP response fixtures (illustrative; not executed) ---------------

SLO_BREACH_FIXTURE = {
    "slo": {
        "name": "checkout-availability",
        "target": 99.9,
        "window_days": 30,
        "current_attainment": 99.74,
        "budget_remaining_pct": 12.0,
        "burn_rate_1h": 28.0,
        "burn_rate_6h": 14.5,
        "burn_rate_24h": 6.2,
        "breach_start_iso": "2026-04-28T14:18:00Z",
    },
    "traces": [
        {
            "trace_id": "1-66311fa1-abc123",
            "duration_ms": 4820,
            "failed_span": "payment-service.charge",
            "exception": "TimeoutException",
        }
    ],
}

LATENCY_REGRESSION_FIXTURE = {
    "operation": "POST /checkout",
    "p50_now_ms": 142,
    "p99_now_ms": 4200,
    "p99_baseline_ms": 1300,
    "p99_baseline_7d_ms": 1280,
    "service_map_dependency": "payment-service",
    "trace_id": "1-66312001-slowspan",
    "slow_span": "payment-service.charge",
}

ERROR_SPIKE_FIXTURE = {
    "service": "checkout-api",
    "error_rate_now": 0.18,
    "error_rate_baseline": 0.012,
    "top_error_type": "NullPointerException",
    "log_pattern_count": 1240,
    "trace_exception_class": "NullPointerException",
}

EMPTY_SLO_FIXTURE: dict = {"slos": []}

EMPTY_TRACES_FIXTURE: dict = {"traces": []}

ACCESS_DENIED_FIXTURE = {
    "error": "AccessDenied",
    "message": "User: arn:aws:iam::1:user/x is not authorized to perform: cloudtrail:LookupEvents",
}

THROTTLED_FIXTURE = {
    "error": "ThrottlingException",
    "message": "Rate exceeded for StartQuery on Logs Insights",
}

MALFORMED_FIXTURE = {"unexpected_top_level_key": True}  # missing the expected shape


# --- Tests -------------------------------------------------------------------

class TestSloBreachScenario(unittest.TestCase):
    """When an SLO is burning, the SLO breach skill must drive the workflow."""

    def setUp(self) -> None:
        self.skill = _read_skill("slo-breach-investigation")
        self.fixture = SLO_BREACH_FIXTURE

    def test_skill_walks_all_six_phases(self) -> None:
        for phase in ("Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Phase 6"):
            self.assertIn(phase, self.skill, f"missing {phase}")

    def test_skill_classifies_burn_rate(self) -> None:
        self.assertIn("Fast burn", self.skill)
        self.assertIn("Slow burn", self.skill)
        self.assertIn("Recovered", self.skill)

    def test_skill_uses_application_signals_mcp(self) -> None:
        self.assertIn("awslabs.cloudwatch-applicationsignals-mcp-server", self.skill)

    def test_skill_correlates_with_cloudtrail_in_phase_4(self) -> None:
        # Find the Phase 4 block and check it references CloudTrail.
        idx = self.skill.find("Phase 4")
        end = self.skill.find("Phase 5", idx)
        block = self.skill[idx:end]
        self.assertIn("CloudTrail", block, "Phase 4 must correlate with CloudTrail")

    def test_burn_classification_matches_fixture(self) -> None:
        # Sanity — fixture's 1h burn (28x) classifies as fast burn per the skill rules.
        self.assertGreater(self.fixture["slo"]["burn_rate_1h"], 14.0,
                           "fixture should be a fast-burn case")


class TestLatencyRegressionScenario(unittest.TestCase):
    def setUp(self) -> None:
        self.skill = _read_skill("latency-regression")
        self.fixture = LATENCY_REGRESSION_FIXTURE

    def test_skill_compares_p50_p90_p99(self) -> None:
        for token in ("p50", "p90", "p99"):
            self.assertIn(token, self.skill)

    def test_skill_compares_against_baseline(self) -> None:
        self.assertIn("baseline", self.skill.lower())
        # Specifically: same hour 1d and 7d ago (week-over-week catches different problems).
        self.assertIn("7 days ago", self.skill)

    def test_skill_routes_to_slo_skill_when_slo_breaching(self) -> None:
        self.assertIn("slo-breach-investigation", self.skill)

    def test_skill_uses_trace_waterfall_summary_artifact(self) -> None:
        self.assertIn("Trace Waterfall Summary", self.skill)

    def test_p99_regression_meets_threshold(self) -> None:
        ratio = self.fixture["p99_now_ms"] / self.fixture["p99_baseline_ms"]
        # Skill defines a real regression as p99 up >2x — fixture should qualify.
        self.assertGreater(ratio, 2.0)


class TestErrorSpikeScenario(unittest.TestCase):
    def setUp(self) -> None:
        self.skill = _read_skill("error-spike-triage")
        self.fixture = ERROR_SPIKE_FIXTURE

    def test_skill_distinguishes_4xx_from_5xx(self) -> None:
        self.assertIn("4xx", self.skill)
        self.assertIn("5xx", self.skill)

    def test_skill_uses_logs_insights_for_pattern_detection(self) -> None:
        self.assertIn("Logs Insights", self.skill)
        self.assertIn("errorType", self.skill)

    def test_skill_routes_to_slo_skill_when_slo_breaching(self) -> None:
        self.assertIn("slo-breach-investigation", self.skill)

    def test_skill_uses_service_health_card_artifact(self) -> None:
        self.assertIn("Service Health Card", self.skill)

    def test_fixture_qualifies_as_real_spike(self) -> None:
        ratio = self.fixture["error_rate_now"] / self.fixture["error_rate_baseline"]
        self.assertGreater(ratio, 10.0, "fixture should be a real spike (>>baseline)")


class TestNoSloConfiguredScenario(unittest.TestCase):
    """When list_slos returns empty, skills must fall through gracefully."""

    def test_slo_skill_falls_through_to_health_card(self) -> None:
        skill = _read_skill("slo-breach-investigation")
        self.assertIn("If no SLOs exist", skill)
        # Must hand off to health-card or error-spike-triage.
        self.assertIn("service-health-card", skill)
        self.assertIn("error-spike-triage", skill)

    def test_health_card_renders_explicit_no_slo_note(self) -> None:
        skill = _read_skill("service-health-card")
        self.assertIn("No SLOs configured", skill,
                      "health card must render an explicit 'No SLOs configured' note")

    def test_validator_handles_no_slo_case(self) -> None:
        skill = _read_skill("investigation-validator")
        # The checklist explicitly covers the non-SLO investigation case.
        self.assertIn("no SLO is configured", skill)

    def test_fixture_is_actually_empty(self) -> None:
        self.assertEqual(EMPTY_SLO_FIXTURE["slos"], [])


class TestMissingTraceDataScenario(unittest.TestCase):
    """When list_traces returns empty, skills must not fabricate."""

    def test_trace_summary_handles_partial_spans(self) -> None:
        skill = _read_skill("trace-waterfall-summary")
        self.assertIn("only a subset of spans", skill)
        self.assertIn("confidence", skill.lower())

    def test_explainer_does_not_fabricate_when_data_incomplete(self) -> None:
        skill = _read_skill("slo-breach-explainer")
        self.assertIn("not fabricate", skill.lower().replace("**", ""))

    def test_top_suspected_cause_requires_evidence(self) -> None:
        skill = _read_skill("top-suspected-cause")
        # No evidence → not rendered. Speculation goes to "Considered and ruled out".
        self.assertIn("Considered and ruled out", skill)
        self.assertIn("Hypotheses without", skill)

    def test_fixture_is_actually_empty(self) -> None:
        self.assertEqual(EMPTY_TRACES_FIXTURE["traces"], [])


class TestAccessDeniedFromCloudTrail(unittest.TestCase):
    """An AccessDenied from CloudTrail should be surfaced, not retried."""

    def test_setup_skill_lists_accessdenied_as_known_error(self) -> None:
        skill = _read_skill("aws-apm-setup")
        self.assertIn("AccessDenied", skill)
        # Setup must cite the IAM perms required (cloudtrail:LookupEvents).
        self.assertIn("cloudtrail:LookupEvents", skill)

    def test_setup_skill_surfaces_errors_verbatim(self) -> None:
        skill = _read_skill("aws-apm-setup")
        self.assertIn("surface the error verbatim", skill)
        self.assertIn("do not retry silently", skill)

    def test_fixture_shape(self) -> None:
        self.assertEqual(ACCESS_DENIED_FIXTURE["error"], "AccessDenied")


class TestThrottledLogsInsightsQuery(unittest.TestCase):
    """A ThrottlingException on Logs Insights must not crash the investigation."""

    def test_error_spike_uses_logs_insights(self) -> None:
        # If Logs Insights is the throttled API, the error-spike skill is the
        # canonical caller; we want to ensure it documents the query shape so
        # callers can retry deterministically rather than silently swallowing.
        skill = _read_skill("error-spike-triage")
        self.assertIn("Logs Insights", skill)
        # Skill specifies an example query — gives the user something concrete
        # to retry.
        self.assertIn("stats count()", skill)

    def test_fixture_is_throttling(self) -> None:
        self.assertEqual(THROTTLED_FIXTURE["error"], "ThrottlingException")


class TestMalformedMcpResponse(unittest.TestCase):
    """A malformed MCP response must not be silently rendered as a result."""

    def test_validator_catches_empty_or_placeholder_text(self) -> None:
        skill = _read_skill("investigation-validator")
        # The validator explicitly fails on empty/placeholder fields.
        self.assertIn("placeholder text", skill)
        self.assertIn("Fail", skill)

    def test_explainer_refuses_to_render_with_missing_inputs(self) -> None:
        skill = _read_skill("slo-breach-explainer")
        self.assertIn("If any of these are missing, do not render", skill)

    def test_fixture_is_malformed(self) -> None:
        # Sanity: the fixture lacks the expected top-level keys.
        self.assertNotIn("slo", MALFORMED_FIXTURE)
        self.assertNotIn("traces", MALFORMED_FIXTURE)


if __name__ == "__main__":
    unittest.main()
