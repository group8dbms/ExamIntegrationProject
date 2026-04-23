const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const { writeAuditLog } = require("../services/audit-service");
const { isStorageConfigured } = require("../services/storage-service");
const { createResultReportDocument } = require("../services/document-service");
const { requireAuth, requireRole, requireSelf } = require("../middleware/auth");

const router = express.Router();

function buildResultOutcome(row) {
  if (row.submission_hash_verified === false) {
    return {
      thresholdBreached: false,
      resultOutcome: "Withheld due to submission hash verification failure",
      studentNotice: "Your submission could not be integrity-verified. Please contact the proctor or admin for review."
    };
  }

  const caseStatus = String(row.case_status || "").toLowerCase();
  if (caseStatus === "confirmed_cheating") {
    return {
      thresholdBreached: true,
      resultOutcome: "Failed due to confirmed cheating",
      studentNotice: "The proctor confirmed cheating for this attempt. You have been disqualified from this exam."
    };
  }
  const thresholdBreached = Number(row.integrity_score || 0) >= Number(row.integrity_threshold || 0) && Number(row.integrity_threshold || 0) > 0;
  return {
    thresholdBreached,
    resultOutcome: thresholdBreached ? "Failed due to integrity threshold breach" : "Published",
    studentNotice: thresholdBreached
      ? "Your final integrity penalty crossed the allowed threshold for this exam, so this attempt has been marked as failed."
      : ""
  };
}

router.get(
  "/student/:studentId/results",
  requireAuth,
  requireSelf("studentId", { allowRoles: ["admin", "auditor"] }),
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const result = await pool.query(
      `
        SELECT
          r.id,
          r.exam_id,
          r.student_id,
          r.total_marks,
          r.awarded_marks,
          r.percentage,
          r.integrity_score,
          r.case_status,
          r.submission_hash_verified,
          r.status,
          r.published_at,
          e.title AS exam_title,
          e.course_code,
          e.integrity_threshold,
          latest_case.status AS latest_case_status,
          latest_request.id AS recheck_request_id,
          latest_request.reason AS recheck_reason,
          latest_request.status AS recheck_status,
          latest_request.requested_at,
          latest_request.reviewed_at,
          latest_request.decision_notes,
          latest_request.adjusted_marks,
          reviewer.full_name AS reviewed_by_name,
          latest_doc.id AS result_report_document_id
        FROM result r
        JOIN exam e ON e.id = r.exam_id
        LEFT JOIN LATERAL (
          SELECT rr.*
          FROM recheck_request rr
          WHERE rr.result_id = r.id
          ORDER BY rr.requested_at DESC
          LIMIT 1
        ) latest_request ON TRUE
        LEFT JOIN app_user reviewer ON reviewer.id = latest_request.reviewed_by
        LEFT JOIN LATERAL (
          SELECT ic.status
          FROM integrity_case ic
          WHERE ic.exam_id = r.exam_id
            AND ic.student_id = r.student_id
          ORDER BY ic.closed_at DESC NULLS LAST, ic.opened_at DESC
          LIMIT 1
        ) latest_case ON TRUE
        LEFT JOIN LATERAL (
          SELECT sd.id
          FROM stored_document sd
          WHERE sd.exam_id = r.exam_id
            AND sd.student_id = r.student_id
            AND sd.document_type = 'result_report'
          ORDER BY sd.created_at DESC
          LIMIT 1
        ) latest_doc ON TRUE
        WHERE r.student_id = $1
          AND r.status IN ('published', 'withheld')
        ORDER BY r.published_at DESC NULLS LAST, e.start_at DESC
      `,
      [studentId]
    );

    res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        examId: row.exam_id,
        studentId: row.student_id,
        examTitle: row.exam_title,
        courseCode: row.course_code,
        totalMarks: Number(row.total_marks),
        awardedMarks: Number(row.awarded_marks),
        percentage: Number(row.percentage),
        integrityScore: Number(row.integrity_score || 0),
        caseStatus: row.latest_case_status || row.case_status || "clear",
        submissionHashVerified: Boolean(row.submission_hash_verified),
        publishedAt: row.published_at,
        resultReportDocumentId: row.result_report_document_id || null,
        recheckRequest: row.recheck_request_id ? {
          id: row.recheck_request_id,
          reason: row.recheck_reason,
          status: row.recheck_status,
          requestedAt: row.requested_at,
          reviewedAt: row.reviewed_at,
          decisionNotes: row.decision_notes || "",
          adjustedMarks: row.adjusted_marks === null || row.adjusted_marks === undefined ? null : Number(row.adjusted_marks),
          reviewedByName: row.reviewed_by_name || null
        } : null,
        ...buildResultOutcome({
          ...row,
          case_status: row.latest_case_status || row.case_status
        })
      }))
    });
  })
);

