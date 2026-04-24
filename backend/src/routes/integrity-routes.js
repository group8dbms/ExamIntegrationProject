const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const { writeAuditLog } = require("../services/audit-service");
const { isStorageConfigured } = require("../services/storage-service");
const { createIntegrityEvidenceDocument } = require("../services/document-service");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function mapStorageError(error) {
  if (!error) return "unknown storage error";
  const message = String(error.message || error);
  if (/Could not load credentials from any providers/i.test(message)) {
    return "S3 credentials are missing on the backend";
  }
  return message;
}

function mapCaseStatus(value) {
  return value || "not_opened";
}

let integrityEventSchemaPromise = null;

async function ensureIntegrityEventSchema() {
  if (!integrityEventSchemaPromise) {
    integrityEventSchemaPromise = pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'integrity_event_type'
        ) THEN
          BEGIN
            ALTER TYPE integrity_event_type ADD VALUE IF NOT EXISTS 'screen_share_block';
            ALTER TYPE integrity_event_type ADD VALUE IF NOT EXISTS 'face_absent';
          EXCEPTION
            WHEN duplicate_object THEN
              NULL;
          END;
        END IF;
      END $$;
    `);
  }

  return integrityEventSchemaPromise;
}

function getDefaultIntegrityWeight(eventType) {
  switch (String(eventType || "")) {
    case "tab_switch":
      return 2;
    case "copy_attempt":
      return 2.5;
    case "paste_attempt":
      return 2;
    case "multiple_login":
      return 4;
    case "ip_change":
      return 5;
    case "device_change":
      return 4;
    case "fullscreen_exit":
      return 1.5;
    case "network_change":
      return 3;
    case "webcam_block":
      return 4.5;
    case "screen_share_block":
      return 5;
    case "face_absent":
      return 6;
    default:
      return 1;
  }
}

router.get(
  "/live-exams",
  requireAuth,
  requireRole("admin", "proctor", "auditor"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        WITH current_exams AS (
          SELECT e.id, e.title, e.course_code, e.start_at, e.end_at
          FROM exam e
          WHERE NOW() BETWEEN e.start_at AND e.end_at
        ),
        candidate_totals AS (
          SELECT ec.exam_id, COUNT(*) AS candidate_count
          FROM exam_candidate ec
          GROUP BY ec.exam_id
        ),
        latest_case_per_attempt AS (
          SELECT DISTINCT ON (c.exam_id, c.student_id, c.attempt_no)
            c.exam_id,
            c.student_id,
            c.attempt_no,
            c.id,
            c.decision,
            c.closed_at
          FROM integrity_case c
          ORDER BY c.exam_id, c.student_id, c.attempt_no, c.opened_at DESC
        ),
        suspicious_attempts AS (
          SELECT DISTINCT
            ie.exam_id,
            ie.student_id,
            ie.attempt_no,
            latest_case.id AS case_id,
            latest_case.decision,
            latest_case.closed_at
          FROM integrity_event ie
          LEFT JOIN latest_case_per_attempt latest_case
            ON latest_case.exam_id = ie.exam_id
           AND latest_case.student_id = ie.student_id
           AND latest_case.attempt_no = ie.attempt_no
        )
        SELECT
          ce.id,
          ce.title,
          ce.course_code,
          ce.start_at,
          ce.end_at,
          COALESCE(ct.candidate_count, 0) AS candidate_count,
          COUNT(DISTINCT ie.id) AS suspicious_event_count,
          COUNT(DISTINCT (sa.student_id, sa.attempt_no)) AS flagged_student_count,
          COUNT(DISTINCT CASE
            WHEN sa.case_id IS NULL OR sa.decision IS NULL OR sa.closed_at IS NULL
            THEN (sa.student_id, sa.attempt_no)
            ELSE NULL
          END) AS pending_review_count,
          MAX(ie.event_time) AS last_event_at
        FROM current_exams ce
        LEFT JOIN candidate_totals ct ON ct.exam_id = ce.id
        LEFT JOIN suspicious_attempts sa ON sa.exam_id = ce.id
        LEFT JOIN integrity_event ie
          ON ie.exam_id = sa.exam_id
         AND ie.student_id = sa.student_id
         AND ie.attempt_no = sa.attempt_no
        GROUP BY ce.id, ce.title, ce.course_code, ce.start_at, ce.end_at, ct.candidate_count
        ORDER BY pending_review_count DESC, suspicious_event_count DESC, ce.start_at DESC
      `
    );

    res.json({ items: result.rows });
  })
);

