const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const { writeAuditLog } = require("../services/audit-service");
const { scoreQuestion, calculatePenalty } = require("../services/grading-service");
const { isMailConfigured, sendResultPublishedEmail } = require("../services/mail-service");
const { isStorageConfigured } = require("../services/storage-service");
const { createResultReportDocument } = require("../services/document-service");
const { requireAuth, requireRole, requireSelf } = require("../middleware/auth");

const router = express.Router();

function normalizeResultCaseStatus(caseStatus) {
  return caseStatus && caseStatus !== "not_opened" ? caseStatus : null;
}

function buildPublishedResultOutcome(row, integrityThreshold) {
  const caseStatus = String(row.case_status || "").toLowerCase();
  if (caseStatus === "confirmed_cheating") {
    return {
      thresholdBreached: true,
      resultOutcome: "Failed due to confirmed cheating",
      studentNotice: "The proctor confirmed cheating for this attempt. You have been disqualified from this exam."
    };
  }

  const thresholdBreached = Number(row.integrity_score || 0) >= Number(integrityThreshold || 0) && Number(integrityThreshold || 0) > 0;
  return {
    thresholdBreached,
    resultOutcome: thresholdBreached ? "Failed due to integrity threshold breach" : "Published",
    studentNotice: thresholdBreached
      ? "Your final integrity penalty crossed the allowed threshold for this exam, so this attempt has been marked as failed."
      : ""
  };
}

async function getVerifiedStudentIds(client, studentIds) {
  if (!studentIds.length) return [];

  const result = await client.query(
    `
      SELECT id
      FROM app_user
      WHERE id = ANY($1::uuid[]) AND role = 'student' AND email_verified = TRUE AND is_active = TRUE
    `,
    [studentIds]
  );

  return result.rows.map((row) => row.id);
}

async function buildEvaluatedResults(client, { examId, actorId, actorRole, ipAddress }) {
  const examMeta = await client.query(`SELECT id, title, course_code, rules FROM exam WHERE id = $1`, [examId]);
  if (!examMeta.rows.length) {
    const error = new Error("Exam not found.");
    error.statusCode = 404;
    throw error;
  }

  const questions = await client.query(
    `
      SELECT q.id, q.question_type, q.correct_answer, COALESCE(eq.marks_override, q.default_marks) AS marks
        FROM exam_question eq
        JOIN question q ON q.id = eq.question_id
       WHERE eq.exam_id = $1
    `,
    [examId]
  );

  const submissions = await client.query(
    `
      SELECT s.id AS submission_id, s.exam_id, s.student_id, s.final_answers, ec.suspicion_score,
             vcs.case_status, vcs.submission_hash_verified
        FROM answer_submission s
        JOIN exam_candidate ec ON ec.exam_id = s.exam_id AND ec.student_id = s.student_id AND ec.attempt_no = s.attempt_no
        LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = s.exam_id AND vcs.student_id = s.student_id AND vcs.attempt_no = s.attempt_no
       WHERE s.exam_id = $1 AND s.final_answers IS NOT NULL
    `,
    [examId]
  );

  const totalMarks = questions.rows.reduce((sum, item) => sum + Number(item.marks), 0);
  const evaluated = [];

  for (const submission of submissions.rows) {
    const answers = submission.final_answers || {};
    const rawScore = questions.rows.reduce((sum, question) => sum + scoreQuestion(question, answers), 0);
    const penalty = calculatePenalty(submission.suspicion_score, examMeta.rows[0].rules || {});
    const awardedMarks = Math.max(0, Number((rawScore - penalty).toFixed(2)));
    const verifiedResult = await client.query(`SELECT verify_submission_hash($1::uuid) AS verified`, [submission.submission_id]);
    const hashVerified = verifiedResult.rows[0].verified;

    await client.query(
      `
        INSERT INTO evaluation (submission_id, evaluator_id, awarded_marks, feedback, rubric_breakdown, evaluated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
        ON CONFLICT (submission_id)
        DO UPDATE SET
          evaluator_id = EXCLUDED.evaluator_id,
          awarded_marks = EXCLUDED.awarded_marks,
          feedback = EXCLUDED.feedback,
          rubric_breakdown = EXCLUDED.rubric_breakdown,
          evaluated_at = NOW()
      `,
      [
        submission.submission_id,
        actorId,
        awardedMarks,
        "Auto-evaluated from configured answer key and integrity rules.",
        JSON.stringify({ rawScore, penalty })
      ]
    );

    const result = await client.query(
      `
        INSERT INTO result (
          exam_id, student_id, submission_id, total_marks, awarded_marks,
          integrity_score, case_status, submission_hash_verified, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::case_status, $8, 'draft')
        ON CONFLICT (submission_id)
        DO UPDATE SET
          total_marks = EXCLUDED.total_marks,
          awarded_marks = EXCLUDED.awarded_marks,
          integrity_score = EXCLUDED.integrity_score,
          case_status = EXCLUDED.case_status,
          submission_hash_verified = EXCLUDED.submission_hash_verified,
          status = 'draft'
        RETURNING *
      `,
      [
        examId,
        submission.student_id,
        submission.submission_id,
        totalMarks,
        awardedMarks,
        submission.suspicion_score,
        normalizeResultCaseStatus(submission.case_status),
        hashVerified
      ]
    );

    evaluated.push(result.rows[0]);
  }

  await writeAuditLog(client, {
    actorUserId: actorId,
    actorRole,
    action: "exam_evaluated",
    entityType: "exam",
    entityId: examId,
    ipAddress,
    details: { evaluatedCount: evaluated.length }
  });

  return {
    exam: examMeta.rows[0],
    totalMarks,
    items: evaluated
  };
}

