CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

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
            'webcam_block'
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

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION integrity_event_default_weight(p_event_type integrity_event_type)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_event_type
        WHEN 'tab_switch' THEN 1.50
        WHEN 'copy_attempt' THEN 3.00
        WHEN 'paste_attempt' THEN 2.00
        WHEN 'multiple_login' THEN 4.00
        WHEN 'ip_change' THEN 2.50
        WHEN 'device_change' THEN 3.50
        WHEN 'fullscreen_exit' THEN 2.00
        WHEN 'network_change' THEN 1.00
        WHEN 'webcam_block' THEN 4.50
        ELSE 1.00
    END;
$$;

CREATE OR REPLACE FUNCTION prepare_submission_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.final_answers IS NOT NULL
       AND (NEW.final_submitted_at IS NOT NULL OR NEW.status IN ('submitted', 'late_submitted', 'under_review', 'graded')) THEN
        NEW.submission_hash := ENCODE(DIGEST(CONVERT_TO(NEW.final_answers::TEXT, 'UTF8'), 'sha256'), 'hex');
        NEW.hash_verified := TRUE;
        IF NEW.final_submitted_at IS NULL THEN
            NEW.final_submitted_at := NOW();
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION default_integrity_event_weight()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.weight IS NULL THEN
        NEW.weight := integrity_event_default_weight(NEW.event_type);
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION apply_integrity_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_score NUMERIC(8,2);
    v_threshold NUMERIC(8,2);
    v_case_id UUID;
BEGIN
    UPDATE exam_candidate
       SET suspicion_score = suspicion_score + COALESCE(NEW.weight, 0),
           last_ip = COALESCE(NEW.ip_address, last_ip),
           last_device = COALESCE(NEW.device_fingerprint, last_device)
     WHERE exam_id = NEW.exam_id
       AND student_id = NEW.student_id
       AND attempt_no = NEW.attempt_no
     RETURNING suspicion_score INTO v_score;

    SELECT integrity_threshold INTO v_threshold
      FROM exam
     WHERE id = NEW.exam_id;

    IF v_score IS NOT NULL AND v_threshold IS NOT NULL AND v_score >= v_threshold THEN
        SELECT id INTO v_case_id
          FROM integrity_case
         WHERE exam_id = NEW.exam_id
           AND student_id = NEW.student_id
           AND attempt_no = NEW.attempt_no
           AND status IN ('open', 'under_review', 'escalated')
         ORDER BY opened_at DESC
         LIMIT 1;

        IF v_case_id IS NULL THEN
            INSERT INTO integrity_case (
                exam_id,
                student_id,
                attempt_no,
                current_score,
                threshold_at_open,
                summary
            ) VALUES (
                NEW.exam_id,
                NEW.student_id,
                NEW.attempt_no,
                v_score,
                v_threshold,
                'System-opened after suspicion score threshold was reached.'
            )
            RETURNING id INTO v_case_id;
        ELSE
            UPDATE integrity_case
               SET current_score = v_score,
                   status = CASE WHEN status = 'open' THEN 'under_review' ELSE status END
             WHERE id = v_case_id;
        END IF;

        INSERT INTO case_evidence (
            case_id,
            evidence_type,
            source_ref,
            payload
        ) VALUES (
            v_case_id,
            'integrity_event',
            NEW.id::TEXT,
            jsonb_build_object(
                'event_type', NEW.event_type,
                'event_time', NEW.event_time,
                'weight', NEW.weight,
                'details', NEW.details,
                'ip_address', NEW.ip_address,
                'device_fingerprint', NEW.device_fingerprint
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION verify_submission_hash(p_submission_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_expected TEXT;
    v_actual TEXT;
BEGIN
    SELECT submission_hash,
           ENCODE(DIGEST(CONVERT_TO(final_answers::TEXT, 'UTF8'), 'sha256'), 'hex')
      INTO v_expected, v_actual
      FROM answer_submission
     WHERE id = p_submission_id;

    IF v_expected IS NULL OR v_actual IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE answer_submission
       SET hash_verified = (v_expected = v_actual),
           updated_at = NOW()
     WHERE id = p_submission_id;

    RETURN v_expected = v_actual;
END;
$$;

CREATE OR REPLACE FUNCTION write_audit_log(
    p_actor_user_id UUID,
    p_actor_role user_role,
    p_action TEXT,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_ip_address INET,
    p_details JSONB
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO audit_log (
        actor_user_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        ip_address,
        details
    ) VALUES (
        p_actor_user_id,
        p_actor_role,
        p_action,
        p_entity_type,
        p_entity_id,
        p_ip_address,
        COALESCE(p_details, '{}'::JSONB)
    );
$$;

DROP TRIGGER IF EXISTS trg_app_user_updated_at ON app_user;
CREATE TRIGGER trg_app_user_updated_at
BEFORE UPDATE ON app_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_exam_updated_at ON exam;
CREATE TRIGGER trg_exam_updated_at
BEFORE UPDATE ON exam
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_submission_updated_at ON answer_submission;
CREATE TRIGGER trg_submission_updated_at
BEFORE UPDATE ON answer_submission
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_prepare_submission_hash ON answer_submission;
CREATE TRIGGER trg_prepare_submission_hash
BEFORE INSERT OR UPDATE OF final_answers, final_submitted_at, status ON answer_submission
FOR EACH ROW
EXECUTE FUNCTION prepare_submission_hash();

DROP TRIGGER IF EXISTS trg_default_integrity_event_weight ON integrity_event;
CREATE TRIGGER trg_default_integrity_event_weight
BEFORE INSERT ON integrity_event
FOR EACH ROW
EXECUTE FUNCTION default_integrity_event_weight();

DROP TRIGGER IF EXISTS trg_apply_integrity_event ON integrity_event;
CREATE TRIGGER trg_apply_integrity_event
AFTER INSERT ON integrity_event
FOR EACH ROW
EXECUTE FUNCTION apply_integrity_event();

CREATE OR REPLACE VIEW v_candidate_integrity_summary AS
SELECT
    ec.exam_id,
    ec.student_id,
    ec.attempt_no,
    ec.suspicion_score AS integrity_score,
    ic.status AS case_status,
    s.id AS submission_id,
    s.hash_verified AS submission_hash_verified,
    s.submission_hash,
    e.integrity_threshold,
    e.status AS exam_status
FROM exam_candidate ec
JOIN exam e
  ON e.id = ec.exam_id
LEFT JOIN LATERAL (
    SELECT id, status
      FROM integrity_case c
     WHERE c.exam_id = ec.exam_id
       AND c.student_id = ec.student_id
       AND c.attempt_no = ec.attempt_no
     ORDER BY c.opened_at DESC
     LIMIT 1
) ic ON TRUE
LEFT JOIN answer_submission s
  ON s.exam_id = ec.exam_id
 AND s.student_id = ec.student_id
 AND s.attempt_no = ec.attempt_no;
