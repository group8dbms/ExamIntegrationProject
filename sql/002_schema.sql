DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'instructor', 'student', 'proctor', 'evaluator', 'auditor');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exam_status') THEN
        CREATE TYPE exam_status AS ENUM ('draft', 'scheduled', 'live', 'completed', 'archived');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_status') THEN
        CREATE TYPE submission_status AS ENUM ('in_progress', 'submitted', 'late_submitted', 'under_review', 'graded', 'closed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integrity_event_type') THEN
        CREATE TYPE integrity_event_type AS ENUM (
            'tab_switch',
            'copy_attempt',
            'paste_attempt',
            'multiple_login',
            'ip_change',
            'device_change',
            'fullscreen_exit',
            'network_change',
            'webcam_block',
            'screen_share_block',
            'face_absent'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_status') THEN
        CREATE TYPE case_status AS ENUM ('open', 'under_review', 'escalated', 'cleared', 'confirmed_cheating', 'resolved');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'decision_type') THEN
        CREATE TYPE decision_type AS ENUM ('no_issue', 'warning', 'invalidate_exam', 'manual_review');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'result_status') THEN
        CREATE TYPE result_status AS ENUM ('draft', 'published', 'withheld');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recheck_status') THEN
        CREATE TYPE recheck_status AS ENUM ('requested', 'accepted', 'rejected', 'adjusted');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_user (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL,
    password_hash TEXT,
    password_reset_token_hash TEXT,
    password_reset_sent_at TIMESTAMPTZ,
    password_reset_expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_session (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id),
    login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logout_at TIMESTAMPTZ,
    ip_address INET,
    device_fingerprint TEXT,
    user_agent TEXT,
    session_token_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS exam (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    course_code TEXT NOT NULL,
    status exam_status NOT NULL DEFAULT 'draft',
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    integrity_threshold NUMERIC(6,2) NOT NULL DEFAULT 10,
    rules JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_by UUID NOT NULL REFERENCES app_user(id),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS question_bank (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    created_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS question (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES app_user(id),
    question_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::JSONB,
    correct_answer JSONB,
    default_marks NUMERIC(8,2) NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (default_marks >= 0)
);

CREATE TABLE IF NOT EXISTS exam_question (
    exam_id UUID NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
    question_id UUID NOT NULL,
    sequence_no INTEGER NOT NULL,
    marks_override NUMERIC(8,2),
    question_type_snapshot TEXT,
    prompt_snapshot TEXT,
    options_snapshot JSONB NOT NULL DEFAULT '[]'::JSONB,
    correct_answer_snapshot JSONB,
    default_marks_snapshot NUMERIC(8,2),
    metadata_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (exam_id, question_id),
    UNIQUE (exam_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS exam_candidate (
    exam_id UUID NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES app_user(id),
    attempt_no INTEGER NOT NULL DEFAULT 1,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    status submission_status NOT NULL DEFAULT 'in_progress',
    suspicion_score NUMERIC(8,2) NOT NULL DEFAULT 0,
    last_ip INET,
    last_device TEXT,
    PRIMARY KEY (exam_id, student_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS answer_submission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL,
    student_id UUID NOT NULL,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    current_answers JSONB NOT NULL DEFAULT '{}'::JSONB,
    final_answers JSONB,
    autosave_version INTEGER NOT NULL DEFAULT 0,
    final_submitted_at TIMESTAMPTZ,
    status submission_status NOT NULL DEFAULT 'in_progress',
    submission_hash TEXT,
    hash_algorithm TEXT NOT NULL DEFAULT 'sha256',
    hash_verified BOOLEAN NOT NULL DEFAULT FALSE,
    storage_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_submission_candidate FOREIGN KEY (exam_id, student_id, attempt_no)
        REFERENCES exam_candidate(exam_id, student_id, attempt_no) ON DELETE CASCADE,
    UNIQUE (exam_id, student_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS integrity_event (
    id BIGSERIAL PRIMARY KEY,
    exam_id UUID NOT NULL,
    student_id UUID NOT NULL,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    session_id BIGINT REFERENCES user_session(id),
    event_type integrity_event_type NOT NULL,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    weight NUMERIC(8,2),
    ip_address INET,
    device_fingerprint TEXT,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_by UUID REFERENCES app_user(id),
    CONSTRAINT fk_event_candidate FOREIGN KEY (exam_id, student_id, attempt_no)
        REFERENCES exam_candidate(exam_id, student_id, attempt_no) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proctor_flag (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL,
    student_id UUID NOT NULL,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    flagged_by UUID NOT NULL REFERENCES app_user(id),
    severity SMALLINT NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_flag_candidate FOREIGN KEY (exam_id, student_id, attempt_no)
        REFERENCES exam_candidate(exam_id, student_id, attempt_no) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integrity_case (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL,
    student_id UUID NOT NULL,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_by UUID REFERENCES app_user(id),
    status case_status NOT NULL DEFAULT 'open',
    current_score NUMERIC(8,2) NOT NULL,
    threshold_at_open NUMERIC(8,2) NOT NULL,
    summary TEXT,
    decision decision_type,
    decision_notes TEXT,
    closed_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES app_user(id),
    CONSTRAINT fk_case_candidate FOREIGN KEY (exam_id, student_id, attempt_no)
        REFERENCES exam_candidate(exam_id, student_id, attempt_no) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS case_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES integrity_case(id) ON DELETE CASCADE,
    evidence_type TEXT NOT NULL,
    source_ref TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    added_by UUID REFERENCES app_user(id),
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_action (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES integrity_case(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    note TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    action_by UUID REFERENCES app_user(id),
    action_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evaluation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL UNIQUE REFERENCES answer_submission(id) ON DELETE CASCADE,
    evaluator_id UUID NOT NULL REFERENCES app_user(id),
    awarded_marks NUMERIC(10,2) NOT NULL DEFAULT 0,
    feedback TEXT,
    rubric_breakdown JSONB NOT NULL DEFAULT '{}'::JSONB,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (awarded_marks >= 0)
);

CREATE TABLE IF NOT EXISTS result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES app_user(id),
    submission_id UUID NOT NULL UNIQUE REFERENCES answer_submission(id) ON DELETE CASCADE,
    total_marks NUMERIC(10,2) NOT NULL,
    awarded_marks NUMERIC(10,2) NOT NULL,
    percentage NUMERIC(6,2) GENERATED ALWAYS AS (
        CASE
            WHEN total_marks > 0 THEN ROUND((awarded_marks / total_marks) * 100, 2)
            ELSE 0
        END
    ) STORED,
    integrity_score NUMERIC(8,2) NOT NULL DEFAULT 0,
    case_status case_status,
    submission_hash_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status result_status NOT NULL DEFAULT 'draft',
    published_by UUID REFERENCES app_user(id),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (total_marks >= 0),
    CHECK (awarded_marks >= 0)
);

CREATE TABLE IF NOT EXISTS recheck_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id UUID NOT NULL REFERENCES result(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES app_user(id),
    reason TEXT NOT NULL,
    status recheck_status NOT NULL DEFAULT 'requested',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES app_user(id),
    reviewed_at TIMESTAMPTZ,
    decision_notes TEXT,
    adjusted_marks NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES app_user(id),
    actor_role user_role,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    details JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_exam_status ON exam(status, start_at);
CREATE INDEX IF NOT EXISTS idx_exam_candidate_score ON exam_candidate(exam_id, suspicion_score DESC);
CREATE INDEX IF NOT EXISTS idx_submission_lookup ON answer_submission(exam_id, student_id, attempt_no);
CREATE INDEX IF NOT EXISTS idx_integrity_event_candidate ON integrity_event(exam_id, student_id, attempt_no, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_integrity_case_status ON integrity_case(status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_result_exam_student ON result(exam_id, student_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, occurred_at DESC);
