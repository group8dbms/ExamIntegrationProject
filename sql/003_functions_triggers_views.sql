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
