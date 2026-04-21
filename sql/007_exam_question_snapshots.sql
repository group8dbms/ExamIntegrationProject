ALTER TABLE exam_question
  ADD COLUMN IF NOT EXISTS question_type_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS prompt_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS options_snapshot JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS correct_answer_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS default_marks_snapshot NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS metadata_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

UPDATE exam_question eq
SET
  question_type_snapshot = COALESCE(eq.question_type_snapshot, q.question_type),
  prompt_snapshot = COALESCE(eq.prompt_snapshot, q.prompt),
  options_snapshot = CASE
    WHEN eq.options_snapshot IS NULL OR eq.options_snapshot = '[]'::jsonb THEN COALESCE(q.options, '[]'::jsonb)
    ELSE eq.options_snapshot
  END,
  correct_answer_snapshot = COALESCE(eq.correct_answer_snapshot, q.correct_answer),
  default_marks_snapshot = COALESCE(eq.default_marks_snapshot, q.default_marks),
  metadata_snapshot = CASE
    WHEN eq.metadata_snapshot IS NULL OR eq.metadata_snapshot = '{}'::jsonb THEN COALESCE(q.metadata, '{}'::jsonb)
    ELSE eq.metadata_snapshot
  END
FROM question q
WHERE q.id = eq.question_id;

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT tc.constraint_name
    INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'exam_question'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'question_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE exam_question DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;
