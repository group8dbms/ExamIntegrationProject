const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const { writeAuditLog } = require("../services/audit-service");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

async function loadAttemptContext(client, examId, studentId, attemptNo) {
  const result = await client.query(
    `
      SELECT
        ec.status,
        ec.started_at,
        ec.submitted_at,
        e.start_at,
        e.end_at,
        e.duration_minutes
      FROM exam_candidate ec
      JOIN exam e ON e.id = ec.exam_id
      WHERE ec.exam_id = $1 AND ec.student_id = $2 AND ec.attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}

async function closeAttempt({ client, examId, studentId, attemptNo, currentAnswers, actorUserId, ipAddress, reason }) {
  const attempt = await loadAttemptContext(client, examId, studentId, attemptNo);
  if (!attempt) {
    return { statusCode: 404, body: { message: "Assigned exam attempt not found for this student." } };
  }

  if (attempt.submitted_at || attempt.status === "submitted") {
    return { statusCode: 400, body: { message: "This exam attempt has already been submitted." } };
  }

  if (attempt.status === "closed") {
    return { statusCode: 200, body: { message: "This exam attempt is already closed." } };
  }

  const savedSubmission = await client.query(
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
    [examId, studentId, attemptNo, JSON.stringify(currentAnswers || {})]
  );

  await client.query(
    `
      UPDATE exam_candidate
         SET status = 'closed',
             submitted_at = NULL
       WHERE exam_id = $1
         AND student_id = $2
         AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );

  await writeAuditLog(client, {
    actorUserId,
    actorRole: "student",
    action: "exam_window_closed",
    entityType: "exam_candidate",
    entityId: null,
    ipAddress,
    details: {
      examId,
      studentId,
      attemptNo,
      reason,
      autosaveVersion: savedSubmission.rows[0]?.autosave_version ?? null
    }
  });

  return {
    statusCode: 200,
    body: {
      message: "Exam attempt closed and locked.",
      submission: savedSubmission.rows[0]
    }
  };
}

router.post(
  "/autosave",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const { examId, attemptNo = 1, currentAnswers } = req.body;
    const studentId = req.user.id;
    const actorUserId = req.user.id;

    if (!examId || !currentAnswers) {
      return res.status(400).json({
        message: "examId and currentAnswers are required."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const attempt = await loadAttemptContext(client, examId, studentId, attemptNo);
      if (!attempt) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Assigned exam attempt not found for this student." });
      }

      const now = new Date();
      if (now < new Date(attempt.start_at)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This exam has not started yet." });
      }
      if (attempt.status === "closed") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This exam attempt was closed and cannot be restarted." });
      }
      if (attempt.submitted_at || attempt.status === "submitted") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This exam attempt has already been submitted." });
      }

      let startedAt = attempt.started_at;
      if (!startedAt) {
        if (now > new Date(attempt.end_at)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "The exam window has already closed." });
        }

        const started = await client.query(
          `
            UPDATE exam_candidate
            SET started_at = NOW(),
                status = 'in_progress'
            WHERE exam_id = $1
              AND student_id = $2
              AND attempt_no = $3
            RETURNING started_at
          `,
          [examId, studentId, attemptNo]
        );
        startedAt = started.rows[0]?.started_at || now.toISOString();
      }

      const deadline = new Date(Math.min(
        new Date(attempt.end_at).getTime(),
        new Date(startedAt).getTime() + Number(attempt.duration_minutes || 0) * 60 * 1000
      ));
      if (now > deadline) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "The time limit has passed. The exam must now be finalized." });
      }

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
        actorRole: "student",
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
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const { examId, attemptNo = 1, finalAnswers } = req.body;
    const studentId = req.user.id;
    const actorUserId = req.user.id;

    if (!examId || !finalAnswers) {
      return res.status(400).json({
        message: "examId and finalAnswers are required."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const attempt = await loadAttemptContext(client, examId, studentId, attemptNo);
      if (!attempt) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Assigned exam attempt not found for this student." });
      }

      const now = new Date();
      if (now < new Date(attempt.start_at)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This exam has not started yet." });
      }
      if (attempt.status === "closed") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This exam attempt was closed and cannot be restarted." });
      }
      if (attempt.submitted_at || attempt.status === "submitted") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This exam attempt has already been submitted." });
      }

      if (!attempt.started_at) {
        if (now > new Date(attempt.end_at)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "The exam window has already closed." });
        }

        await client.query(
          `
            UPDATE exam_candidate
            SET started_at = NOW(),
                status = 'in_progress'
            WHERE exam_id = $1
              AND student_id = $2
              AND attempt_no = $3
          `,
          [examId, studentId, attemptNo]
        );
      }

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
        actorRole: "student",
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

router.post(
  "/close-attempt",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const { examId, attemptNo = 1, currentAnswers = {}, reason = "window_closed" } = req.body;
    const studentId = req.user.id;
    const actorUserId = req.user.id;

    if (!examId) {
      return res.status(400).json({
        message: "examId is required."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await closeAttempt({
        client,
        examId,
        studentId,
        attemptNo,
        currentAnswers,
        actorUserId,
        ipAddress: req.ip,
        reason
      });

      if (result.statusCode >= 400) {
        await client.query("ROLLBACK");
        return res.status(result.statusCode).json(result.body);
      }

      await client.query("COMMIT");
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
