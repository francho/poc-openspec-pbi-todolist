from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.demo import capture_demo, parse_args, scenarios_from_change


class DemoArgumentsTests(unittest.TestCase):
    def test_accepts_multiple_scenarios_in_requested_order(self) -> None:
        args = parse_args(["--scenario", "validation-error", "--scenario", "create-entry"])
        self.assertEqual(args.scenario, ["validation-error", "create-entry"])

    def test_requires_at_least_one_scenario(self) -> None:
        with self.assertRaises(SystemExit):
            parse_args([])

    def test_rejects_unknown_scenario(self) -> None:
        with self.assertRaises(SystemExit):
            parse_args(["--scenario", "unknown"])

    def test_rejects_duplicate_scenarios(self) -> None:
        with self.assertRaises(SystemExit):
            parse_args(["--scenario", "create-entry", "--scenario", "create-entry"])

    def test_accepts_change_manifest_selector(self) -> None:
        args = parse_args(["--scenarios-from-change"])
        self.assertTrue(args.scenarios_from_change)


class DemoManifestTests(unittest.TestCase):
    def test_loads_scenarios_from_active_change(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repository_root = Path(temp_dir)
            manifest_path = repository_root / "openspec" / "changes" / "pbi-2-example" / "demo.json"
            manifest_path.parent.mkdir(parents=True)
            manifest_path.write_text(json.dumps({"scenarios": ["create-entry"]}), encoding="utf-8")

            self.assertEqual(scenarios_from_change(repository_root), ["create-entry"])


class DemoCaptureTests(unittest.TestCase):
    @patch("app.demo._head_sha", return_value="a" * 40)
    @patch("app.demo._wait_for_readiness", side_effect=RuntimeError("application unavailable"))
    def test_readiness_failure_writes_failed_manifest(self, _readiness, _head_sha) -> None:
        with TemporaryDirectory(dir=Path.cwd()) as temp_dir:
            manifest = capture_demo(["create-entry"], Path(temp_dir), "http://127.0.0.1:1")
            manifest_path = Path(temp_dir) / ("a" * 40) / "manifest.json"

            self.assertEqual(manifest["disposition"], "failed")
            self.assertFalse(manifest["readinessObserved"])
            self.assertEqual(manifest["scenarios"], [])
            self.assertTrue(manifest_path.exists())


if __name__ == "__main__":
    unittest.main()