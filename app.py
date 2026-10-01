from __future__ import annotations

import os
from pathlib import Path

from flask import Flask

from journal import EntryStore


def create_app(test_config: dict[str, object] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        DATABASE_PATH=os.environ.get("JOURNAL_DATABASE", "instance/journal.sqlite3"),
    )
    if test_config is not None:
        app.config.update(test_config)

    app.extensions["entry_store"] = EntryStore(Path(app.config["DATABASE_PATH"]))

    @app.get("/health")
    def health() -> tuple[str, int]:
        return "ok", 200

    return app


app = create_app()


if __name__ == "__main__":
    app.run()