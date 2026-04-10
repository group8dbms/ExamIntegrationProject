const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const { writeAuditLog } = require("../services/audit-service");

const router = express.Router();

function mapCaseStatus(value) {
  return value || "not_opened";
}

router.get(
  "/live-exams",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.course_code,
          e.start_at,
          e.end_at,
          COUNT(DISTINCT ie.id) AS suspicious_event_count,
          COUNT(DISTINCT ie.student_id) AS flagged_student_count,
          MAX(ie.event_time) AS last_event_at
        FROM exam e
        JOIN integrity_event ie ON ie.exam_id = e.id
        GROUP BY e.id
        ORDER BY last_event_at DESC NULLS LAST, e.start_at DESC
      `
    );

    res.json({ items: result.rows });
  })
);

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const { examId } = req.query;
    const values = [];
    const filters = ["1=1"];

    if (examId) {
      values.push(examId);
      filters.push(`ec.exam_id = $${values.length}`);
    }

    const result = await pool.query(
      `
        SELECT
          ec.exam_id,
          e.title AS exam_title,
          ec.student_id,
          u.full_name AS student_name,
          ec.attempt_no,
          ec.status,
          ec.suspicion_score,
          ec.suspicion_score AS integrity_score,
          COALESCE(vcs.case_status, 'not_opened') AS case_status,
          COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified,
          COUNT(DISTINCT ie.id) AS total_events,
          MAX(ie.event_time) AS last_event_at
        FROM exam_candidate ec
        JOIN exam e ON e.id = ec.exam_id
        JOIN app_user u ON u.id = ec.student_id
        JOIN integrity_event ie ON ie.exam_id = ec.exam_id AND ie.student_id = ec.student_id AND ie.attempt_no = ec.attempt_no
        LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = ec.exam_id AND vcs.student_id = ec.student_id AND vcs.attempt_no = ec.attempt_no
        WHERE ${filters.join(" AND ")}
        GROUP BY ec.exam_id, e.title, ec.student_id, u.full_name, ec.attempt_no, ec.status, ec.suspicion_score, vcs.case_status, vcs.submission_hash_verified
        ORDER BY last_event_at DESC NULLS LAST, total_events DESC
      `,
      values
    );

    res.json({ items: result.rows.map((item) => ({ ...item, case_status: mapCaseStatus(item.case_status) })) });
  })
);

router.get(
  "/exams/:examId/live-logs",
  asyncHandler(async (req, res) => {
    const { examId } = req.params;

    const examResult = await pool.query(
      `
        SELECT id, title, course_code, start_at, end_at, published_at
        FROM exam
        WHERE id = $1
      `,
      [examId]
    );

    if (!examResult.rows.length) {
      return res.status(404).json({ message: "Exam not found." });
    }

    const rows = await pool.query(
      `
        SELECT
          u.id AS student_id,
          u.full_name AS student_name,
          u.email AS student_email,
          ec.attempt_no,
          ec.status AS candidate_status,
          ec.suspicion_score,
          COALESCE(vcs.case_status, 'not_opened') AS case_status,
          COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified,
          latest_case.id AS case_id,
          latest_case.status AS case_workflow_status,
          latest_case.decision AS case_decision,
          latest_case.decision_notes AS case_decision_notes,
          latest_case.opened_at AS case_opened_at,
          latest_case.closed_at AS case_closed_at,
          ie.id AS event_id,
          ie.event_type,
          ie.event_time,
          ie.ip_address,
          ie.device_fingerprint,
          ie.details,
          ipa.penalty_points,
          ipa.note AS penalty_note,
          ipa.assigned_at,
          proctor.full_name AS assigned_by_name
        FROM integrity_event ie
        JOIN app_user u ON u.id = ie.student_id
        JOIN exam_candidate ec ON ec.exam_id = ie.exam_id AND ec.student_id = ie.student_id AND ec.attempt_no = ie.attempt_no
        LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = ie.exam_id AND vcs.student_id = ie.student_id AND vcs.attempt_no = ie.attempt_no
        LEFT JOIN LATERAL (
          SELECT id, status, decision, decision_notes, opened_at, closed_at
          FROM integrity_case c
          WHERE c.exam_id = ie.exam_id AND c.student_id = ie.student_id AND c.attempt_no = ie.attempt_no
          ORDER BY c.opened_at DESC
          LIMIT 1
        ) latest_case ON TRUE
        LEFT JOIN integrity_penalty_assignment ipa ON ipa.event_id = ie.id
        LEFT JOIN app_user proctor ON proctor.id = ipa.assigned_by
        WHERE ie.exam_id = $1
        ORDER BY u.full_name ASC, ie.event_time DESC
      `,
      [examId]
    );

    const grouped = [];
    const byStudent = new Map();
    for (const row of rows.rows) {
      const key = `${row.student_id}:${row.attempt_no}`;
      if (!byStudent.has(key)) {
        const studentEntry = {
          studentId: row.student_id,
          studentName: row.student_name,
          studentEmail: row.student_email,
          attemptNo: row.attempt_no,
          candidateStatus: row.candidate_status,
          integrityScore: Number(row.suspicion_score || 0),
          caseStatus: mapCaseStatus(row.case_status),
          caseId: row.case_id || null,
          caseWorkflowStatus: row.case_workflow_status || null,
          caseDecision: row.case_decision || null,
          caseDecisionNotes: row.case_decision_notes || "",
          caseOpenedAt: row.case_opened_at || null,
          caseClosedAt: row.case_closed_at || null,
          submissionHashVerified: row.submission_hash_verified,
          totalEvents: 0,
          lastEventAt: row.event_time,
          events: []
        };
        byStudent.set(key, studentEntry);
        grouped.push(studentEntry);
      }

      const studentEntry = byStudent.get(key);
      studentEntry.totalEvents += 1;
      studentEntry.events.push({
        eventId: row.event_id,
        eventType: row.event_type,
        eventTime: row.event_time,
        ipAddress: row.ip_address,
        deviceFingerprint: row.device_fingerprint,
        details: row.details || {},
        penaltyPoints: row.penalty_points === null || row.penalty_points === undefined ? null : Number(row.penalty_points),
        penaltyNote: row.penalty_note || "",
        assignedAt: row.assigned_at,
        assignedByName: row.assigned_by_name || null
      });
    }

    res.json({
      exam: examResult.rows[0],
      items: grouped
    });
  })
);

router.post(
  "/events",
  asyncHandler(async (req, res) => {
    const {
      examId,
      studentId,
      attemptNo = 1,
      sessionId = null,
      eventType,
      weight = null,
      ipAddress = null,
      deviceFingerprint = null,
      details = {},
      createdBy = null,
      actorRole = null
    } = req.body;

    if (!examId || !studentId || !eventType) {
      return res.status(400).json({ message: "examId, studentId, and eventType are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const eventResult = await client.query(
        `
          INSERT INTO integrity_event (
            exam_id, student_id, attempt_no, session_id, event_type,
            weight, ip_address, device_fingerprint, details, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9::jsonb, $10)
          RETURNING *
        `,
        [examId, studentId, attemptNo, sessionId, eventType, weight, ipAddress, deviceFingerprint, JSON.stringify(details), createdBy]
      );

      const candidateResult = await client.query(
        `
          SELECT ec.exam_id, ec.student_id, ec.attempt_no, ec.suspicion_score AS integrity_score,
                 COALESCE(vcs.case_status, 'not_opened') AS case_status,
                 COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified,
                 COUNT(ie.id) AS total_events,
                 MAX(ie.event_time) AS last_event_at
          FROM exam_candidate ec
          LEFT JOIN integrity_event ie ON ie.exam_id = ec.exam_id AND ie.student_id = ec.student_id AND ie.attempt_no = ec.attempt_no
          LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = ec.exam_id AND vcs.student_id = ec.student_id AND vcs.attempt_no = ec.attempt_no
          WHERE ec.exam_id = $1 AND ec.student_id = $2 AND ec.attempt_no = $3
          GROUP BY ec.exam_id, ec.student_id, ec.attempt_no, ec.suspicion_score, vcs.case_status, vcs.submission_hash_verified
        `,
        [examId, studentId, attemptNo]
      );

      await writeAuditLog(client, {
        actorUserId: createdBy,
        actorRole,
        action: "integrity_event_logged",
        entityType: "integrity_event",
        entityId: String(eventResult.rows[0].id),
        ipAddress: req.ip,
        details: { eventType, examId, studentId, attemptNo }
      });

      await client.query("COMMIT");
      res.status(201).json({ event: eventResult.rows[0], candidateSummary: candidateResult.rows[0] || null });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/events/:eventId/penalty",
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const { penaltyPoints, note = "", assignedBy, actorRole = "proctor" } = req.body;

    if (penaltyPoints === null || penaltyPoints === undefined || Number.isNaN(Number(penaltyPoints))) {
      return res.status(400).json({ message: "A numeric penaltyPoints value is required." });
    }

    const numericPenalty = Number(penaltyPoints);
    if (numericPenalty < 0) {
      return res.status(400).json({ message: "Penalty points cannot be negative." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const eventResult = await client.query(
        `
          SELECT id, exam_id, student_id, attempt_no, event_type, event_time
          FROM integrity_event
          WHERE id = $1
        `,
        [eventId]
      );

      if (!eventResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Integrity event not found." });
      }

      const integrityEvent = eventResult.rows[0];
      const existingPenalty = await client.query(
        `SELECT penalty_points FROM integrity_penalty_assignment WHERE event_id = $1`,
        [eventId]
      );
      const previousPenalty = existingPenalty.rows.length ? Number(existingPenalty.rows[0].penalty_points || 0) : 0;
      const delta = numericPenalty - previousPenalty;

      const penaltyResult = await client.query(
        `
          INSERT INTO integrity_penalty_assignment (
            event_id, exam_id, student_id, attempt_no, penalty_points, note, assigned_by, assigned_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          ON CONFLICT (event_id)
          DO UPDATE SET
            penalty_points = EXCLUDED.penalty_points,
            note = EXCLUDED.note,
            assigned_by = EXCLUDED.assigned_by,
            assigned_at = NOW(),
            updated_at = NOW()
          RETURNING *
        `,
        [eventId, integrityEvent.exam_id, integrityEvent.student_id, integrityEvent.attempt_no, numericPenalty, note, assignedBy]
      );

      await client.query(
        `
          UPDATE exam_candidate
             SET suspicion_score = GREATEST(0, COALESCE(suspicion_score, 0) + $4)
           WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
        `,
        [integrityEvent.exam_id, integrityEvent.student_id, integrityEvent.attempt_no, delta]
      );

      const candidateResult = await client.query(
        `
          SELECT ec.exam_id, ec.student_id, ec.attempt_no, ec.suspicion_score AS integrity_score,
                 COALESCE(vcs.case_status, 'not_opened') AS case_status,
                 COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified
          FROM exam_candidate ec
          LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = ec.exam_id AND vcs.student_id = ec.student_id AND vcs.attempt_no = ec.attempt_no
          WHERE ec.exam_id = $1 AND ec.student_id = $2 AND ec.attempt_no = $3
        `,
        [integrityEvent.exam_id, integrityEvent.student_id, integrityEvent.attempt_no]
      );

      await writeAuditLog(client, {
        actorUserId: assignedBy,
        actorRole,
        action: "integrity_penalty_assigned",
        entityType: "integrity_event",
        entityId: String(eventId),
        ipAddress: req.ip,
        details: {
          examId: integrityEvent.exam_id,
          studentId: integrityEvent.student_id,
          attemptNo: integrityEvent.attempt_no,
          eventType: integrityEvent.event_type,
          previousPenalty,
          penaltyPoints: numericPenalty,
          delta,
          note
        }
      });

      await client.query("COMMIT");
      res.json({ penalty: penaltyResult.rows[0], candidateSummary: candidateResult.rows[0] || null });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);


router.post(
  "/cases/open",
  asyncHandler(async (req, res) => {
    const { examId, studentId, attemptNo = 1, openedBy = null, actorRole = "proctor", summary = null } = req.body;

    if (!examId || !studentId) {
      return res.status(400).json({ message: "examId and studentId are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const latestCase = await client.query(
        `
          SELECT *
          FROM integrity_case
          WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
          ORDER BY opened_at DESC
          LIMIT 1
        `,
        [examId, studentId, attemptNo]
      );

      if (latestCase.rows.length && latestCase.rows[0].decision === null) {
        await client.query("COMMIT");
        return res.json({ case: latestCase.rows[0], reused: true });
      }

      const candidateScore = await client.query(
        `
          SELECT suspicion_score
          FROM exam_candidate
          WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
        `,
        [examId, studentId, attemptNo]
      );

      const openedCase = await client.query(
        `
          INSERT INTO integrity_case (
            exam_id, student_id, attempt_no, opened_by, status, current_score, threshold_at_open, summary
          ) VALUES ($1, $2, $3, $4, 'open', $5, NULL, $6)
          RETURNING *
        `,
        [examId, studentId, attemptNo, openedBy, Number(candidateScore.rows[0]?.suspicion_score || 0), summary || 'Case opened by proctor after reviewing suspicious activity logs.']
      );

      await client.query(
        `
          INSERT INTO case_action (case_id, action_type, note, action_by)
          VALUES ($1, 'case_opened', $2, $3)
        `,
        [openedCase.rows[0].id, summary || 'Case opened by proctor after reviewing suspicious activity logs.', openedBy]
      );

      await writeAuditLog(client, {
        actorUserId: openedBy,
        actorRole,
        action: 'integrity_case_opened',
        entityType: 'integrity_case',
        entityId: openedCase.rows[0].id,
        ipAddress: req.ip,
        details: { examId, studentId, attemptNo }
      });

      await client.query("COMMIT");
      res.status(201).json({ case: openedCase.rows[0], reused: false });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/cases",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const values = [];
    let where = "";
    if (status) {
      values.push(status);
      where = "WHERE ic.status = $1";
    }

    const result = await pool.query(
      `
        SELECT
          ic.id,
          ic.exam_id,
          e.title AS exam_title,
          ic.student_id,
          student.full_name AS student_name,
          ic.attempt_no,
          ic.status,
          ic.current_score,
          ic.threshold_at_open,
          ic.summary,
          ic.decision,
          ic.opened_at,
          COUNT(DISTINCT ce.id) AS evidence_count,
          COUNT(DISTINCT ca.id) AS action_count
        FROM integrity_case ic
        JOIN exam e ON e.id = ic.exam_id
        JOIN app_user student ON student.id = ic.student_id
        LEFT JOIN case_evidence ce ON ce.case_id = ic.id
        LEFT JOIN case_action ca ON ca.case_id = ic.id
        ${where}
        GROUP BY ic.id, e.title, student.full_name
        ORDER BY ic.opened_at DESC
      `,
      values
    );

    res.json({ items: result.rows });
  })
);

router.get(
  "/cases/:caseId",
  asyncHandler(async (req, res) => {
    const caseResult = await pool.query(
      `
        SELECT ic.*, e.title AS exam_title, u.full_name AS student_name
          FROM integrity_case ic
          JOIN exam e ON e.id = ic.exam_id
          JOIN app_user u ON u.id = ic.student_id
         WHERE ic.id = $1
      `,
      [req.params.caseId]
    );

    if (!caseResult.rows.length) {
      return res.status(404).json({ message: "Case not found." });
    }

    const evidence = await pool.query(`SELECT * FROM case_evidence WHERE case_id = $1 ORDER BY added_at DESC`, [req.params.caseId]);
    const actions = await pool.query(`SELECT * FROM case_action WHERE case_id = $1 ORDER BY action_at DESC`, [req.params.caseId]);

    res.json({ case: caseResult.rows[0], evidence: evidence.rows, actions: actions.rows });
  })
);

router.patch(
  "/cases/:caseId/decision",
  asyncHandler(async (req, res) => {
    const { caseId } = req.params;
    const { status, decision, decisionNotes = null, resolvedBy = null, actionBy = null, actorRole = "auditor" } = req.body;

    if (!status || !decision) {
      return res.status(400).json({ message: "status and decision are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseResult = await client.query(
        `
          UPDATE integrity_case
             SET status = $1,
                 decision = $2,
                 decision_notes = $3,
                 resolved_by = $4,
                 closed_at = CASE WHEN $1 IN ('cleared', 'confirmed_cheating', 'resolved') THEN NOW() ELSE closed_at END
           WHERE id = $5
           RETURNING *
        `,
        [status, decision, decisionNotes, resolvedBy, caseId]
      );

      if (!caseResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Case not found." });
      }

      await client.query(`INSERT INTO case_action (case_id, action_type, note, action_by) VALUES ($1, 'decision', $2, $3)`, [caseId, decisionNotes || `Decision set to ${decision}`, actionBy]);
      await writeAuditLog(client, {
        actorUserId: actionBy,
        actorRole,
        action: "integrity_case_decided",
        entityType: "integrity_case",
        entityId: caseId,
        ipAddress: req.ip,
        details: { status, decision }
      });

      await client.query("COMMIT");
      res.json(caseResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
