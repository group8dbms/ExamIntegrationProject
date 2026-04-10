BEGIN;

DROP TRIGGER IF EXISTS trg_apply_integrity_event ON integrity_event;
DROP TRIGGER IF EXISTS trg_default_integrity_event_weight ON integrity_event;

CREATE TABLE IF NOT EXISTS integrity_penalty_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id BIGINT NOT NULL UNIQUE REFERENCES integrity_event(id) ON DELETE CASCADE,
    exam_id UUID NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    penalty_points NUMERIC(8,2) NOT NULL DEFAULT 0,
    note TEXT,
    assigned_by UUID REFERENCES app_user(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_penalty_exam_student
    ON integrity_penalty_assignment(exam_id, student_id, attempt_no, assigned_at DESC);

COMMIT;
