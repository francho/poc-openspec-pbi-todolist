from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, redirect, render_template, request, url_for

from .journal import EntryStore, EntryValidationError, validate_iso_date


def create_app(test_config: dict[str, object] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        DATABASE_PATH=os.environ.get(
            "JOURNAL_DATABASE",
            Path(__file__).resolve().parent.parent / "instance" / "journal.sqlite3",
        ),
    )
    if test_config is not None:
        app.config.update(test_config)

    app.extensions["entry_store"] = EntryStore(Path(app.config["DATABASE_PATH"]))

    @app.get("/health")
    def health() -> tuple[str, int]:
        return "ok", 200

    @app.get("/")
    def index():
        return redirect(url_for("day_view"))

    @app.get("/day")
    def day_view():
        selected_date = request.args.get("date", "")
        if not selected_date:
            from datetime import date

            selected_date = date.today().isoformat()
        try:
            validate_iso_date(selected_date)
        except EntryValidationError as error:
            return str(error), 400
        store = app.extensions["entry_store"]
        return render_template("day.html", selected_date=selected_date, entries=store.entries_for_date(selected_date), error=None)

    @app.post("/entries")
    def create_entry():
        selected_date = request.form.get("entry_date", "")
        try:
            store = app.extensions["entry_store"]
            store.create_entry(
                request.form.get("description", ""),
                request.form.get("entry_type", ""),
                selected_date,
            )
        except EntryValidationError as error:
            entries = []
            try:
                validate_iso_date(selected_date)
                entries = app.extensions["entry_store"].entries_for_date(selected_date)
            except EntryValidationError:
                pass
            return render_template("day.html", selected_date=selected_date, entries=entries, error=str(error)), 400
        return redirect(url_for("day_view", date=selected_date))

    return app


app = create_app()