router.get(
  "/assigned/:studentId",
  requireAuth,
  requireSelf("studentId", { allowRoles: ["admin", "auditor"] }),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.course_code,
          e.start_at,
          e.end_at,
          e.duration_minutes,
          e.status,
          ec.attempt_no,
          ec.status AS candidate_status,
          ec.suspicion_score,
          ec.suspicion_score AS integrity_score,
          COALESCE(vcs.case_status::text, 'not_opened') AS case_status,
          COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified
        FROM exam_candidate ec
        JOIN exam e ON e.id = ec.exam_id
        LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = ec.exam_id AND vcs.student_id = ec.student_id AND vcs.attempt_no = ec.attempt_no
        WHERE ec.student_id = $1
        ORDER BY e.start_at ASC
      `,
      [req.params.studentId]
    );

    res.json({ items: result.rows });
  })
);

router.get(
  "/:examId/candidates",
  requireAuth,
  requireRole("admin", "auditor"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        SELECT ec.student_id, u.full_name, u.email, u.email_verified, u.is_active
        FROM exam_candidate ec
        JOIN app_user u ON u.id = ec.student_id
        WHERE ec.exam_id = $1
        ORDER BY u.full_name ASC
      `,
      [req.params.examId]
    );

    res.json({
      items: result.rows.map((item) => ({
        id: item.student_id,
        fullName: item.full_name,
        email: item.email,
        emailVerified: item.email_verified,
        isActive: item.is_active
      }))
    });
  })
);

