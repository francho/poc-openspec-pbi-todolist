from __future__ import annotations

import argparse
import importlib
import json
import os
import subprocess
import tempfile
import threading
from collections.abc import Callable, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from werkzeug.serving import BaseWSGIServer, make_server

from .app import create_app

Scenario = Callable[[Any, str, Path], list[str]]


def _create_entry(page: Any, base_url: str, output_dir: Path) -> list[str]:
    page.goto(f"{base_url}/day?date=2026-10-01")
    page.get_by_label("Description").fill("Plan the week")
    page.get_by_label("Task").check()
    page.get_by_role("button", name="Add entry").click()
    page.get_by_role("heading", name="Entries for 2026-10-01").wait_for()
    page.get_by_text("task: Plan the week", exact=True).wait_for()
    page.reload()
    page.get_by_text("task: Plan the week", exact=True).wait_for()
    screenshot = output_dir / "entry-created-and-reloaded.png"
    page.screenshot(path=screenshot, full_page=True)
    return [str(screenshot)]


def _validation_error(page: Any, base_url: str, output_dir: Path) -> list[str]:
    page.goto(f"{base_url}/day?date=2026-10-02")
    page.get_by_label("Description").fill("Missing type")
    page.get_by_role("button", name="Add entry").click()
    page.get_by_text("entry type must be task, event, or note", exact=True).wait_for()
    screenshot = output_dir / "missing-entry-type.png"
    page.screenshot(path=screenshot, full_page=True)
    return [str(screenshot)]


def _complete_and_reopen_task(page: Any, base_url: str, output_dir: Path) -> list[str]:
    page.goto(f"{base_url}/day?date=2026-10-03")
    page.get_by_label("Description").fill("Review the journal")
    page.get_by_label("Task").check()
    page.get_by_role("button", name="Add entry").click()
    checkbox = page.get_by_label("Complete Review the journal")
    checkbox.check()
    page.locator("li.completed").get_by_text("task: Review the journal", exact=True).wait_for()
    screenshot = output_dir / "task-completed-without-reload.png"
    page.screenshot(path=screenshot, full_page=True)
    checkbox.uncheck()
    page.locator("li:not(.completed)").get_by_text("task: Review the journal", exact=True).wait_for()
    return [str(screenshot)]


SCENARIOS: dict[str, Scenario] = {
    "create-entry": _create_entry,
    "validation-error": _validation_error,
    "complete-task": _complete_and_reopen_task,
}


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture evidence for selected journal scenarios.")
    parser.add_argument(
        "--scenario",
        action="append",
        choices=tuple(SCENARIOS),
        help="Scenario to capture. Repeat the option to select multiple scenarios.",
    )
    parser.add_argument(
        "--scenarios-from-change",
        action="store_true",
        help="Load scenarios from the active OpenSpec change demo.json manifest.",
    )
    parser.add_argument("--base-url", help="Capture an already running application instead of starting a temporary one.")
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/demo"))
    args = parser.parse_args(argv)
    if args.scenario is None and not args.scenarios_from_change:
        parser.error("provide --scenario or --scenarios-from-change")
    if args.scenario is not None and args.scenarios_from_change:
        parser.error("--scenario and --scenarios-from-change cannot be combined")
    duplicates = sorted({name for name in args.scenario or [] if (args.scenario or []).count(name) > 1})
    if duplicates:
        parser.error(f"duplicate scenarios: {', '.join(duplicates)}")
    return args


def _change_manifest_path(repository_root: Path) -> Path:
    changes_root = repository_root / "openspec" / "changes"
    requested_change = os.environ.get("OPENSPEC_CHANGE_NAME")
    if requested_change is not None:
        if Path(requested_change).name != requested_change:
            raise ValueError("OPENSPEC_CHANGE_NAME must be a change directory name")
        candidates = [changes_root / requested_change / "demo.json"]
    else:
        candidates = sorted(changes_root.glob("*/demo.json"))
        if len(candidates) > 1:
            raise ValueError("multiple active changes define demo scenarios; set OPENSPEC_CHANGE_NAME")
    if len(candidates) != 1 or not candidates[0].is_file():
        raise ValueError("active OpenSpec change must define openspec/changes/<change>/demo.json")
    return candidates[0]


