from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from app import create_app
from app.journal import EntryStore, EntryValidationError


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
        self.assertEqual(
            [column[1] for column in columns],
            ["id", "description", "entry_type", "entry_date", "completed_at"],
        )

    def test_initialization_migrates_legacy_database(self) -> None:
        with sqlite3.connect(self.database_path) as connection:
            connection.execute(
                "CREATE TABLE entries (id INTEGER PRIMARY KEY, description TEXT NOT NULL, "
                "entry_type TEXT NOT NULL, entry_date TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT INTO entries VALUES (1, 'Legacy task', 'task', '2026-10-01')"
            )
        migrated = EntryStore(self.database_path).entries_for_date("2026-10-01")
        self.assertEqual(migrated[0].completed_at, None)

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

    def test_task_can_be_completed_and_reopened(self) -> None:
        task = self.store.create_entry("Plan the week", "task", "2026-10-01")
        completed = self.store.set_completion(task.id, True)
        self.assertTrue(completed.completed)
        self.assertIsNotNone(completed.completed_at)
        reopened = self.store.set_completion(task.id, False)
        self.assertFalse(reopened.completed)
        self.assertIsNone(reopened.completed_at)

    def test_completion_preserves_entry_and_rejects_non_tasks(self) -> None:
        task = self.store.create_entry("Keep this", "task", "2026-10-01")
        event = self.store.create_entry("Meeting", "event", "2026-10-01")
        completed = self.store.set_completion(task.id, True)
        self.assertEqual(completed.description, task.description)
        self.assertEqual(completed.entry_date, task.entry_date)
        with self.assertRaisesRegex(EntryValidationError, "only tasks"):
            self.store.set_completion(event.id, True)
        self.assertFalse(self.store.entries_for_date("2026-10-01")[1].completed)


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

    def test_completion_api_completes_and_reopens_task_without_removing_it(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app = self.create_test_app(temp_dir)
            client = app.test_client()
            task = app.extensions["entry_store"].create_entry("Task", "task", "2026-10-01")
            app.extensions["entry_store"].create_entry("Note", "note", "2026-10-01")
            response = client.post(f"/entries/{task.id}/completion", json={"completed": True})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json["completed"])
            self.assertEqual(len(app.extensions["entry_store"].entries_for_date("2026-10-01")), 2)
            response = client.post(f"/entries/{task.id}/completion", json={"completed": False})
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json["completed"])

    def test_completion_api_rejects_non_tasks_and_bad_requests_safely(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app = self.create_test_app(temp_dir)
            client = app.test_client()
            event = app.extensions["entry_store"].create_entry("Meeting", "event", "2026-10-01")
            response = client.post(f"/entries/{event.id}/completion", json={"completed": True})
            self.assertEqual(response.status_code, 400)
            self.assertIn("only tasks", response.json["error"])
            self.assertFalse(app.extensions["entry_store"].entries_for_date("2026-10-01")[0].completed)
            self.assertEqual(client.post(f"/entries/{event.id}/completion", json={}).status_code, 400)
            self.assertEqual(client.post("/entries/999/completion", json={"completed": True}).status_code, 404)

    def test_day_view_distinguishes_completed_and_pending_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            app = self.create_test_app(temp_dir)
            store = app.extensions["entry_store"]
            completed = store.create_entry("Done", "task", "2026-10-01")
            store.create_entry("Next", "task", "2026-10-01")
            store.set_completion(completed.id, True)
            response = app.test_client().get("/day?date=2026-10-01")
            self.assertEqual(response.status_code, 200)
            self.assertIn(b'class="entry completed"', response.data)
            self.assertIn(b'aria-label="Complete Next"', response.data)
            self.assertIn(b"task: Done", response.data)
            self.assertIn(b"task: Next", response.data)


if __name__ == "__main__":
    unittest.main()