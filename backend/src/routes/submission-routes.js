const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const { writeAuditLog } = require("../services/audit-service");

const router = express.Router();

router.post(
  "/autosave",
  asyncHandler(async (req, res) => {
    const { examId, studentId, attemptNo = 1, currentAnswers, actorUserId = null } = req.body;

    if (!examId || !studentId || !currentAnswers) {
      return res.status(400).json({
        message: "examId, studentId, and currentAnswers are required."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          INSERT INTO answer_submission (
            exam_id,
            student_id,
            attempt_no,
            current_answers,
            autosave_version,
            status
          )
          VALUES ($1, $2, $3, $4::jsonb, 1, 'in_progress')
          ON CONFLICT (exam_id, student_id, attempt_no)
          DO UPDATE SET
            current_answers = EXCLUDED.current_answers,
            autosave_version = answer_submission.autosave_version + 1,
            updated_at = NOW()
          RETURNING *
        `,
        [examId, studentId, attemptNo, JSON.stringify(currentAnswers)]
      );

      await writeAuditLog(client, {
        actorUserId,
        actorRole: actorUserId ? "student" : null,
        action: "submission_autosaved",
        entityType: "answer_submission",
        entityId: result.rows[0].id,
        ipAddress: req.ip,
        details: {
          examId,
          studentId,
          attemptNo,
          autosaveVersion: result.rows[0].autosave_version
        }
      });

      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/finalize",
  asyncHandler(async (req, res) => {
    const { examId, studentId, attemptNo = 1, finalAnswers, actorUserId = null } = req.body;

    if (!examId || !studentId || !finalAnswers) {
      return res.status(400).json({
        message: "examId, studentId, and finalAnswers are required."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const submissionResult = await client.query(
        `
          INSERT INTO answer_submission (
            exam_id,
            student_id,
            attempt_no,
            current_answers,
            final_answers,
            autosave_version,
            final_submitted_at,
            status
          )
          VALUES ($1, $2, $3, $4::jsonb, $4::jsonb, 1, NOW(), 'submitted')
          ON CONFLICT (exam_id, student_id, attempt_no)
          DO UPDATE SET
            current_answers = EXCLUDED.current_answers,
            final_answers = EXCLUDED.final_answers,
            final_submitted_at = NOW(),
            status = 'submitted',
            updated_at = NOW()
          RETURNING *
        `,
        [examId, studentId, attemptNo, JSON.stringify(finalAnswers)]
      );

      await client.query(
        `
          UPDATE exam_candidate
             SET status = 'submitted',
                 submitted_at = NOW()
           WHERE exam_id = $1
             AND student_id = $2
             AND attempt_no = $3
        `,
        [examId, studentId, attemptNo]
      );

      await writeAuditLog(client, {
        actorUserId,
        actorRole: actorUserId ? "student" : null,
        action: "submission_finalized",
        entityType: "answer_submission",
        entityId: submissionResult.rows[0].id,
        ipAddress: req.ip,
        details: {
          examId,
          studentId,
          attemptNo
        }
      });

      await client.query("COMMIT");
      res.json(submissionResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
