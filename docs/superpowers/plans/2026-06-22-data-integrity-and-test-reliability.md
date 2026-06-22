# Data Integrity and Test Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sealed connexes immutable, allocate real boxes for `separate`, serialize JSON mutations across workers, and restore a collectable test suite.

**Architecture:** Add a reusable `fcntl` lock context manager and hold locks across each store's complete read-modify-write transaction. Keep JSON and atomic replacement. Enforce sealed state in the connex store, translate its typed exception at the Flask boundary, and repair test modules without changing authentication.

**Tech Stack:** Python 3.11, Flask 3, JSON files, SQLite job store, pytest/unittest, `fcntl.flock`.

---

### Task 1: Cross-process JSON mutation locking

**Files:**
- Create: `file_lock.py`
- Modify: `connex_store.py`
- Modify: `profiles.py`
- Test: `test_connex.py`
- Test: `test_profiles.py`

- [ ] **Step 1: Write failing concurrency tests**

Add tests that coordinate two threads so both update different fields of one connex and two threads upsert the same profile identity. Assert both connex fields survive and only one profile JSON exists.

- [ ] **Step 2: Verify the tests fail**

Run: `python3 -m pytest test_connex.py::TestConcurrentMutations test_profiles.py::TestConcurrentMutations -v`

Expected: at least one lost-update or duplicate-profile assertion fails before locking exists.

- [ ] **Step 3: Add the lock helper and locked store transactions**

Implement:

```python
@contextmanager
def exclusive_file_lock(lock_path: str):
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with open(lock_path, "a", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
```

Use per-connex lock files for connex mutations and one store lock for profile upserts/touches. Keep `_atomic_write` inside each lock.

- [ ] **Step 4: Verify concurrency tests pass**

Run the Task 1 command and expect all tests to pass.

### Task 2: Sealed-state enforcement

**Files:**
- Modify: `connex_store.py`
- Modify: `app.py`
- Test: `test_connex.py`

- [ ] **Step 1: Write failing store and route tests**

Create a valid sealed connex and assert `patch_connex`, `attach_ingest_job`, `apply_bom_assignments`, `add_box`, `remove_box`, and `save_connex` reject mutation. Assert PUT and attach routes return `409` with code `SEALED`.

- [ ] **Step 2: Verify failures**

Run: `python3 -m pytest test_connex.py -k sealed -v`

Expected: new PUT/attach and store tests fail because sealed mutation currently succeeds.

- [ ] **Step 3: Implement typed sealed errors**

Add `ConnexSealedError`, check status while holding the per-connex lock, and register a Flask error handler returning:

```json
{"error": "Connex is sealed — changes are locked.", "code": "SEALED"}
```

Keep `seal_connex` idempotent and perform its validation/write under the same lock.

- [ ] **Step 4: Verify sealed tests pass**

Run the Task 2 command and expect all sealed tests to pass.

### Task 3: Real box allocation for `separate`

**Files:**
- Modify: `connex_store.py`
- Modify: `app.py`
- Test: `test_connex.py`

- [ ] **Step 1: Write a failing route regression**

Build a two-box connex whose occupied boxes are 1 and 2, submit `{separate: true}`, and assert the returned connex contains box 3 with the BOM ID and the job item map also targets box 3.

- [ ] **Step 2: Verify the test fails**

Run: `python3 -m pytest test_connex.py -k separate_creates_real_box -v`

Expected: the item map targets box 3 while no returned box contains the BOM.

- [ ] **Step 3: Allocate and refresh the box before assignment**

Use the locked `add_box` operation for `separate`, refresh `connex` and `valid_box_nums`, then assign the BOM to the returned box number. Reuse that number when reflecting assignments into connex JSON.

- [ ] **Step 4: Verify the regression passes**

Run the Task 3 command and expect it to pass.

### Task 4: Pytest-safe legacy and end-to-end tests

**Files:**
- Modify: `test_packing.py`
- Modify: `test_e2e.py`
- Modify: `test_grouping.py`

- [ ] **Step 1: Capture the existing collection failures**

Run: `python3 -m pytest --collect-only -q`

Expected: import-time `SystemExit`, hardcoded fixture `FileNotFoundError`, or stale `app.JOBS` failures.

- [ ] **Step 2: Guard executable-only code and external fixtures**

Move direct execution in `test_packing.py` and `test_e2e.py` behind `main()` plus `if __name__ == "__main__"`. Expose a pytest test for the packing script and skip E2E cleanly when fixture paths are absent.

- [ ] **Step 3: Migrate grouping tests to `job_store`**

Replace writes and reads through `flask_app.JOBS` with `job_store.save_job()` and `job_store.load_job()`.

- [ ] **Step 4: Verify collection and focused tests**

Run:

```bash
python3 -m pytest --collect-only -q
python3 -m pytest test_grouping.py -v
python3 test_packing.py
```

Expected: collection succeeds, grouping passes, and the packing script reports 73/73.

### Task 5: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Update persistence and worker documentation**

Document SQLite-backed jobs, locked JSON profile/connex writes, and the supported multi-worker start command.

- [ ] **Step 2: Run full verification**

Run:

```bash
python3 -m pytest -q
python3 test_packing.py
git diff --check
```

Expected: all collectable tests pass, the standalone packing checks pass 73/73, and no whitespace errors are reported.

- [ ] **Step 3: Review the final diff**

Confirm authentication remains unchanged, no persisted test data is tracked, and every requested finding has a regression test.
