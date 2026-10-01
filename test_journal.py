from __future__ import annotations

import sqlite3
import tempfile
import unittest
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
    def test_app_starts_with_configured_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "app.sqlite3"
            app = create_app({"TESTING": True, "DATABASE_PATH": database_path})
            response = app.test_client().get("/health")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(database_path.exists())


if __name__ == "__main__":
    unittest.main()