router.get(
  "/dashboard",
  requireAuth,
  requireRole("admin", "proctor", "auditor"),
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
          vcs.case_status AS case_status,
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
  requireAuth,
  requireRole("admin", "proctor", "auditor"),
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
          vcs.case_status AS case_status,
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
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    await ensureIntegrityEventSchema();

    const {
      examId,
      attemptNo = 1,
      sessionId = null,
      eventType,
      weight = null,
      ipAddress = null,
      deviceFingerprint = null,
      details = {}
    } = req.body;
    const studentId = req.user.id;
    const createdBy = req.user.id;
    const actorRole = req.user.role;

    if (!examId || !eventType) {
      return res.status(400).json({ message: "examId and eventType are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const appliedWeight = weight === null || weight === undefined
        ? getDefaultIntegrityWeight(eventType)
        : Number(weight);
      const eventResult = await client.query(
        `
          INSERT INTO integrity_event (
            exam_id, student_id, attempt_no, session_id, event_type,
            weight, ip_address, device_fingerprint, details, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9::jsonb, $10)
          RETURNING *
        `,
        [examId, studentId, attemptNo, sessionId, eventType, appliedWeight, ipAddress, deviceFingerprint, JSON.stringify(details), createdBy]
      );

      const scoreResult = await client.query(
        `
          UPDATE exam_candidate ec
             SET suspicion_score = COALESCE(ec.suspicion_score, 0) + $4,
                 last_ip = COALESCE($5::inet, ec.last_ip),
                 last_device = COALESCE($6, ec.last_device)
           WHERE ec.exam_id = $1
             AND ec.student_id = $2
             AND ec.attempt_no = $3
         RETURNING ec.exam_id, ec.student_id, ec.attempt_no, ec.suspicion_score
        `,
        [examId, studentId, attemptNo, appliedWeight, ipAddress, deviceFingerprint]
      );

      if (!scoreResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Exam attempt not found." });
      }

      const candidateState = scoreResult.rows[0];
      const thresholdResult = await client.query(
        `
          SELECT integrity_threshold
          FROM exam
          WHERE id = $1
        `,
        [examId]
      );
      const currentScore = Number(candidateState.suspicion_score || 0);
      const threshold = Number(thresholdResult.rows[0]?.integrity_threshold || 0);

      if ((threshold > 0 && currentScore >= threshold) || eventType === "face_absent") {
        const existingCase = await client.query(
          `
            SELECT id, status
            FROM integrity_case
            WHERE exam_id = $1
              AND student_id = $2
              AND attempt_no = $3
              AND status IN ('open', 'under_review', 'escalated')
            ORDER BY opened_at DESC
            LIMIT 1
          `,
          [examId, studentId, attemptNo]
        );

        let caseId = existingCase.rows[0]?.id || null;
        if (!caseId) {
          const summary = eventType === "face_absent"
            ? "System-opened because no face was detected in the webcam for a sustained period."
            : "System-opened after suspicion score threshold was reached.";
          const createdCase = await client.query(
            `
              INSERT INTO integrity_case (
                exam_id, student_id, attempt_no, current_score, threshold_at_open, summary
              ) VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id
            `,
            [
              examId,
              studentId,
              attemptNo,
              currentScore,
              threshold,
              summary
            ]
          );
          caseId = createdCase.rows[0].id;
        } else {
          await client.query(
            `
              UPDATE integrity_case
                 SET current_score = $2,
                     status = CASE WHEN status = 'open' THEN 'under_review' ELSE status END
               WHERE id = $1
            `,
            [caseId, currentScore]
          );
        }

        await client.query(
          `
            INSERT INTO case_evidence (case_id, evidence_type, source_ref, payload)
            VALUES ($1, 'integrity_event', $2, $3::jsonb)
          `,
          [
            caseId,
            String(eventResult.rows[0].id),
            JSON.stringify({
              event_type: eventResult.rows[0].event_type,
              event_time: eventResult.rows[0].event_time,
              weight: eventResult.rows[0].weight,
              details: eventResult.rows[0].details
            })
          ]
        );
      }

      const candidateResult = await client.query(
        `
          SELECT ec.exam_id, ec.student_id, ec.attempt_no, ec.suspicion_score AS integrity_score,
                 vcs.case_status AS case_status,
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
        entityId: null,
        ipAddress: req.ip,
        details: { eventId: eventResult.rows[0].id, eventType, examId, studentId, attemptNo }
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
  requireAuth,
  requireRole("proctor"),
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const { penaltyPoints, note = "" } = req.body;
    const assignedBy = req.user.id;
    const actorRole = req.user.role;

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
                 vcs.case_status AS case_status,
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
        entityId: null,
        ipAddress: req.ip,
        details: {
          eventId,
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
  requireAuth,
  requireRole("proctor"),
  asyncHandler(async (req, res) => {
    const { examId, studentId, attemptNo = 1, summary = null } = req.body;
    const openedBy = req.user.id;
    const actorRole = req.user.role;

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
          SELECT ec.suspicion_score, COALESCE(e.integrity_threshold, 0) AS integrity_threshold
          FROM exam_candidate ec
          JOIN exam e ON e.id = ec.exam_id
          WHERE ec.exam_id = $1 AND ec.student_id = $2 AND ec.attempt_no = $3
        `,
        [examId, studentId, attemptNo]
      );

      const currentScore = Number(candidateScore.rows[0]?.suspicion_score || 0);
      const thresholdAtOpen = Number(candidateScore.rows[0]?.integrity_threshold || 0);

      const openedCase = await client.query(
        `
          INSERT INTO integrity_case (
            exam_id, student_id, attempt_no, opened_by, status, current_score, threshold_at_open, summary
          ) VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)
          RETURNING *
        `,
        [examId, studentId, attemptNo, openedBy, currentScore, thresholdAtOpen, summary || 'Case opened by proctor after reviewing suspicious activity logs.']
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
  requireAuth,
  requireRole("admin", "proctor", "auditor"),
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
  requireAuth,
  requireRole("admin", "proctor", "auditor"),
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
  requireAuth,
  requireRole("proctor", "auditor"),
  asyncHandler(async (req, res) => {
    const { caseId } = req.params;
    const { status, decision, decisionNotes = null } = req.body;
    const resolvedBy = req.user.id;
    const actionBy = req.user.id;
    const actorRole = req.user.role;

    if (!status || !decision) {
      return res.status(400).json({ message: "status and decision are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseResult = await client.query(
        `
          UPDATE integrity_case
             SET status = $1::case_status,
                 decision = $2,
                 decision_notes = $3,
                 resolved_by = $4,
                 closed_at = CASE WHEN $1::case_status IN ('cleared', 'confirmed_cheating', 'resolved') THEN NOW() ELSE closed_at END
           WHERE id = $5
           RETURNING *
        `,
        [status, decision, decisionNotes, resolvedBy, caseId]
      );

      if (!caseResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Case not found." });
      }

      const updatedCase = caseResult.rows[0];

      const contextResult = await client.query(
        `
          SELECT
            e.id AS exam_id,
            e.title AS exam_title,
            e.course_code,
            u.id AS student_id,
            u.full_name AS student_name,
            u.email AS student_email
          FROM integrity_case ic
          JOIN exam e ON e.id = ic.exam_id
          JOIN app_user u ON u.id = ic.student_id
          WHERE ic.id = $1
        `,
        [caseId]
      );

      const eventResult = await client.query(
        `
          SELECT
            ie.event_type,
            ie.event_time,
            ie.ip_address,
            ie.device_fingerprint,
            ie.details,
            ipa.penalty_points,
            ipa.note AS penalty_note
          FROM integrity_event ie
          LEFT JOIN integrity_penalty_assignment ipa ON ipa.event_id = ie.id
          WHERE ie.exam_id = $1 AND ie.student_id = $2 AND ie.attempt_no = $3
          ORDER BY ie.event_time ASC
        `,
        [updatedCase.exam_id, updatedCase.student_id, updatedCase.attempt_no]
      );

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

      let storedDocument = null;
      let storageError = null;
      if (contextResult.rows.length) {
        try {
          storedDocument = await createIntegrityEvidenceDocument(client, {
            caseRecord: updatedCase,
            exam: {
              id: contextResult.rows[0].exam_id,
              title: contextResult.rows[0].exam_title,
              course_code: contextResult.rows[0].course_code
            },
            student: {
              id: contextResult.rows[0].student_id,
              fullName: contextResult.rows[0].student_name,
              email: contextResult.rows[0].student_email
            },
            events: eventResult.rows,
            uploadedBy: actionBy,
            actorRole,
            ipAddress: req.ip
          });
        } catch (error) {
          storageError = mapStorageError(error);
        }
      }

      await client.query("COMMIT");
      res.json({
        ...updatedCase,
        storageConfigured: isStorageConfigured(),
        evidenceStored: Boolean(storedDocument?.stored),
        evidenceDocumentId: storedDocument?.item?.id || null,
        storageError
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/cases/submit-review",
  requireAuth,
  requireRole("proctor"),
  asyncHandler(async (req, res) => {
    const {
      examId,
      studentId,
      attemptNo = 1,
      penalties = [],
      status,
      decision,
      decisionNotes = null
    } = req.body;
    const actionBy = req.user.id;
    const actorRole = req.user.role;

    if (!examId || !studentId) {
      return res.status(400).json({ message: "examId and studentId are required." });
    }

    if (!status || !decision) {
      return res.status(400).json({ message: "status and decision are required." });
    }

    if (!String(decisionNotes || "").trim()) {
      return res.status(400).json({ message: "A case reason is required before submitting the review." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const candidateResult = await client.query(
        `
          SELECT ec.exam_id, ec.student_id, ec.attempt_no, ec.suspicion_score, COALESCE(e.integrity_threshold, 0) AS integrity_threshold
          FROM exam_candidate ec
          JOIN exam e ON e.id = ec.exam_id
          WHERE ec.exam_id = $1 AND ec.student_id = $2 AND ec.attempt_no = $3
          FOR UPDATE
        `,
        [examId, studentId, attemptNo]
      );

      if (!candidateResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Exam attempt not found." });
      }

      const candidate = candidateResult.rows[0];

      const eventRows = await client.query(
        `
          SELECT ie.id, ie.event_type, ipa.penalty_points, ipa.note
          FROM integrity_event ie
          LEFT JOIN integrity_penalty_assignment ipa ON ipa.event_id = ie.id
          WHERE ie.exam_id = $1 AND ie.student_id = $2 AND ie.attempt_no = $3
          ORDER BY ie.event_time ASC
        `,
        [examId, studentId, attemptNo]
      );

      const eventMap = new Map(eventRows.rows.map((row) => [String(row.id), row]));
      let totalDelta = 0;

      for (const item of penalties) {
        const eventId = String(item?.eventId || "");
        const numericPenalty = Number(item?.penaltyPoints);
        if (!eventMap.has(eventId)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "One or more penalty rows no longer belong to this student attempt." });
        }
        if (Number.isNaN(numericPenalty) || numericPenalty < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "Penalty points must be valid non-negative numbers." });
        }

        const currentEvent = eventMap.get(eventId);
        const previousPenalty = Number(currentEvent.penalty_points || 0);
        const delta = numericPenalty - previousPenalty;
        totalDelta += delta;

        await client.query(
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
          `,
          [eventId, examId, studentId, attemptNo, numericPenalty, currentEvent.note || "", actionBy]
        );

        await writeAuditLog(client, {
          actorUserId: actionBy,
          actorRole,
          action: "integrity_penalty_assigned",
          entityType: "integrity_event",
          entityId: null,
          ipAddress: req.ip,
          details: {
            eventId,
            examId,
            studentId,
            attemptNo,
            eventType: currentEvent.event_type,
            previousPenalty,
            penaltyPoints: numericPenalty,
            delta
          }
        });
      }

      await client.query(
        `
          UPDATE exam_candidate
             SET suspicion_score = GREATEST(0, COALESCE(suspicion_score, 0) + $4)
           WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
        `,
        [examId, studentId, attemptNo, totalDelta]
      );

      const latestCaseResult = await client.query(
        `
          SELECT *
          FROM integrity_case
          WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
          ORDER BY opened_at DESC
          LIMIT 1
        `,
        [examId, studentId, attemptNo]
      );

      let caseRecord = latestCaseResult.rows[0] || null;

      if (caseRecord && caseRecord.decision !== null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This case review has already been completed." });
      }

      if (!caseRecord) {
        const createdCase = await client.query(
          `
            INSERT INTO integrity_case (
              exam_id, student_id, attempt_no, opened_by, status, current_score, threshold_at_open, summary
            ) VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)
            RETURNING *
          `,
          [
            examId,
            studentId,
            attemptNo,
            actionBy,
            Number(candidate.suspicion_score || 0) + totalDelta,
            Number(candidate.integrity_threshold || 0),
            "Case opened and reviewed by proctor from the suspicious activity queue."
          ]
        );
        caseRecord = createdCase.rows[0];

        await client.query(
          `
            INSERT INTO case_action (case_id, action_type, note, action_by)
            VALUES ($1, 'case_opened', $2, $3)
          `,
          [caseRecord.id, "Case opened and reviewed by proctor from the suspicious activity queue.", actionBy]
        );

        await writeAuditLog(client, {
          actorUserId: actionBy,
          actorRole,
          action: "integrity_case_opened",
          entityType: "integrity_case",
          entityId: caseRecord.id,
          ipAddress: req.ip,
          details: { examId, studentId, attemptNo }
        });
      }

      const caseResult = await client.query(
        `
          UPDATE integrity_case
             SET status = $1::case_status,
                 decision = $2,
                 decision_notes = $3,
                 resolved_by = $4,
                 current_score = (
                   SELECT COALESCE(suspicion_score, 0)
                   FROM exam_candidate
                   WHERE exam_id = $5 AND student_id = $6 AND attempt_no = $7
                 ),
                 closed_at = CASE WHEN $1::case_status IN ('cleared', 'confirmed_cheating', 'resolved') THEN NOW() ELSE closed_at END
           WHERE id = $8
           RETURNING *
        `,
        [status, decision, decisionNotes, actionBy, examId, studentId, attemptNo, caseRecord.id]
      );

      const updatedCase = caseResult.rows[0];

      const contextResult = await client.query(
        `
          SELECT
            e.id AS exam_id,
            e.title AS exam_title,
            e.course_code,
            u.id AS student_id,
            u.full_name AS student_name,
            u.email AS student_email
          FROM exam e
          JOIN app_user u ON u.id = $2
          WHERE e.id = $1
        `,
        [examId, studentId]
      );

      const reviewedEvents = await client.query(
        `
          SELECT
            ie.event_type,
            ie.event_time,
            ie.ip_address,
            ie.device_fingerprint,
            ie.details,
            ipa.penalty_points,
            ipa.note AS penalty_note
          FROM integrity_event ie
          LEFT JOIN integrity_penalty_assignment ipa ON ipa.event_id = ie.id
          WHERE ie.exam_id = $1 AND ie.student_id = $2 AND ie.attempt_no = $3
          ORDER BY ie.event_time ASC
        `,
        [examId, studentId, attemptNo]
      );

      await client.query(
        `INSERT INTO case_action (case_id, action_type, note, action_by) VALUES ($1, 'decision', $2, $3)`,
        [updatedCase.id, decisionNotes, actionBy]
      );

      await writeAuditLog(client, {
        actorUserId: actionBy,
        actorRole,
        action: "integrity_case_decided",
        entityType: "integrity_case",
        entityId: updatedCase.id,
        ipAddress: req.ip,
        details: { examId, studentId, attemptNo, status, decision }
      });

      let storedDocument = null;
      let storageError = null;
      if (contextResult.rows.length) {
        try {
          storedDocument = await createIntegrityEvidenceDocument(client, {
            caseRecord: updatedCase,
            exam: {
              id: contextResult.rows[0].exam_id,
              title: contextResult.rows[0].exam_title,
              course_code: contextResult.rows[0].course_code
            },
            student: {
              id: contextResult.rows[0].student_id,
              fullName: contextResult.rows[0].student_name,
              email: contextResult.rows[0].student_email
            },
            events: reviewedEvents.rows,
            uploadedBy: actionBy,
            actorRole,
            ipAddress: req.ip
          });
        } catch (error) {
          storageError = mapStorageError(error);
        }
      }

      await client.query("COMMIT");
      res.json({
        case: updatedCase,
        storageConfigured: isStorageConfigured(),
        evidenceStored: Boolean(storedDocument?.stored),
        evidenceDocumentId: storedDocument?.item?.id || null,
        storageError
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
