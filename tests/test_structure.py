"""Structural tests for the aws-apm Claude plugin.

These tests verify the plugin layout, manifest correctness, and frontmatter
contents without requiring any AWS credentials or live MCP servers. They run
in seconds and are safe to gate CI on.

Run with:
    python -m unittest tests.test_structure

Stdlib only — no PyYAML dependency. Frontmatter is parsed by hand.
"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EXPECTED_SKILLS = {
    "slo-breach-investigation",
    "latency-regression",
    "error-spike-triage",
    "alarm-response",
    "slo-compliance-report",
    "slo-breach-explainer",
    "trace-waterfall-summary",
    "service-health-card",
    "top-suspected-cause",
    "open-in-cloudwatch",
    "aws-apm-setup",
    "investigation-validator",
    "incident-memory",
    "trace-to-code",
    "service-ownership",
    "copy-to-incident",
    "observability-gap-analysis",
    "alerting-design",
    "create-alarm",
    "hybrid-renderer",
    "widget-catalog",
}

EXPECTED_COMMANDS = {
    "cw-investigate-slo.md",
    "cw-investigate-latency.md",
    "cw-investigate-errors.md",
    "cw-health-check.md",
    "cw-alarm-response.md",
    "cw-slo-report.md",
    "cw-doctor.md",
    "cw-set-context.md",
    "cw-verify-recovery.md",
    "cw-obs-gaps.md",
    "cw-alert-design.md",
    "cw-create-alarm.md",
    "cw-trail-view.md",
}

EXPECTED_MCP_SERVERS = {
    "awslabs.cloudwatch-mcp-server",
    "awslabs.cloudwatch-applicationsignals-mcp-server",
    "awslabs.cloudtrail-mcp-server",
    "awslabs.aws-documentation-mcp-server",
}

EXPECTED_ARTIFACTS = {
    "slo-breach-explainer.html",
    "trace-waterfall.html",
    "service-health-card.html",
    "top-suspected-cause.html",
    "investigation-summary.html",
    "observability-gap-report.html",
    "alerting-plan.html",
}

# Workflow skills that must include a Phase 6 cascading dependency check.
WORKFLOW_SKILLS_WITH_PHASE_6 = {
    "slo-breach-investigation",
    "latency-regression",
    "error-spike-triage",
}

# Tier 3 skills that must reference an HTML artifact template.
SKILLS_REFERENCING_ARTIFACTS = {
    "slo-breach-explainer": "artifacts/slo-breach-explainer.html",
    "trace-waterfall-summary": "artifacts/trace-waterfall.html",
    "service-health-card": "artifacts/service-health-card.html",
    "top-suspected-cause": "artifacts/top-suspected-cause.html",
}


def parse_frontmatter(text: str) -> dict[str, str]:
    """Parse a markdown YAML frontmatter block. Stdlib-only, single-line values."""
    if not text.startswith("---"):
        raise ValueError("missing frontmatter")
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError("malformed frontmatter")
    body = parts[1]
    out: dict[str, str] = {}
    current_key: str | None = None
    current_value: list[str] = []
    for raw in body.splitlines():
        if not raw.strip():
            continue
        if raw.startswith(" ") and current_key is not None:
            current_value.append(raw.strip())
            continue
        if current_key is not None:
            out[current_key] = " ".join(current_value).strip()
        if ":" not in raw:
            current_key = None
            current_value = []
            continue
        key, _, value = raw.partition(":")
        current_key = key.strip()
        current_value = [value.strip()] if value.strip() else []
    if current_key is not None:
        out[current_key] = " ".join(current_value).strip()
    return out


class TestPluginManifest(unittest.TestCase):
    def test_plugin_json_exists_and_valid(self) -> None:
        path = ROOT / ".claude-plugin" / "plugin.json"
        self.assertTrue(path.exists(), f"missing {path}")
        data = json.loads(path.read_text())
        for field in ("name", "version", "description", "author"):
            self.assertIn(field, data)
        self.assertEqual(data["name"], "aws-apm")

    def test_marketplace_json_exists_and_valid(self) -> None:
        path = ROOT / ".claude-plugin" / "marketplace.json"
        self.assertTrue(path.exists(), f"missing {path}")
        data = json.loads(path.read_text())
        self.assertIn("plugins", data)
        self.assertEqual(len(data["plugins"]), 1)
        self.assertEqual(data["plugins"][0]["name"], "aws-apm")

    def test_versions_are_in_sync(self) -> None:
        plugin = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())
        marketplace = json.loads((ROOT / ".claude-plugin" / "marketplace.json").read_text())
        self.assertEqual(plugin["version"], marketplace["version"])
        self.assertEqual(plugin["version"], marketplace["plugins"][0]["version"])


class TestMcpConfig(unittest.TestCase):
    def test_mcp_json_exists_and_valid(self) -> None:
        path = ROOT / ".mcp.json"
        self.assertTrue(path.exists(), f"missing {path}")
        data = json.loads(path.read_text())
        self.assertIn("mcpServers", data)

    def test_mcp_json_has_four_awslabs_servers(self) -> None:
        data = json.loads((ROOT / ".mcp.json").read_text())
        self.assertEqual(set(data["mcpServers"].keys()), EXPECTED_MCP_SERVERS)

    def test_mcp_servers_use_uvx(self) -> None:
        data = json.loads((ROOT / ".mcp.json").read_text())
        for name, conf in data["mcpServers"].items():
            self.assertEqual(conf["command"], "uvx", f"{name} should launch via uvx")
            self.assertTrue(any(name in arg for arg in conf["args"]),
                            f"{name} args should reference the package name")


class TestSkills(unittest.TestCase):
    def test_all_expected_skills_present(self) -> None:
        skills_dir = ROOT / "skills"
        self.assertTrue(skills_dir.exists())
        actual = {p.name for p in skills_dir.iterdir() if p.is_dir()}
        self.assertEqual(actual, EXPECTED_SKILLS)

    def test_each_skill_has_skill_md_with_required_frontmatter(self) -> None:
        for skill in EXPECTED_SKILLS:
            with self.subTest(skill=skill):
                skill_md = ROOT / "skills" / skill / "SKILL.md"
                self.assertTrue(skill_md.exists(), f"missing {skill_md}")
                fm = parse_frontmatter(skill_md.read_text())
                self.assertIn("name", fm)
                self.assertIn("description", fm)
                self.assertEqual(fm["name"], skill,
                                 f"frontmatter name '{fm['name']}' must match dir '{skill}'")
                self.assertGreater(len(fm["description"]), 30,
                                   f"{skill}: description too short to trigger reliably")


class TestCommands(unittest.TestCase):
    def test_all_expected_commands_present(self) -> None:
        commands_dir = ROOT / "commands"
        self.assertTrue(commands_dir.exists())
        actual = {p.name for p in commands_dir.iterdir() if p.is_file() and p.suffix == ".md"}
        self.assertEqual(actual, EXPECTED_COMMANDS)

    def test_each_command_has_required_frontmatter(self) -> None:
        for cmd in EXPECTED_COMMANDS:
            with self.subTest(cmd=cmd):
                fm = parse_frontmatter((ROOT / "commands" / cmd).read_text())
                self.assertIn("description", fm)
                self.assertGreater(len(fm["description"]), 20)


class TestHooks(unittest.TestCase):
    def test_hooks_json_exists_and_valid(self) -> None:
        path = ROOT / "hooks" / "hooks.json"
        self.assertTrue(path.exists())
        data = json.loads(path.read_text())
        self.assertIn("PreToolUse", data["hooks"])

    def test_confirm_write_script_is_executable(self) -> None:
        path = ROOT / "hooks" / "scripts" / "confirm-write.sh"
        self.assertTrue(path.exists())
        self.assertTrue(os.access(path, os.X_OK), "confirm-write.sh must be executable")


class TestDocs(unittest.TestCase):
    def test_readme_exists(self) -> None:
        path = ROOT / "README.md"
        self.assertTrue(path.exists())
        self.assertGreater(len(path.read_text()), 500, "README looks too short")

    def test_license_exists(self) -> None:
        self.assertTrue((ROOT / "LICENSE").exists())


class TestArtifacts(unittest.TestCase):
    def test_artifacts_dir_exists(self) -> None:
        self.assertTrue((ROOT / "artifacts").is_dir(), "missing artifacts/ directory")

    def test_all_expected_artifacts_present(self) -> None:
        artifacts_dir = ROOT / "artifacts"
        actual = {p.name for p in artifacts_dir.iterdir() if p.is_file() and p.suffix == ".html"}
        self.assertEqual(actual, EXPECTED_ARTIFACTS)

    def test_each_artifact_has_doctype_and_cloudscape_tokens(self) -> None:
        for name in EXPECTED_ARTIFACTS:
            with self.subTest(artifact=name):
                text = (ROOT / "artifacts" / name).read_text()
                self.assertIn("<!DOCTYPE html>", text, f"{name}: missing doctype")
                # Cloudscape dark theme tokens that the prompt explicitly required.
                for token in ("#0f1b2a", "#192534", "#539fe5"):
                    self.assertIn(token, text, f"{name}: missing Cloudscape token {token}")

    def test_each_artifact_has_placeholders_and_buttons(self) -> None:
        for name in EXPECTED_ARTIFACTS:
            with self.subTest(artifact=name):
                text = (ROOT / "artifacts" / name).read_text()
                self.assertIn("{{", text, f"{name}: no {{{{PLACEHOLDER}}}} found")
                self.assertIn("}}", text, f"{name}: no {{{{PLACEHOLDER}}}} found")
                self.assertIn("CloudWatch Console", text,
                              f"{name}: missing 'Jump to CloudWatch Console' deep link")
                self.assertIn("SAVE_ARTIFACT_BUTTON", text,
                              f"{name}: missing Save Artifact button placeholder")
                self.assertIn("SHARE_BUTTON", text,
                              f"{name}: missing Share button placeholder")


class TestSkillTemplateReferences(unittest.TestCase):
    def test_tier3_skills_reference_html_template(self) -> None:
        for skill, expected_ref in SKILLS_REFERENCING_ARTIFACTS.items():
            with self.subTest(skill=skill):
                text = (ROOT / "skills" / skill / "SKILL.md").read_text()
                self.assertIn(expected_ref, text,
                              f"{skill}/SKILL.md must reference {expected_ref}")
                self.assertIn("{{PLACEHOLDERS}}", text,
                              f"{skill}/SKILL.md must instruct populating {{{{PLACEHOLDERS}}}}")


class TestWorkflowPhase6(unittest.TestCase):
    def test_workflow_skills_have_phase_6(self) -> None:
        for skill in WORKFLOW_SKILLS_WITH_PHASE_6:
            with self.subTest(skill=skill):
                text = (ROOT / "skills" / skill / "SKILL.md").read_text()
                self.assertIn("Phase 6", text,
                              f"{skill}/SKILL.md must include a Phase 6 section")
                self.assertIn("Follow dependencies", text,
                              f"{skill}/SKILL.md Phase 6 must be 'Follow dependencies'")
                # Loop guard: the prompt requires depth 2 cap.
                self.assertIn("depth 2", text,
                              f"{skill}/SKILL.md Phase 6 must cap recursion at depth 2")
                self.assertIn("service-health-card", text,
                              f"{skill}/SKILL.md Phase 6 must invoke service-health-card on the dependency")


if __name__ == "__main__":
    unittest.main()
