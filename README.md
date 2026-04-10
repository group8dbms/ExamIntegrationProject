# Exam Integrity System DB Bootstrap

This workspace starts with the Postgres schema for the exam integrity platform. The database is designed for Neon Postgres and covers:

- users and sessions for admin, instructor, student, proctor, evaluator, and auditor roles
- exam scheduling, rules, question banks, and candidate registration
- autosave and final answer submission with tamper-detection hashing
- suspicious activity event logging and score-based case creation
- proctor flags, investigation workflow, evidence, evaluator marks, published results, recheck requests, and audit logs

## Files

- `sql/000_full_schema.sql`: single-file schema for Neon SQL Editor
- `sql/001_extensions.sql`: required Postgres extensions
- `sql/002_schema.sql`: core tables, enums, constraints, and indexes
- `sql/003_functions_triggers_views.sql`: hash logic, suspicion scoring, case automation, audit helper, and reporting view
- `sql/004_smoke_test.sql`: optional seed and verification script for a full integrity-flow demo
- `scripts/apply-neon-schema.ps1`: runs the SQL files against Neon using `psql`
- `docs/neon-setup.md`: step-by-step setup instructions

## Fastest Neon web flow

1. Open the Neon SQL Editor for your database.
2. Open `sql/000_full_schema.sql` from this workspace.
3. Copy-paste the full file into Neon and run it once.
4. Optional: open `sql/004_smoke_test.sql` and run it to verify the integrity workflow.

## Local CLI flow

1. Copy `.env.example` to `.env` and paste your Neon connection string into `DATABASE_URL`.
2. Install the PostgreSQL client so `psql` is available in PowerShell.
3. Run:

```powershell
cd C:\ExamIntegritySystem
Copy-Item .env.example .env
notepad .env
.\scripts\apply-neon-schema.ps1
```

## What the schema does automatically

- assigns default suspicion weights by event type
- increments candidate suspicion score on each integrity event
- opens or updates an investigation case when the exam threshold is crossed
- stores evidence entries from suspicious events inside the case workflow
- hashes final submissions with SHA-256 and supports later verification through `verify_submission_hash(uuid)`
- exposes `v_candidate_integrity_summary` for dashboards and reporting

## Suggested next build order

1. seed base users and one test exam
2. implement auth/session APIs
3. implement exam delivery and autosave APIs
4. stream integrity events from the browser and login/session service
5. build proctor and auditor dashboards on top of `v_candidate_integrity_summary`
