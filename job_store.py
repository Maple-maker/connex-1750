"""
job_store.py — SQLite-backed persistence for ingest jobs.

Replaces the JOBS in-memory dict.  Each job is stored as a JSON blob.
The assigned_bom_ids set is serialized as a list and restored on load.
DB lives at data/jobs.db alongside the connex and profile stores.
"""

import json
import os
import sqlite3

_BASE = os.path.dirname(os.path.abspath(__file__))
_DB   = os.path.join(_BASE, "data", "jobs.db")


def init_db() -> None:
    """Create the jobs table if it doesn't exist.  Call once at app startup."""
    os.makedirs(os.path.dirname(_DB), exist_ok=True)
    con = sqlite3.connect(_DB)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id     TEXT PRIMARY KEY,
            data       TEXT NOT NULL,
            created_at TEXT
        )
    """)
    con.commit()
    con.close()


def _enc(job: dict) -> str:
    j = dict(job)
    if isinstance(j.get("assigned_bom_ids"), set):
        j["assigned_bom_ids"] = list(j["assigned_bom_ids"])
    return json.dumps(j)


def _dec(text: str) -> dict:
    j = json.loads(text)
    if "assigned_bom_ids" in j:
        j["assigned_bom_ids"] = set(j["assigned_bom_ids"])
    return j


def save_job(job_id: str, job: dict) -> None:
    con = sqlite3.connect(_DB)
    con.execute(
        "INSERT OR REPLACE INTO jobs (job_id, data, created_at) VALUES (?, ?, ?)",
        (job_id, _enc(job), job.get("created_at", "")),
    )
    con.commit()
    con.close()


def load_job(job_id: str) -> dict | None:
    con = sqlite3.connect(_DB)
    row = con.execute(
        "SELECT data FROM jobs WHERE job_id = ?", (job_id,)
    ).fetchone()
    con.close()
    return _dec(row[0]) if row else None


def job_exists(job_id: str) -> bool:
    con = sqlite3.connect(_DB)
    row = con.execute(
        "SELECT 1 FROM jobs WHERE job_id = ?", (job_id,)
    ).fetchone()
    con.close()
    return row is not None
