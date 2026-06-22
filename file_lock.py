"""Small cross-process file-lock helper for JSON store transactions."""

from __future__ import annotations

import fcntl
import os
from contextlib import contextmanager
from collections.abc import Iterator


@contextmanager
def exclusive_file_lock(lock_path: str) -> Iterator[None]:
    """Hold an exclusive advisory lock until the surrounding transaction ends."""
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with open(lock_path, "a", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