router.post(
  "/requests",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const { resultId, reason } = req.body;
    const studentId = req.user.id;
    const actorUserId = req.user.id;

    if (!resultId || !String(reason || "").trim()) {
      return res.status(400).json({ message: "resultId and reason are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const resultMeta = await client.query(
        `
          SELECT r.id, r.exam_id, r.student_id, r.status, e.title
          FROM result r
          JOIN exam e ON e.id = r.exam_id
          WHERE r.id = $1 AND r.student_id = $2
        `,
        [resultId, studentId]
      );

      if (!resultMeta.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Published result not found for this student." });
      }

      if (resultMeta.rows[0].status !== "published") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Only published results can be sent for re-check." });
      }

      const existing = await client.query(
        `
          SELECT id, status
          FROM recheck_request
          WHERE result_id = $1
          ORDER BY requested_at DESC
          LIMIT 1
        `,
        [resultId]
      );

      if (existing.rows.length && ["requested", "accepted"].includes(existing.rows[0].status)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "A re-check request is already active for this published result." });
      }

      const inserted = await client.query(
        `
          INSERT INTO recheck_request (result_id, student_id, reason, status)
          VALUES ($1, $2, $3, 'requested')
          RETURNING *
        `,
        [resultId, studentId, String(reason).trim()]
      );

      await writeAuditLog(client, {
        actorUserId: actorUserId || studentId,
        actorRole: "student",
        action: "recheck_requested",
        entityType: "recheck_request",
        entityId: inserted.rows[0].id,
        ipAddress: req.ip,
        details: {
          resultId,
          studentId,
          examId: resultMeta.rows[0].exam_id
        }
      });

      await client.query("COMMIT");
      res.status(201).json({ item: inserted.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/requests",
  requireAuth,
  requireRole("admin", "evaluator"),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const values = [];
    const filters = [];

    if (status) {
      values.push(status);
      filters.push(`rr.status = $${values.length}::recheck_status`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query(
      `
        SELECT
          rr.id,
          rr.result_id,
          rr.student_id,
          rr.reason,
          rr.status,
          rr.requested_at,
          rr.reviewed_at,
          rr.decision_notes,
          rr.adjusted_marks,
          rr.reviewed_by,
          student.full_name AS student_name,
          student.email AS student_email,
          reviewer.full_name AS reviewed_by_name,
          r.exam_id,
          r.total_marks,
          r.awarded_marks,
          r.percentage,
          r.integrity_score,
          r.case_status,
          r.submission_hash_verified,
          e.title AS exam_title,
          e.course_code
        FROM recheck_request rr
        JOIN result r ON r.id = rr.result_id
        JOIN exam e ON e.id = r.exam_id
        JOIN app_user student ON student.id = rr.student_id
        LEFT JOIN app_user reviewer ON reviewer.id = rr.reviewed_by
        ${where}
        ORDER BY
          CASE rr.status
            WHEN 'requested' THEN 0
            WHEN 'accepted' THEN 1
            WHEN 'adjusted' THEN 2
            ELSE 3
          END,
          rr.requested_at DESC
      `,
      values
    );

    res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        resultId: row.result_id,
        studentId: row.student_id,
        studentName: row.student_name,
        studentEmail: row.student_email,
        examId: row.exam_id,
        examTitle: row.exam_title,
        courseCode: row.course_code,
        reason: row.reason,
        status: row.status,
        requestedAt: row.requested_at,
        reviewedAt: row.reviewed_at,
        decisionNotes: row.decision_notes || "",
        adjustedMarks: row.adjusted_marks === null || row.adjusted_marks === undefined ? null : Number(row.adjusted_marks),
        reviewedBy: row.reviewed_by,
        reviewedByName: row.reviewed_by_name || null,
        totalMarks: Number(row.total_marks),
        awardedMarks: Number(row.awarded_marks),
        percentage: Number(row.percentage),
        integrityScore: Number(row.integrity_score || 0),
        caseStatus: row.case_status || "clear",
        submissionHashVerified: Boolean(row.submission_hash_verified)
      }))
    });
  })
);