router.get(
  "/:examId/paper",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const requestedStudentId = req.query.studentId;
    const studentId = req.user.role === "student" ? req.user.id : requestedStudentId;

    if (!studentId) {
      return res.status(400).json({ message: "studentId is required." });
    }
    if (req.user.role === "student" && requestedStudentId && String(requestedStudentId) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only access your own assigned exam paper." });
    }
    if (req.user.role !== "student" && !["admin", "auditor"].includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have access to this action." });
    }

    const examResult = await pool.query(
      `
        SELECT e.id, e.title, e.description, e.course_code, e.start_at, e.end_at, e.duration_minutes, e.rules,
               ec.attempt_no, ec.status AS candidate_status
          FROM exam e
          JOIN exam_candidate ec ON ec.exam_id = e.id
         WHERE e.id = $1 AND ec.student_id = $2
      `,
      [examId, studentId]
    );

    if (!examResult.rows.length) {
      return res.status(404).json({ message: "Assigned exam not found for this student." });
    }

    const questionResult = await pool.query(
      `
        SELECT q.id, q.question_type, q.prompt, q.options, COALESCE(eq.marks_override, q.default_marks) AS marks, eq.sequence_no
          FROM exam_question eq
          JOIN question q ON q.id = eq.question_id
         WHERE eq.exam_id = $1
         ORDER BY eq.sequence_no ASC
      `,
      [examId]
    );

    res.json({ exam: examResult.rows[0], questions: questionResult.rows });
  })
);

