BEGIN;

DO $$
DECLARE
    v_admin UUID;
    v_instructor UUID;
    v_student UUID;
    v_proctor UUID;
    v_evaluator UUID;
    v_auditor UUID;
    v_exam UUID;
    v_bank UUID;
    v_question UUID;
    v_submission UUID;
    v_result UUID;
BEGIN
    INSERT INTO app_user (email, full_name, role)
    VALUES ('admin.demo@example.com', 'Admin Demo', 'admin')
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id INTO v_admin;

    INSERT INTO app_user (email, full_name, role)
    VALUES ('instructor.demo@example.com', 'Instructor Demo', 'instructor')
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id INTO v_instructor;

    INSERT INTO app_user (email, full_name, role)
    VALUES ('student.demo@example.com', 'Student Demo', 'student')
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id INTO v_student;

    INSERT INTO app_user (email, full_name, role)
    VALUES ('proctor.demo@example.com', 'Proctor Demo', 'proctor')
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id INTO v_proctor;

    INSERT INTO app_user (email, full_name, role)
    VALUES ('evaluator.demo@example.com', 'Evaluator Demo', 'evaluator')
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id INTO v_evaluator;

    INSERT INTO app_user (email, full_name, role)
    VALUES ('auditor.demo@example.com', 'Auditor Demo', 'auditor')
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id INTO v_auditor;

    INSERT INTO question_bank (title, description, created_by)
    VALUES ('Demo Bank', 'Seed bank for integrity smoke tests', v_instructor)
    RETURNING id INTO v_bank;

    INSERT INTO question (bank_id, created_by, question_type, prompt, correct_answer, default_marks)
    VALUES (v_bank, v_instructor, 'short_text', 'Explain ACID properties.', '"Atomicity, Consistency, Isolation, Durability"'::JSONB, 10)
    RETURNING id INTO v_question;

    INSERT INTO exam (
        title,
        description,
        course_code,
        status,
        start_at,
        end_at,
        duration_minutes,
        integrity_threshold,
        rules,
        created_by,
        published_at
    ) VALUES (
        'Database Integrity Demo Exam',
        'Smoke test exam for the integrity workflow.',
        'DBMS101',
        'scheduled',
        NOW() + INTERVAL '1 hour',
        NOW() + INTERVAL '2 hour',
        60,
        7,
        jsonb_build_object('allow_copy', false, 'allow_tab_switch', false),
        v_instructor,
        NOW()
    )
    RETURNING id INTO v_exam;

    INSERT INTO exam_question (exam_id, question_id, sequence_no)
    VALUES (v_exam, v_question, 1);

    INSERT INTO exam_candidate (exam_id, student_id, attempt_no, started_at, status)
    VALUES (v_exam, v_student, 1, NOW(), 'in_progress');

    INSERT INTO answer_submission (
        exam_id,
        student_id,
        attempt_no,
        current_answers,
        final_answers,
        autosave_version,
        status,
        final_submitted_at
    ) VALUES (
        v_exam,
        v_student,
        1,
        '{"q1":"ACID stands for ..."}'::JSONB,
        '{"q1":"Atomicity, Consistency, Isolation, Durability"}'::JSONB,
        3,
        'submitted',
        NOW()
    )
    RETURNING id INTO v_submission;

    INSERT INTO integrity_event (exam_id, student_id, attempt_no, event_type, ip_address, device_fingerprint, details)
    VALUES
        (v_exam, v_student, 1, 'tab_switch', '10.0.0.10', 'device-A', '{"count":1}'::JSONB),
        (v_exam, v_student, 1, 'multiple_login', '10.0.0.11', 'device-A', '{"other_session":"detected"}'::JSONB),
        (v_exam, v_student, 1, 'ip_change', '10.0.0.12', 'device-A', '{"from":"10.0.0.10","to":"10.0.0.12"}'::JSONB);

    INSERT INTO proctor_flag (exam_id, student_id, attempt_no, flagged_by, severity, reason)
    VALUES (v_exam, v_student, 1, v_proctor, 4, 'Candidate switched tabs and triggered a multi-login alert.');

    INSERT INTO evaluation (submission_id, evaluator_id, awarded_marks, feedback)
    VALUES (v_submission, v_evaluator, 9, 'Accurate answer with minor wording differences.');

    INSERT INTO result (
        exam_id,
        student_id,
        submission_id,
        total_marks,
        awarded_marks,
        integrity_score,
        case_status,
        submission_hash_verified,
        status,
        published_by,
        published_at
    )
    SELECT
        v_exam,
        v_student,
        v_submission,
        10,
        9,
        ec.suspicion_score,
        ics.status,
        verify_submission_hash(v_submission),
        'published',
        v_instructor,
        NOW()
    FROM exam_candidate ec
    LEFT JOIN LATERAL (
        SELECT status
        FROM integrity_case ic
        WHERE ic.exam_id = ec.exam_id
          AND ic.student_id = ec.student_id
          AND ic.attempt_no = ec.attempt_no
        ORDER BY ic.opened_at DESC
        LIMIT 1
    ) ics ON TRUE
    WHERE ec.exam_id = v_exam
      AND ec.student_id = v_student
      AND ec.attempt_no = 1
    RETURNING id INTO v_result;

    PERFORM write_audit_log(v_admin, 'admin', 'seed_smoke_test', 'result', v_result, '127.0.0.1', '{"script":"004_smoke_test.sql"}'::JSONB);
END $$;

COMMIT;

SELECT * FROM v_candidate_integrity_summary ORDER BY integrity_score DESC;
SELECT id, status, current_score, threshold_at_open FROM integrity_case ORDER BY opened_at DESC;
SELECT id, exam_id, student_id, awarded_marks, integrity_score, case_status, submission_hash_verified FROM result ORDER BY created_at DESC;