def scenarios_from_change(repository_root: Path) -> list[str]:
    manifest_path = _change_manifest_path(repository_root)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid demo manifest {manifest_path}: {error}") from error
    scenarios = manifest.get("scenarios") if isinstance(manifest, dict) else None
    if not isinstance(scenarios, list) or not scenarios or any(not isinstance(name, str) for name in scenarios):
        raise ValueError(f"demo manifest {manifest_path} must contain a non-empty scenarios list")
    unknown = sorted(set(scenarios) - set(SCENARIOS))
    if unknown:
        raise ValueError(f"demo manifest {manifest_path} contains unknown scenarios: {', '.join(unknown)}")
    if len(set(scenarios)) != len(scenarios):
        raise ValueError(f"demo manifest {manifest_path} contains duplicate scenarios")
    return scenarios


def _head_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _wait_for_readiness(readiness_url: str) -> None:
    with urlopen(readiness_url, timeout=10) as response:
        if response.status != 200 or response.read().decode().strip() != "ok":
            raise RuntimeError(f"Readiness check failed for {readiness_url}")


def _relative_paths(paths: Sequence[str], repository_root: Path) -> list[str]:
    return [str(Path(path).resolve().relative_to(repository_root)) for path in paths]


def capture_demo(
    scenarios: Sequence[str],
    output_root: Path,
    base_url: str | None = None,
) -> dict[str, Any]:
    repository_root = Path.cwd().resolve()
    head_sha = _head_sha()
    bundle_dir = (output_root / head_sha).resolve()
    bundle_dir.relative_to(repository_root)
    bundle_dir.mkdir(parents=True, exist_ok=True)
    log_path = bundle_dir / "demo.log"
    scenario_results: list[dict[str, Any]] = []
    findings: list[str] = []
    readiness_observed = False
    server: BaseWSGIServer | None = None
    server_thread: threading.Thread | None = None
    temp_dir: tempfile.TemporaryDirectory[str] | None = None

    try:
        if base_url is None:
            temp_dir = tempfile.TemporaryDirectory()
            flask_app = create_app(
                {
                    "TESTING": True,
                    "DATABASE_PATH": Path(temp_dir.name) / "journal.sqlite3",
                }
            )
            server = make_server("127.0.0.1", 0, flask_app)
            server_thread = threading.Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            base_url = f"http://127.0.0.1:{server.server_port}"

        readiness_url = f"{base_url.rstrip('/')}/health"
        _wait_for_readiness(readiness_url)
        readiness_observed = True
        playwright_api = importlib.import_module("playwright.sync_api")
        with playwright_api.sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                for scenario_name in scenarios:
                    scenario_dir = bundle_dir / scenario_name
                    scenario_dir.mkdir(parents=True, exist_ok=True)
                    page = browser.new_page()
                    try:
                        evidence = SCENARIOS[scenario_name](page, base_url, scenario_dir)
                        scenario_results.append(
                            {
                                "name": scenario_name,
                                "status": "pass",
                                "evidence": _relative_paths(evidence, repository_root),
                            }
                        )
                    except Exception as error:
                        findings.append(f"{scenario_name}: {error}")
                        scenario_results.append({"name": scenario_name, "status": "fail", "evidence": []})
                    finally:
                        page.close()
            finally:
                browser.close()
    except Exception as error:
        findings.append(str(error))
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        if server_thread is not None:
            server_thread.join()
        if temp_dir is not None:
            temp_dir.cleanup()

    disposition = "ready" if not findings and len(scenario_results) == len(scenarios) else "failed"
    log_lines = [
        f"head_sha={head_sha}",
        f"base_url={base_url or ''}",
        *(f"scenario={result['name']} status={result['status']}" for result in scenario_results),
        *(f"finding={finding}" for finding in findings),
    ]
    log_path.write_text("\n".join(log_lines) + "\n", encoding="utf-8")
    manifest = {
        "headSha": head_sha,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "disposition": disposition,
        "baseUrl": base_url,
        "readinessUrl": f"{base_url.rstrip('/')}/health" if base_url else None,
        "readinessObserved": readiness_observed,
        "scenarios": scenario_results,
        "logs": [str(log_path.relative_to(repository_root))],
        "findings": findings,
    }
    manifest_path = bundle_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    scenarios = args.scenario or scenarios_from_change(Path.cwd())
    manifest = capture_demo(scenarios, args.output_dir, args.base_url)
    print(json.dumps(manifest, indent=2))
    return 0 if manifest["disposition"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())