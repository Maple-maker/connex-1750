# Data Integrity and Test Reliability Design

## Scope

Address the reviewed defects in sealed-record immutability, `separate` box allocation,
concurrent JSON updates, and test collection. Authentication and authorization are
explicitly out of scope.

## Persistence and concurrency

Keep the existing human-readable JSON stores. Add a small cross-process locking helper
based on `fcntl.flock`, which is available on the supported macOS development and Linux
Railway environments. Each connex mutation holds a per-connex exclusive lock across the
complete load, validation, mutation, and atomic-replace sequence. Profile upserts and
touches hold a store-wide profile lock because an upsert scans the collection before
choosing which profile to update.

Atomic replacement remains responsible for preventing partial JSON files. Locking is
responsible for preventing lost updates between Gunicorn workers and threads.

## Sealed connexes

The store layer, not only Flask routes, owns the sealed-state invariant. Every operation
that changes a connex rejects a record whose status is `sealed`, including scalar/box
patches, ingest-job attachment, assignment reflection, box addition/removal, and direct
save operations. A typed store exception communicates this condition to Flask, which
returns HTTP 409 with code `SEALED`.

Sealing is idempotent: sealing an already sealed connex returns its existing state.
No unseal operation is introduced.

## Separate-box allocation

The connex assignment route interprets `separate` as a request for a new, real dedicated
box. It allocates that box through the locked connex store, refreshes the connex, and only
then writes the BOM's item mappings to the new box. The response and persisted connex must
refer to the same box number, and generated documents must include the separated BOM.

## Test reliability

- Convert `test_packing.py` from an import-time executable into a pytest-safe module while
  preserving direct script execution.
- Make `test_e2e.py` skip cleanly when its external PDF fixture directory is unavailable;
  it must not open files during collection.
- Replace stale `app.JOBS` use in `test_grouping.py` with `job_store` operations.
- Add focused regressions for sealed mutation rejection, real-box allocation, and
  serialized concurrent updates.

## Validation

Run each new regression in red/green order, then run the complete pytest suite. Direct
script compatibility for `test_packing.py` is also verified with `python3 test_packing.py`.