router.get(
  "/",
  requireAuth,
  requireRole("admin", "proctor", "evaluator", "auditor"),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const values = [];
    let where = "";

    if (status) {
      values.push(status);
      where = "WHERE e.status = $1";
    }

    const result = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.course_code,
          e.status,
          e.start_at,
          e.end_at,
          e.duration_minutes,
          e.integrity_threshold,
          creator.full_name AS created_by_name,
          COUNT(DISTINCT ec.student_id) AS candidate_count,
          COUNT(DISTINCT eq.question_id) AS question_count,
          COUNT(DISTINCT s.student_id) AS submitted_count,
          COUNT(DISTINCT CASE WHEN r.status = 'draft' THEN r.student_id END) AS evaluated_count,
          COUNT(DISTINCT CASE WHEN r.status = 'published' THEN r.student_id END) AS published_count,
          COALESCE(cp.opened_case_count, 0) AS opened_case_count,
          COALESCE(cp.pending_case_decision_count, 0) AS pending_case_decision_count,
          CASE
            WHEN COUNT(DISTINCT CASE WHEN r.status = 'published' THEN r.student_id END) > 0 THEN 'published'
            WHEN COUNT(DISTINCT ec.student_id) = 0 THEN 'waiting_for_submissions'
            WHEN COUNT(DISTINCT s.student_id) < COUNT(DISTINCT ec.student_id) THEN 'waiting_for_submissions'
            WHEN COUNT(DISTINCT CASE WHEN r.status = 'draft' THEN r.student_id END) < COUNT(DISTINCT ec.student_id) THEN 'waiting_for_evaluation'
            WHEN COALESCE(cp.pending_case_decision_count, 0) > 0 THEN 'waiting_for_proctor_decision'
            ELSE 'ready_to_publish'
          END AS publish_state
        FROM exam e
        JOIN app_user creator ON creator.id = e.created_by
        LEFT JOIN exam_candidate ec ON ec.exam_id = e.id
        LEFT JOIN exam_question eq ON eq.exam_id = e.id
        LEFT JOIN answer_submission s ON s.exam_id = e.id AND s.final_answers IS NOT NULL
        LEFT JOIN result r ON r.exam_id = e.id
        LEFT JOIN (
          SELECT
            latest.exam_id,
            COUNT(DISTINCT latest.student_id) AS opened_case_count,
            COUNT(DISTINCT CASE WHEN latest.decision IS NULL THEN latest.student_id END) AS pending_case_decision_count
          FROM (
            SELECT DISTINCT ON (exam_id, student_id, attempt_no)
              id,
              exam_id,
              student_id,
              attempt_no,
              decision
            FROM integrity_case
            ORDER BY exam_id, student_id, attempt_no, opened_at DESC
          ) latest
          GROUP BY latest.exam_id
        ) cp ON cp.exam_id = e.id
        ${where}
        GROUP BY e.id, creator.full_name, cp.opened_case_count, cp.pending_case_decision_count
        ORDER BY e.start_at DESC
      `,
      values
    );

    res.json({ items: result.rows });
  })
);

router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const {
      title,
      description = null,
      courseCode,
      startAt,
      endAt,
      durationMinutes,
      integrityThreshold = 10,
      rules = {},
      questions = [],
      studentIds = []
    } = req.body;
    const createdBy = req.user.id;
    const actorRole = req.user.role;

    if (!title || !courseCode || !startAt || !endAt || !durationMinutes) {
      return res.status(400).json({ message: "title, courseCode, startAt, endAt, and durationMinutes are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const examResult = await client.query(
        `
          INSERT INTO exam (
            title, description, course_code, status, start_at, end_at,
            duration_minutes, integrity_threshold, rules, created_by
          ) VALUES ($1, $2, $3, 'scheduled', $4, $5, $6, $7, $8::jsonb, $9)
          RETURNING *
        `,
        [title, description, courseCode, startAt, endAt, durationMinutes, integrityThreshold, JSON.stringify(rules), createdBy]
      );

      const exam = examResult.rows[0];
      let bankId = null;

      if (questions.length) {
        const bankResult = await client.query(
          `INSERT INTO question_bank (title, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
          [`${title} Question Bank`, `Auto-created bank for ${title}`, createdBy]
        );
        bankId = bankResult.rows[0].id;

        for (let index = 0; index < questions.length; index += 1) {
          const item = questions[index];
          const questionResult = await client.query(
            `
              INSERT INTO question (bank_id, created_by, question_type, prompt, options, correct_answer, default_marks, metadata)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)
              RETURNING id
            `,
            [
              bankId,
              createdBy,
              item.questionType,
              item.prompt,
              JSON.stringify(item.options || []),
              JSON.stringify(item.correctAnswer),
              Number(item.marks || 1),
              JSON.stringify({ authoredIn: "admin_ui" })
            ]
          );

          await client.query(
            `INSERT INTO exam_question (exam_id, question_id, sequence_no, marks_override) VALUES ($1, $2, $3, $4)`,
            [exam.id, questionResult.rows[0].id, index + 1, Number(item.marks || 1)]
          );
        }
      }

      const verifiedStudentIds = await getVerifiedStudentIds(client, studentIds);
      if (verifiedStudentIds.length !== studentIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Only active, email-verified students can be assigned to an exam." });
      }

      for (const studentId of verifiedStudentIds) {
        await client.query(
          `INSERT INTO exam_candidate (exam_id, student_id, attempt_no) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
          [exam.id, studentId]
        );
      }

      await writeAuditLog(client, {
        actorUserId: createdBy,
        actorRole,
        action: "exam_created",
        entityType: "exam",
        entityId: exam.id,
        ipAddress: req.ip,
        details: { title, courseCode, questionCount: questions.length, assignedStudents: studentIds.length }
      });

      await client.query("COMMIT");
      res.status(201).json({ ...exam, questionCount: questions.length, assignedStudents: studentIds.length });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/:examId/candidates",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const { studentIds = [] } = req.body;
    const assignedBy = req.user.id;

    if (!studentIds.length) {
      return res.status(400).json({ message: "studentIds is required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = [];
      const verifiedStudentIds = await getVerifiedStudentIds(client, studentIds);

      if (verifiedStudentIds.length !== studentIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Only active, email-verified students can be assigned to an exam." });
      }

      for (const studentId of verifiedStudentIds) {
        const result = await client.query(
          `
            INSERT INTO exam_candidate (exam_id, student_id, attempt_no)
            VALUES ($1, $2, 1)
            ON CONFLICT (exam_id, student_id, attempt_no) DO NOTHING
            RETURNING *
          `,
          [examId, studentId]
        );
        if (result.rows.length) inserted.push(result.rows[0]);
      }

      await writeAuditLog(client, {
        actorUserId: assignedBy,
        actorRole: "admin",
        action: "exam_assigned",
        entityType: "exam",
        entityId: examId,
        ipAddress: req.ip,
        details: { studentCount: inserted.length }
      });

      await client.query("COMMIT");
      res.status(201).json({ items: inserted });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/:examId/candidates/remove",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const { studentIds = [] } = req.body;
    const removedBy = req.user.id;

    if (!studentIds.length) {
      return res.status(400).json({ message: "studentIds is required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const removed = await client.query(
        `
          DELETE FROM exam_candidate
          WHERE exam_id = $1 AND student_id = ANY($2::uuid[]) AND attempt_no = 1
          RETURNING exam_id, student_id
        `,
        [examId, studentIds]
      );

      await writeAuditLog(client, {
        actorUserId: removedBy,
        actorRole: "admin",
        action: "exam_unassigned",
        entityType: "exam",
        entityId: examId,
        ipAddress: req.ip,
        details: { studentCount: removed.rows.length }
      });

      await client.query("COMMIT");
      res.json({ items: removed.rows });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/:examId/evaluation-submissions",
  requireAuth,
  requireRole("admin", "evaluator"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;

    const examMeta = await pool.query(
      `
        SELECT id, title, course_code
        FROM exam
        WHERE id = $1
      `,
      [examId]
    );

    if (!examMeta.rows.length) {
      return res.status(404).json({ message: "Exam not found." });
    }

    const questions = await pool.query(
      `
        SELECT q.id, q.question_type, q.prompt, q.options, q.correct_answer, COALESCE(eq.marks_override, q.default_marks) AS marks, eq.sequence_no
        FROM exam_question eq
        JOIN question q ON q.id = eq.question_id
        WHERE eq.exam_id = $1
        ORDER BY eq.sequence_no ASC
      `,
      [examId]
    );

    const submissions = await pool.query(
      `
        SELECT
          s.id AS submission_id,
          s.student_id,
          u.full_name AS student_name,
          u.email AS student_email,
          s.attempt_no,
          s.final_answers,
          s.final_submitted_at,
          ec.suspicion_score AS integrity_score,
          COALESCE(vcs.case_status::text, 'not_opened') AS case_status,
          COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified,
          ev.awarded_marks,
          ev.feedback,
          ev.rubric_breakdown,
          ev.evaluated_at
        FROM answer_submission s
        JOIN app_user u ON u.id = s.student_id
        JOIN exam_candidate ec ON ec.exam_id = s.exam_id AND ec.student_id = s.student_id AND ec.attempt_no = s.attempt_no
        LEFT JOIN evaluation ev ON ev.submission_id = s.id
        LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = s.exam_id AND vcs.student_id = s.student_id AND vcs.attempt_no = s.attempt_no
        WHERE s.exam_id = $1 AND s.final_answers IS NOT NULL
        ORDER BY s.final_submitted_at ASC NULLS LAST, u.full_name ASC
      `,
      [examId]
    );

    const totalMarks = questions.rows.reduce((sum, question) => sum + Number(question.marks), 0);

    const items = submissions.rows.map((submission) => {
      const finalAnswers = submission.final_answers || {};
      return {
        submissionId: submission.submission_id,
        studentId: submission.student_id,
        studentName: submission.student_name,
        studentEmail: submission.student_email,
        attemptNo: submission.attempt_no,
        finalSubmittedAt: submission.final_submitted_at,
        integrityScore: submission.integrity_score,
        caseStatus: submission.case_status,
        submissionHashVerified: submission.submission_hash_verified,
        awardedMarks: submission.awarded_marks,
        feedback: submission.feedback || "",
        rubricBreakdown: submission.rubric_breakdown || {},
        evaluatedAt: submission.evaluated_at,
        totalMarks,
        answers: questions.rows.map((question) => ({
          questionId: question.id,
          sequenceNo: question.sequence_no,
          prompt: question.prompt,
          questionType: question.question_type,
          options: question.options,
          correctAnswer: question.correct_answer,
          maxMarks: Number(question.marks),
          studentAnswer: finalAnswers[question.id] ?? (question.question_type === 'msq' ? [] : '')
        }))
      };
    });

    res.json({ exam: examMeta.rows[0], items });
  })
);

router.post(
  "/:examId/evaluations/:submissionId",
  requireAuth,
  requireRole("evaluator"),
  asyncHandler(async (req, res) => {
    const { examId, submissionId } = req.params;
    const { awardedMarks, feedback = "", rubricBreakdown = {} } = req.body;
    const evaluatorId = req.user.id;

    if (awardedMarks === undefined || awardedMarks === null) {
      return res.status(400).json({ message: "awardedMarks is required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const submissionMeta = await client.query(
        `
          SELECT
            s.id,
            s.exam_id,
            s.student_id,
            s.attempt_no,
            ec.suspicion_score AS integrity_score,
            COALESCE(vcs.case_status::text, 'not_opened') AS case_status,
            COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified
          FROM answer_submission s
          JOIN exam_candidate ec ON ec.exam_id = s.exam_id AND ec.student_id = s.student_id AND ec.attempt_no = s.attempt_no
          LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = s.exam_id AND vcs.student_id = s.student_id AND vcs.attempt_no = s.attempt_no
          WHERE s.id = $1 AND s.exam_id = $2 AND s.final_answers IS NOT NULL
        `,
        [submissionId, examId]
      );

      if (!submissionMeta.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Submitted answer script not found for this exam." });
      }

      const marksMeta = await client.query(
        `
          SELECT COALESCE(SUM(COALESCE(eq.marks_override, q.default_marks)), 0) AS total_marks
          FROM exam_question eq
          JOIN question q ON q.id = eq.question_id
          WHERE eq.exam_id = $1
        `,
        [examId]
      );

      const totalMarks = Number(marksMeta.rows[0].total_marks || 0);
      const parsedAwardedMarks = Number(awardedMarks);

      if (!Number.isFinite(parsedAwardedMarks) || parsedAwardedMarks < 0 || parsedAwardedMarks > totalMarks) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `awardedMarks must be between 0 and ${totalMarks}.` });
      }

      const verifiedResult = await client.query(`SELECT verify_submission_hash($1::uuid) AS verified`, [submissionId]);
      const submissionHashVerified = verifiedResult.rows[0].verified;

      const evaluation = await client.query(
        `
          INSERT INTO evaluation (submission_id, evaluator_id, awarded_marks, feedback, rubric_breakdown, evaluated_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
          ON CONFLICT (submission_id)
          DO UPDATE SET
            evaluator_id = EXCLUDED.evaluator_id,
            awarded_marks = EXCLUDED.awarded_marks,
            feedback = EXCLUDED.feedback,
            rubric_breakdown = EXCLUDED.rubric_breakdown,
            evaluated_at = NOW()
          RETURNING *
        `,
        [submissionId, evaluatorId, parsedAwardedMarks, feedback, JSON.stringify(rubricBreakdown)]
      );

      const result = await client.query(
        `
          INSERT INTO result (
            exam_id, student_id, submission_id, total_marks, awarded_marks,
            integrity_score, case_status, submission_hash_verified, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::case_status, $8, 'draft')
          ON CONFLICT (submission_id)
          DO UPDATE SET
            total_marks = EXCLUDED.total_marks,
            awarded_marks = EXCLUDED.awarded_marks,
            integrity_score = EXCLUDED.integrity_score,
            case_status = EXCLUDED.case_status,
            submission_hash_verified = EXCLUDED.submission_hash_verified,
            status = 'draft'
          RETURNING *
        `,
        [
          examId,
          submissionMeta.rows[0].student_id,
          submissionId,
          totalMarks,
          parsedAwardedMarks,
          submissionMeta.rows[0].integrity_score,
          normalizeResultCaseStatus(submissionMeta.rows[0].case_status),
          submissionHashVerified
        ]
      );

      await writeAuditLog(client, {
        actorUserId: evaluatorId,
        actorRole: "evaluator",
        action: "submission_evaluated",
        entityType: "answer_submission",
        entityId: submissionId,
        ipAddress: req.ip,
        details: { examId, awardedMarks: parsedAwardedMarks }
      });

      await client.query("COMMIT");
      res.json({ evaluation: evaluation.rows[0], result: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/:examId/evaluate",
  requireAuth,
  requireRole("evaluator"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const evaluatorId = req.user.id;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const evaluated = await buildEvaluatedResults(client, {
        examId,
        actorId: evaluatorId,
        actorRole: "evaluator",
        ipAddress: req.ip
      });

      if (!evaluated.items.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "No submitted answer scripts are available for evaluation yet." });
      }

      await client.query("COMMIT");
      res.json({ message: "Evaluation completed.", ...evaluated });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.statusCode) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/:examId/publish-results",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const publishedBy = req.user.id;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const examMeta = await client.query(
        `
          SELECT e.id, e.title, e.course_code, e.integrity_threshold
          FROM exam e
          WHERE e.id = $1
        `,
        [examId]
      );

      if (!examMeta.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Exam not found." });
      }

      const examProgress = await client.query(
        `
          SELECT
            COUNT(DISTINCT ec.student_id) AS candidate_count,
            COUNT(DISTINCT s.student_id) AS submitted_count,
            COUNT(DISTINCT CASE WHEN r.status = 'draft' THEN r.student_id END) AS evaluated_count,
            COALESCE(cp.opened_case_count, 0) AS opened_case_count,
            COALESCE(cp.pending_case_decision_count, 0) AS pending_case_decision_count
          FROM exam e
          LEFT JOIN exam_candidate ec ON ec.exam_id = e.id
          LEFT JOIN answer_submission s ON s.exam_id = e.id AND s.final_answers IS NOT NULL
          LEFT JOIN result r ON r.exam_id = e.id
          LEFT JOIN (
            SELECT
              latest.exam_id,
              COUNT(DISTINCT latest.student_id) AS opened_case_count,
              COUNT(DISTINCT CASE WHEN latest.decision IS NULL THEN latest.student_id END) AS pending_case_decision_count
            FROM (
              SELECT DISTINCT ON (exam_id, student_id, attempt_no)
                id,
                exam_id,
                student_id,
                attempt_no,
                decision
              FROM integrity_case
              ORDER BY exam_id, student_id, attempt_no, opened_at DESC
            ) latest
            GROUP BY latest.exam_id
          ) cp ON cp.exam_id = e.id
          WHERE e.id = $1
          GROUP BY e.id, cp.opened_case_count, cp.pending_case_decision_count
        `,
        [examId]
      );

      const progress = examProgress.rows[0] || {
        candidate_count: 0,
        submitted_count: 0,
        evaluated_count: 0,
        opened_case_count: 0,
        pending_case_decision_count: 0
      };
      const candidateCount = Number(progress.candidate_count || 0);
      const submittedCount = Number(progress.submitted_count || 0);
      const evaluatedCount = Number(progress.evaluated_count || 0);
      const pendingCaseDecisionCount = Number(progress.pending_case_decision_count || 0);

      if (!candidateCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Assign students to this exam before publishing results." });
      }

      if (submittedCount < candidateCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "All assigned students must submit the exam before results can be published." });
      }

      if (evaluatedCount < candidateCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "All assigned students in this exam must be evaluated before publishing results." });
      }

      if (pendingCaseDecisionCount > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Open integrity cases must have a proctor decision before results can be published." });
      }

      const draftResults = await client.query(
        `
          SELECT r.id, r.exam_id, r.student_id, r.submission_id, r.total_marks, r.awarded_marks,
                 r.percentage, r.integrity_score, r.case_status, r.submission_hash_verified,
                 u.email, u.full_name
          FROM result r
          JOIN app_user u ON u.id = r.student_id
          WHERE r.exam_id = $1 AND r.status = 'draft'
        `,
        [examId]
      );

      if (draftResults.rows.length < candidateCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "All assigned students in this exam must be evaluated before publishing results." });
      }

      const published = [];
      let storedReportsCount = 0;
      for (const draft of draftResults.rows) {
        const result = await client.query(
          `
            UPDATE result
               SET status = 'published',
                   published_by = $2,
                   published_at = NOW()
             WHERE id = $1
             RETURNING *
          `,
          [draft.id, publishedBy]
        );
        const outcome = buildPublishedResultOutcome(draft, examMeta.rows[0].integrity_threshold);
        const publishedItem = {
          ...result.rows[0],
          studentId: draft.student_id,
          email: draft.email,
          fullName: draft.full_name,
          percentage: draft.percentage,
          thresholdBreached: outcome.thresholdBreached,
          resultOutcome: outcome.resultOutcome,
          studentNotice: outcome.studentNotice,
          publishedAt: result.rows[0].published_at,
          totalMarks: draft.total_marks,
          awardedMarks: draft.awarded_marks,
          integrityScore: draft.integrity_score,
          caseStatus: draft.case_status,
          submissionHashVerified: draft.submission_hash_verified
        };

        published.push(publishedItem);

        const storedReport = await createResultReportDocument(client, {
          exam: examMeta.rows[0],
          student: {
            id: draft.student_id,
            fullName: draft.full_name,
            email: draft.email
          },
          result: publishedItem,
          uploadedBy: publishedBy,
          actorRole: "admin",
          ipAddress: req.ip
        });

        if (storedReport.stored) {
          storedReportsCount += 1;
        }
      }

      await client.query(`UPDATE exam SET published_at = NOW(), updated_at = NOW() WHERE id = $1`, [examId]);
      await writeAuditLog(client, {
        actorUserId: publishedBy,
        actorRole: "admin",
        action: "results_published",
        entityType: "exam",
        entityId: examId,
        ipAddress: req.ip,
        details: { publishedCount: published.length }
      });

      await client.query("COMMIT");

      const emailIssues = [];
      if (isMailConfigured()) {
        for (const item of published) {
          try {
            await sendResultPublishedEmail({
              toEmail: item.email,
              toName: item.fullName,
              examTitle: examMeta.rows[0].title,
              courseCode: examMeta.rows[0].course_code,
              awardedMarks: item.awarded_marks,
              totalMarks: item.total_marks,
              percentage: item.percentage,
              integrityScore: item.integrity_score,
              caseStatus: item.case_status,
              submissionHashVerified: item.submission_hash_verified,
              thresholdBreached: item.thresholdBreached,
              integrityThreshold: Number(examMeta.rows[0].integrity_threshold || 0),
              resultOutcome: item.resultOutcome
            });
          } catch (error) {
            emailIssues.push({ email: item.email, message: error.message });
          }
        }
      }

      res.json({
        items: published,
        emailedCount: isMailConfigured() ? published.length - emailIssues.length : 0,
        emailIssues,
        mailConfigured: isMailConfigured(),
        storageConfigured: isStorageConfigured(),
        storedReportsCount
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/:examId/dashboard",
  requireAuth,
  requireRole("admin", "proctor", "auditor"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const summary = await pool.query(
      `
        SELECT
          ec.student_id,
          u.full_name AS student_name,
          ec.attempt_no,
          ec.status,
          ec.suspicion_score,
          vcs.case_status,
          vcs.submission_hash_verified,
          COUNT(ie.id) AS event_count
        FROM exam_candidate ec
        JOIN app_user u ON u.id = ec.student_id
        LEFT JOIN v_candidate_integrity_summary vcs ON vcs.exam_id = ec.exam_id AND vcs.student_id = ec.student_id AND vcs.attempt_no = ec.attempt_no
        LEFT JOIN integrity_event ie ON ie.exam_id = ec.exam_id AND ie.student_id = ec.student_id AND ie.attempt_no = ec.attempt_no
        WHERE ec.exam_id = $1
        GROUP BY ec.student_id, u.full_name, ec.attempt_no, ec.status, ec.suspicion_score, vcs.case_status, vcs.submission_hash_verified
        ORDER BY ec.suspicion_score DESC, event_count DESC
      `,
      [examId]
    );
    res.json({ items: summary.rows });
  })
);

module.exports = router;
