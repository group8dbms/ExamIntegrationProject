# Neon Setup Steps

## Option A: Use Neon SQL Editor online

This is the easiest path if you are using Neon directly in the browser.

1. Create your Neon project and database.
2. Open the SQL Editor in Neon.
3. Open [000_full_schema.sql](C:\ExamIntegritySystem\sql\000_full_schema.sql) locally.
4. Copy the full file contents into Neon SQL Editor.
5. Click Run.
6. Optional: open [004_smoke_test.sql](C:\ExamIntegritySystem\sql\004_smoke_test.sql), paste it into Neon SQL Editor, and run it.

After that, verify with these queries in Neon:

```sql
SELECT * FROM v_candidate_integrity_summary;
SELECT id, status, current_score FROM integrity_case ORDER BY opened_at DESC;
SELECT id, awarded_marks, integrity_score, case_status, submission_hash_verified FROM result ORDER BY created_at DESC;
```

## Core logic summary

- `answer_submission.submission_hash` stores a SHA-256 digest of the final answer payload.
- `verify_submission_hash(uuid)` recomputes the hash and updates `hash_verified`.
- `integrity_event` rows raise the candidate suspicion score using default weights.
- when the score reaches the exam threshold, an `integrity_case` is created or updated automatically.
- `result` stores the final output you asked for: `integrity_score`, `case_status`, and `submission_hash_verified`.
