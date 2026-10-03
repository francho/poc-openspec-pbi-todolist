from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import date
from pathlib import Path

SUPPORTED_ENTRY_TYPES = frozenset({"task", "event", "note"})
ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class EntryValidationError(ValueError):
    """Raised when an entry does not satisfy the journal contract."""


@dataclass(frozen=True)
class Entry:
    id: int
    description: str
    entry_type: str
    entry_date: str


def validate_description(description: str) -> str:
    normalized = description.strip()
    if not normalized:
        raise EntryValidationError("description must not be empty")
    return normalized


def validate_entry_type(entry_type: str) -> str:
    normalized = entry_type.strip().lower()
    if normalized not in SUPPORTED_ENTRY_TYPES:
        raise EntryValidationError("entry type must be task, event, or note")
    return normalized


def validate_iso_date(entry_date: str) -> str:
    if not ISO_DATE_PATTERN.fullmatch(entry_date):
        raise EntryValidationError("entry date must use YYYY-MM-DD")
    try:
        date.fromisoformat(entry_date)
    except ValueError as error:
        raise EntryValidationError("entry date must be a valid calendar date") from error
    return entry_date


class EntryStore:
    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        description TEXT NOT NULL,
                        entry_type TEXT NOT NULL CHECK (entry_type IN ('task', 'event', 'note')),
                        entry_date TEXT NOT NULL
                    )
                    """
                )

    def create_entry(self, description: str, entry_type: str, entry_date: str) -> Entry:
        normalized_description = validate_description(description)
        normalized_type = validate_entry_type(entry_type)
        normalized_date = validate_iso_date(entry_date)
        with closing(self._connect()) as connection:
            with connection:
                cursor = connection.execute(
                    "INSERT INTO entries (description, entry_type, entry_date) VALUES (?, ?, ?)",
                    (normalized_description, normalized_type, normalized_date),
                )
                if cursor.lastrowid is None:
                    raise RuntimeError("SQLite did not return the new entry id")
                return Entry(cursor.lastrowid, normalized_description, normalized_type, normalized_date)

    def entries_for_date(self, entry_date: str) -> list[Entry]:
        normalized_date = validate_iso_date(entry_date)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT id, description, entry_type, entry_date FROM entries WHERE entry_date = ? ORDER BY id",
                (normalized_date,),
            ).fetchall()
        return [Entry(row["id"], row["description"], row["entry_type"], row["entry_date"]) for row in rows]