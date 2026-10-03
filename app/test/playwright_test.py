from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path

from playwright.sync_api import Page, sync_playwright
from werkzeug.serving import BaseWSGIServer, make_server

from app import create_app


class JournalBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        app = create_app(
            {
                "TESTING": True,
                "DATABASE_PATH": Path(self.temp_dir.name) / "journal.sqlite3",
            }
        )
        self.server: BaseWSGIServer = make_server("127.0.0.1", 0, app)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.page: Page = self.browser.new_page()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.page.close()
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join()
        self.temp_dir.cleanup()

    def test_user_can_create_and_reload_a_daily_entry(self) -> None:
        self.page.goto(f"{self.base_url}/day?date=2026-10-01")

        self.page.get_by_label("Description").fill("Plan the week")
        self.page.get_by_label("Task").check()
        self.page.get_by_role("button", name="Add entry").click()

        self.page.get_by_role("heading", name="Entries for 2026-10-01").wait_for()
        self.page.get_by_text("task: Plan the week", exact=True).wait_for()
        self.page.reload()
        self.page.get_by_text("task: Plan the week", exact=True).wait_for()

    def test_user_sees_validation_feedback_for_missing_entry_type(self) -> None:
        self.page.goto(f"{self.base_url}/day?date=2026-10-01")

        self.page.get_by_label("Description").fill("Missing type")
        self.page.get_by_role("button", name="Add entry").click()

        self.page.get_by_text("entry type must be task, event, or note", exact=True).wait_for()


if __name__ == "__main__":
    unittest.main()