router.patch(
  "/requests/:requestId",
  requireAuth,
  requireRole("evaluator"),
  asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const { status, decisionNotes = "", adjustedMarks = null } = req.body;
    const reviewedBy = req.user.id;
    const actorRole = req.user.role;

    if (!status || !["accepted", "rejected", "adjusted"].includes(status)) {
      return res.status(400).json({ message: "status must be accepted, rejected, or adjusted." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const requestResult = await client.query(
        `
          SELECT
          rr.*,
          r.exam_id,
          r.submission_id,
          r.student_id AS result_student_id,
          r.total_marks,
            r.awarded_marks,
            r.integrity_score,
            r.case_status,
            r.submission_hash_verified,
            e.title AS exam_title,
            e.course_code,
            e.integrity_threshold,
            student.full_name AS student_name,
            student.email AS student_email
          FROM recheck_request rr
          JOIN result r ON r.id = rr.result_id
          JOIN exam e ON e.id = r.exam_id
          JOIN app_user student ON student.id = r.student_id
          WHERE rr.id = $1
        `,
        [requestId]
      );

      if (!requestResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Re-check request not found." });
      }

      const requestRow = requestResult.rows[0];
      const parsedAdjustedMarks = adjustedMarks === null || adjustedMarks === undefined || adjustedMarks === "" ? null : Number(adjustedMarks);

      if (status === "adjusted") {
        if (!Number.isFinite(parsedAdjustedMarks)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "adjustedMarks is required when status is adjusted." });
        }
        if (parsedAdjustedMarks < 0 || parsedAdjustedMarks > Number(requestRow.total_marks)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: `adjustedMarks must be between 0 and ${Number(requestRow.total_marks)}.` });
        }

        await client.query(
          `
            UPDATE evaluation
               SET awarded_marks = $2,
                   feedback = CASE
                     WHEN COALESCE(feedback, '') = '' THEN $3
                     ELSE feedback || E'\n\n' || $3
                   END,
                   evaluated_at = NOW()
             WHERE submission_id = $1
          `,
          [
            requestRow.submission_id,
            parsedAdjustedMarks,
            `Marks adjusted through re-check workflow by reviewer.`
          ]
        ).catch(() => null);

        await client.query(
          `
            UPDATE result
               SET awarded_marks = $2
             WHERE id = $1
          `,
          [requestRow.result_id, parsedAdjustedMarks]
        );
      }

      const updated = await client.query(
        `
          UPDATE recheck_request
             SET status = $2::recheck_status,
                 reviewed_by = $3,
                 reviewed_at = NOW(),
                 decision_notes = $4,
                 adjusted_marks = $5
           WHERE id = $1
           RETURNING *
        `,
        [requestId, status, reviewedBy, decisionNotes || null, status === "adjusted" ? parsedAdjustedMarks : null]
      );

      if (status === "adjusted") {
        const refreshedResult = await client.query(
          `
            SELECT id, awarded_marks, total_marks, percentage, integrity_score, case_status, submission_hash_verified, published_at
            FROM result
            WHERE id = $1
          `,
          [requestRow.result_id]
        );

        await createResultReportDocument(client, {
          exam: {
            id: requestRow.exam_id,
            title: requestRow.exam_title,
            course_code: requestRow.course_code,
            integrity_threshold: requestRow.integrity_threshold
          },
          student: {
            id: requestRow.result_student_id,
            fullName: requestRow.student_name,
            email: requestRow.student_email
          },
          result: {
            awardedMarks: Number(refreshedResult.rows[0].awarded_marks),
            totalMarks: Number(refreshedResult.rows[0].total_marks),
            percentage: Number(refreshedResult.rows[0].percentage),
            integrityScore: Number(refreshedResult.rows[0].integrity_score),
            caseStatus: refreshedResult.rows[0].case_status,
            submissionHashVerified: refreshedResult.rows[0].submission_hash_verified,
            publishedAt: refreshedResult.rows[0].published_at,
            ...buildResultOutcome({
              integrity_score: refreshedResult.rows[0].integrity_score,
              integrity_threshold: requestRow.integrity_threshold
            })
          },
          uploadedBy: reviewedBy,
          actorRole,
          ipAddress: req.ip
        });
      }

      await writeAuditLog(client, {
        actorUserId: reviewedBy,
        actorRole,
        action: "recheck_reviewed",
        entityType: "recheck_request",
        entityId: requestId,
        ipAddress: req.ip,
        details: {
          resultId: requestRow.result_id,
          studentId: requestRow.student_id,
          examId: requestRow.exam_id,
          status,
          adjustedMarks: status === "adjusted" ? parsedAdjustedMarks : null,
          storageConfigured: isStorageConfigured()
        }
      });

      await client.query("COMMIT");
      res.json({ item: updated.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
