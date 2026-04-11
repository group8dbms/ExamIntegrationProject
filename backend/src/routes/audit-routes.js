const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");

const router = express.Router();

router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const { entityType, actorRole, limit = 50 } = req.query;
    const values = [];
    const filters = [];

    if (entityType) {
      values.push(entityType);
      filters.push(`entity_type = $${values.length}`);
    }

    if (actorRole) {
      values.push(actorRole);
      filters.push(`actor_role = $${values.length}`);
    }

    values.push(Number(limit));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query(
      `
        SELECT id, actor_user_id, actor_role, action, entity_type, entity_id, occurred_at, ip_address, details
          FROM audit_log
          ${where}
         ORDER BY occurred_at DESC
         LIMIT $${values.length}
      `,
      values
    );

    res.json({ items: result.rows });
  })
);

router.get(
  "/exams",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.course_code,
          e.start_at,
          e.end_at,
          e.published_at,
          COUNT(DISTINCT ec.student_id) AS candidate_count,
          COUNT(DISTINCT s.student_id) AS submitted_count,
          COUNT(DISTINCT CASE WHEN COALESCE(s.hash_verified, FALSE) = TRUE THEN s.student_id END) AS verified_hash_count,
          COUNT(DISTINCT CASE WHEN COALESCE(s.hash_verified, FALSE) = FALSE AND s.id IS NOT NULL THEN s.student_id END) AS failed_hash_count,
          COUNT(DISTINCT ie.id) AS integrity_event_count,
          COUNT(DISTINCT ic.id) AS case_count,
          MAX(al.occurred_at) AS last_audit_at
        FROM exam e
        LEFT JOIN exam_candidate ec ON ec.exam_id = e.id
        LEFT JOIN answer_submission s ON s.exam_id = e.id AND s.final_answers IS NOT NULL
        LEFT JOIN integrity_event ie ON ie.exam_id = e.id
        LEFT JOIN integrity_case ic ON ic.exam_id = e.id
        LEFT JOIN audit_log al ON al.entity_id = e.id OR al.details->>'examId' = e.id::text
        GROUP BY e.id
        ORDER BY e.start_at DESC
      `
    );

    res.json({ items: result.rows });
  })
);

router.get(
  "/exams/:examId",
  asyncHandler(async (req, res) => {
    const { examId } = req.params;

    const examResult = await pool.query(
      `
        SELECT id, title, course_code, status, start_at, end_at, published_at, integrity_threshold
        FROM exam
        WHERE id = $1
      `,
      [examId]
    );

    if (!examResult.rows.length) {
      return res.status(404).json({ message: "Exam not found." });
    }

    const studentResult = await pool.query(
      `
        SELECT
          ec.student_id,
          u.full_name AS student_name,
          u.email AS student_email,
          ec.attempt_no,
          ec.assigned_at,
          ec.started_at,
          ec.submitted_at,
          ec.status AS candidate_status,
          ec.suspicion_score AS integrity_score,
          COALESCE(vcs.case_status, 'open') AS case_status,
          COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified,
          s.id AS submission_id,
          s.final_submitted_at,
          s.hash_verified,
          r.status AS result_status,
          r.awarded_marks,
          r.total_marks,
          r.percentage,
          latest_case.id AS case_id,
          latest_case.status AS case_workflow_status,
          latest_case.decision AS case_decision,
          latest_case.decision_notes AS case_decision_notes,
          latest_case.opened_at AS case_opened_at,
          latest_case.closed_at AS case_closed_at,
          COUNT(DISTINCT ie.id) AS integrity_event_count
        FROM exam_candidate ec
        JOIN app_user u ON u.id = ec.student_id
        LEFT JOIN answer_submission s ON s.exam_id = ec.exam_id AND s.student_id = ec.student_id AND s.attempt_no = ec.attempt_no
        LEFT JOIN result r ON r.exam_id = ec.exam_id AND r.student_id = ec.student_id AND r.submission_id = s.id
        LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = ec.exam_id AND vcs.student_id = ec.student_id AND vcs.attempt_no = ec.attempt_no
        LEFT JOIN integrity_event ie ON ie.exam_id = ec.exam_id AND ie.student_id = ec.student_id AND ie.attempt_no = ec.attempt_no
        LEFT JOIN LATERAL (
          SELECT id, status, decision, decision_notes, opened_at, closed_at
          FROM integrity_case c
          WHERE c.exam_id = ec.exam_id AND c.student_id = ec.student_id AND c.attempt_no = ec.attempt_no
          ORDER BY c.opened_at DESC
          LIMIT 1
        ) latest_case ON TRUE
        WHERE ec.exam_id = $1
        GROUP BY ec.exam_id, ec.student_id, u.full_name, u.email, ec.attempt_no, ec.assigned_at, ec.started_at, ec.submitted_at, ec.status,
                 ec.suspicion_score, vcs.case_status, vcs.submission_hash_verified, s.id, s.final_submitted_at, s.hash_verified,
                 r.status, r.awarded_marks, r.total_marks, r.percentage,
                 latest_case.id, latest_case.status, latest_case.decision, latest_case.decision_notes, latest_case.opened_at, latest_case.closed_at
        ORDER BY u.full_name ASC
      `,
      [examId]
    );

    const logResult = await pool.query(
      `
        SELECT id, actor_user_id, actor_role, action, entity_type, entity_id, occurred_at, ip_address, details
        FROM audit_log
        WHERE entity_id = $1
           OR details->>'examId' = $1::text
        ORDER BY occurred_at DESC
        LIMIT 300
      `,
      [examId]
    );

    res.json({
      exam: examResult.rows[0],
      students: studentResult.rows,
      logs: logResult.rows
    });
  })
);

module.exports = router;
