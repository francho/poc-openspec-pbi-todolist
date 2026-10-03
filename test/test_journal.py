from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from app import create_app
from journal import EntryStore, EntryValidationError


class EntryStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "journal.sqlite3"
        self.store = EntryStore(self.database_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_initialization_creates_sqlite_database(self) -> None:
        self.assertTrue(self.database_path.exists())
        with sqlite3.connect(self.database_path) as connection:
            columns = connection.execute("PRAGMA table_info(entries)").fetchall()
        self.assertEqual([column[1] for column in columns], ["id", "description", "entry_type", "entry_date"])

    def test_create_and_reload_entry_for_one_iso_date(self) -> None:
        created = self.store.create_entry("Plan the week", "task", "2026-10-01")
        reloaded = EntryStore(self.database_path).entries_for_date("2026-10-01")
        self.assertEqual(reloaded, [created])
        self.assertEqual(EntryStore(self.database_path).entries_for_date("2026-10-02"), [])

    def test_supported_types_are_persisted(self) -> None:
        for entry_type in ("task", "event", "note"):
            entry = self.store.create_entry(f"A {entry_type}", entry_type, "2026-10-01")
            self.assertEqual(entry.entry_type, entry_type)

    def test_description_and_type_are_normalized(self) -> None:
        entry = self.store.create_entry("  Plan the week  ", " TASK ", "2026-10-01")
        self.assertEqual(entry.description, "Plan the week")
        self.assertEqual(entry.entry_type, "task")

    def test_invalid_values_are_rejected(self) -> None:
        invalid_values = [
            ("", "task", "2026-10-01"),
            ("Description", "unsupported", "2026-10-01"),
            ("Description", "task", "2026-1-1"),
            ("Description", "task", "2026-02-30"),
        ]
        for values in invalid_values:
            with self.subTest(values=values), self.assertRaises(EntryValidationError):
                self.store.create_entry(*values)


class FlaskAppTests(unittest.TestCase):
    def create_test_app(self, temp_dir: str):
        return create_app({"TESTING": True, "DATABASE_PATH": Path(temp_dir) / "app.sqlite3"})

    def test_app_starts_with_configured_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "app.sqlite3"
            app = create_app({"TESTING": True, "DATABASE_PATH": database_path})
            response = app.test_client().get("/health")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(database_path.exists())

    def test_root_redirects_to_day_view(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            response = self.create_test_app(temp_dir).test_client().get("/")
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.headers["Location"], "/day")

    def test_day_view_uses_today_when_date_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            response = self.create_test_app(temp_dir).test_client().get("/day")
            self.assertEqual(response.status_code, 200)
            self.assertIn(f"Entries for {date.today().isoformat()}".encode(), response.data)

    def test_daily_flow_creates_and_retains_each_supported_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app = create_app({"TESTING": True, "DATABASE_PATH": Path(temp_dir) / "app.sqlite3"})
            client = app.test_client()
            for entry_type in ("task", "event", "note"):
                response = client.post(
                    "/entries",
                    data={"description": f"A {entry_type}", "entry_type": entry_type, "entry_date": "2026-10-01"},
                )
                self.assertEqual(response.status_code, 302)
            response = client.get("/day?date=2026-10-01")
            self.assertEqual(response.status_code, 200)
            for entry_type in ("task", "event", "note"):
                self.assertIn(f"A {entry_type}".encode(), response.data)

    def test_daily_flow_shows_validation_feedback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app = self.create_test_app(temp_dir)
            client = app.test_client()
            client.post(
                "/entries",
                data={"description": "Existing entry", "entry_type": "note", "entry_date": "2026-10-01"},
            )
            for data, message in (
                ({"description": "", "entry_type": "task", "entry_date": "2026-10-01"}, b"description must not be empty"),
                ({"description": "Missing type", "entry_type": "", "entry_date": "2026-10-01"}, b"entry type must be task, event, or note"),
            ):
                response = client.post("/entries", data=data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(message, response.data)
                self.assertIn(b"Existing entry", response.data)

    def test_day_view_rejects_non_iso_dates(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            response = self.create_test_app(temp_dir).test_client().get("/day?date=2026-02-30")
            self.assertEqual(response.status_code, 400)

    def test_invalid_entry_date_is_rejected_without_creating_entry(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app = self.create_test_app(temp_dir)
            client = app.test_client()
            response = client.post(
                "/entries",
                data={"description": "Invalid date", "entry_type": "task", "entry_date": "2026-02-30"},
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn(b"entry date must be a valid calendar date", response.data)


if __name__ == "__main__":
    unittest.main()