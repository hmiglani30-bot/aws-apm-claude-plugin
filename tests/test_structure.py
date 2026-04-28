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
}

EXPECTED_COMMANDS = {
    "cw-investigate-slo.md",
    "cw-investigate-latency.md",
    "cw-investigate-errors.md",
    "cw-alarm-response.md",
    "cw-slo-report.md",
}

EXPECTED_MCP_SERVERS = {
    "awslabs.cloudwatch-mcp-server",
    "awslabs.cloudwatch-applicationsignals-mcp-server",
    "awslabs.cloudtrail-mcp-server",
    "awslabs.aws-documentation-mcp-server",
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


if __name__ == "__main__":
    unittest.main()
