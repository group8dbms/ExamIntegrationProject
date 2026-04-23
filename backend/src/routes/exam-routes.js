const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const env = require("../config/env");
const { writeAuditLog } = require("../services/audit-service");
const { scoreQuestion, calculatePenalty } = require("../services/grading-service");
const { isMailConfigured, sendResultPublishedEmail, sendPublishApprovalEmail } = require("../services/mail-service");
const { isStorageConfigured } = require("../services/storage-service");
const { createResultReportDocument } = require("../services/document-service");
const { requireAuth, requireRole, requireSelf } = require("../middleware/auth");

const router = express.Router();

function normalizeResultCaseStatus(caseStatus) {
  return caseStatus && caseStatus !== "not_opened" ? caseStatus : null;
}

function buildPublishedResultOutcome(row, integrityThreshold) {
  const submissionHashVerified = row.submission_hash_verified !== false;
  if (!submissionHashVerified) {
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

let publishApprovalSchemaPromise = null;
let reassignApprovalSchemaPromise = null;

async function ensurePublishApprovalSchema() {
  if (!publishApprovalSchemaPromise) {
    publishApprovalSchemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS result_publish_request (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exam_id UUID NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
        requested_by UUID NOT NULL REFERENCES app_user(id),
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'published', 'cancelled')),
        approved_by UUID REFERENCES app_user(id),
        approved_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS result_publish_request_recipient (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL REFERENCES result_publish_request(id) ON DELETE CASCADE,
        admin_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('notified', 'approved')),
        notified_at TIMESTAMPTZ,
        responded_at TIMESTAMPTZ,
        UNIQUE (request_id, admin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_publish_request_exam_created
        ON result_publish_request(exam_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_publish_request_recipient_admin
        ON result_publish_request_recipient(admin_id, status);
    `);
  }

  return publishApprovalSchemaPromise;
}

async function ensureReassignApprovalSchema() {
  if (!reassignApprovalSchemaPromise) {
    reassignApprovalSchemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS exam_reassign_request (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exam_id UUID NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL DEFAULT 1,
        requested_by UUID NOT NULL REFERENCES app_user(id),
        approved_by UUID REFERENCES app_user(id),
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
        admin_note TEXT,
        proctor_note TEXT,
        approved_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_reassign_request_exam_created
        ON exam_reassign_request(exam_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reassign_request_status_created
        ON exam_reassign_request(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reassign_request_student_exam
        ON exam_reassign_request(student_id, exam_id, created_at DESC);
    `);
  }

  return reassignApprovalSchemaPromise;
}

async function getLatestReassignRequestsByExam(client, examId) {
  await ensureReassignApprovalSchema();

  const result = await client.query(
    `
      SELECT DISTINCT ON (rr.student_id, rr.attempt_no)
        rr.id,
        rr.exam_id,
        rr.student_id,
        rr.attempt_no,
        rr.requested_by,
        requester.full_name AS requested_by_name,
        rr.approved_by,
        approver.full_name AS approved_by_name,
        rr.status,
        rr.admin_note,
        rr.proctor_note,
        rr.approved_at,
        rr.completed_at,
        rr.created_at,
        rr.updated_at
      FROM exam_reassign_request rr
      JOIN app_user requester ON requester.id = rr.requested_by
      LEFT JOIN app_user approver ON approver.id = rr.approved_by
      WHERE rr.exam_id = $1
      ORDER BY rr.student_id, rr.attempt_no, rr.created_at DESC
    `,
    [examId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    examId: row.exam_id,
    studentId: row.student_id,
    attemptNo: row.attempt_no,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    status: row.status,
    adminNote: row.admin_note,
    proctorNote: row.proctor_note,
    approvedAt: row.approved_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function getPendingReassignRequests(client) {
  await ensureReassignApprovalSchema();

  const result = await client.query(
    `
      SELECT
        rr.id,
        rr.exam_id,
        e.title AS exam_title,
        e.course_code,
        rr.student_id,
        student.full_name AS student_name,
        student.email AS student_email,
        rr.attempt_no,
        rr.requested_by,
        requester.full_name AS requested_by_name,
        rr.status,
        rr.admin_note,
        rr.created_at,
        CASE
          WHEN s.storage_metadata->>'systemGenerated' = 'not_appeared' THEN 'not_appeared'
          WHEN s.storage_metadata->>'systemGenerated' = 'closed_attempt' THEN 'closed'
          WHEN ec.started_at IS NOT NULL AND ec.submitted_at IS NULL THEN 'attempted'
          ELSE ec.status::text
        END AS candidate_status,
        ec.started_at,
        ec.submitted_at
      FROM exam_reassign_request rr
      JOIN exam e ON e.id = rr.exam_id
      JOIN app_user student ON student.id = rr.student_id
      JOIN app_user requester ON requester.id = rr.requested_by
      LEFT JOIN exam_candidate ec
        ON ec.exam_id = rr.exam_id
       AND ec.student_id = rr.student_id
       AND ec.attempt_no = rr.attempt_no
      LEFT JOIN answer_submission s
        ON s.exam_id = rr.exam_id
       AND s.student_id = rr.student_id
       AND s.attempt_no = rr.attempt_no
      WHERE rr.status = 'pending'
      ORDER BY rr.created_at DESC, e.title ASC, student.full_name ASC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    examId: row.exam_id,
    examTitle: row.exam_title,
    courseCode: row.course_code,
    studentId: row.student_id,
    studentName: row.student_name,
    studentEmail: row.student_email,
    attemptNo: row.attempt_no,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    candidateStatus: row.candidate_status,
    startedAt: row.started_at,
    submittedAt: row.submitted_at
  }));
}

async function resetCandidateAttempt(client, { examId, studentId, attemptNo }) {
  const caseIdsResult = await client.query(
    `
      SELECT id
      FROM integrity_case
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );
  const caseIds = caseIdsResult.rows.map((row) => row.id);

  const submissionIdsResult = await client.query(
    `
      SELECT id
      FROM answer_submission
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );
  const submissionIds = submissionIdsResult.rows.map((row) => row.id);

  if (submissionIds.length) {
    await client.query(
      `
        DELETE FROM evaluation
        WHERE submission_id = ANY($1::uuid[])
      `,
      [submissionIds]
    );

    await client.query(
      `
        DELETE FROM result
        WHERE submission_id = ANY($1::uuid[])
      `,
      [submissionIds]
    );
  }

  await client.query(
    `
      DELETE FROM answer_submission
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );

  await client.query(
    `
      DELETE FROM integrity_penalty_assignment
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );

  await client.query(
    `
      DELETE FROM proctor_flag
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );

  await client.query(
    `
      DELETE FROM integrity_event
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );

  if (caseIds.length) {
    await client.query(
      `
        DELETE FROM case_action
        WHERE case_id = ANY($1::uuid[])
      `,
      [caseIds]
    );

    await client.query(
      `
        DELETE FROM case_evidence
        WHERE case_id = ANY($1::uuid[])
      `,
      [caseIds]
    );
  }

  await client.query(
    `
      DELETE FROM integrity_case
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );

  await client.query(
    `
      UPDATE exam_candidate
      SET status = 'in_progress',
          started_at = NULL,
          submitted_at = NULL,
          suspicion_score = 0,
          last_ip = NULL,
          last_device = NULL
      WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
    `,
    [examId, studentId, attemptNo]
  );
}

async function getLatestPublishRequest(client, examId) {
  await ensurePublishApprovalSchema();

  const result = await client.query(
    `
      SELECT
        r.id,
        r.exam_id,
        r.requested_by,
        requester.full_name AS requested_by_name,
        requester.email AS requested_by_email,
        r.status,
        r.approved_by,
        approver.full_name AS approved_by_name,
        approver.email AS approved_by_email,
        r.approved_at,
        r.published_at,
        r.created_at,
        r.updated_at
      FROM result_publish_request r
      JOIN app_user requester ON requester.id = r.requested_by
      LEFT JOIN app_user approver ON approver.id = r.approved_by
      WHERE r.exam_id = $1
      ORDER BY r.created_at DESC
      LIMIT 1
    `,
    [examId]
  );

  if (!result.rows.length) return null;

  const request = result.rows[0];
  const recipients = await client.query(
    `
      SELECT
        rr.id,
        rr.admin_id,
        rr.status,
        rr.notified_at,
        rr.responded_at,
        admin.full_name,
        admin.email
      FROM result_publish_request_recipient rr
      JOIN app_user admin ON admin.id = rr.admin_id
      WHERE rr.request_id = $1
      ORDER BY admin.full_name ASC
    `,
    [request.id]
  );

  return {
    id: request.id,
    examId: request.exam_id,
    requestedBy: request.requested_by,
    requestedByName: request.requested_by_name,
    requestedByEmail: request.requested_by_email,
    status: request.status,
    approvedBy: request.approved_by,
    approvedByName: request.approved_by_name,
    approvedByEmail: request.approved_by_email,
    approvedAt: request.approved_at,
    publishedAt: request.published_at,
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    recipients: recipients.rows.map((row) => ({
      id: row.id,
      adminId: row.admin_id,
      fullName: row.full_name,
      email: row.email,
      status: row.status,
      notifiedAt: row.notified_at,
      respondedAt: row.responded_at
    }))
  };
}

async function loadPublishReadiness(client, examId) {
  await ensureAbsentCandidatesEvaluated(client, { examId });

  const examMeta = await client.query(
    `
      SELECT e.id, e.title, e.course_code, e.integrity_threshold, e.published_at
      FROM exam e
      WHERE e.id = $1
    `,
    [examId]
  );

  if (!examMeta.rows.length) {
    const error = new Error("Exam not found.");
    error.statusCode = 404;
    throw error;
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

  return {
    exam: examMeta.rows[0],
    progress: {
      candidateCount: Number(progress.candidate_count || 0),
      submittedCount: Number(progress.submitted_count || 0),
      evaluatedCount: Number(progress.evaluated_count || 0),
      openedCaseCount: Number(progress.opened_case_count || 0),
      pendingCaseDecisionCount: Number(progress.pending_case_decision_count || 0)
    }
  };
}

function assertPublishReadiness({ exam, progress }) {
  if (exam.published_at) {
    const error = new Error("Results for this exam have already been published.");
    error.statusCode = 400;
    throw error;
  }

  if (!progress.candidateCount) {
    const error = new Error("Assign students to this exam before requesting or publishing results.");
    error.statusCode = 400;
    throw error;
  }

  if (progress.submittedCount < progress.candidateCount) {
    const error = new Error("All assigned students must submit the exam before results can be published.");
    error.statusCode = 400;
    throw error;
  }

  if (progress.evaluatedCount < progress.candidateCount) {
    const error = new Error("All assigned students in this exam must be evaluated before publishing results.");
    error.statusCode = 400;
    throw error;
  }

  if (progress.pendingCaseDecisionCount > 0) {
    const error = new Error("Open integrity cases must have a proctor decision before results can be published.");
    error.statusCode = 400;
    throw error;
  }
}

function buildQuestionAutoEvaluation(question, answerMap) {
  const awardedMarks = scoreQuestion(question, answerMap);
  return {
    awardedMarks,
    autoMatched: awardedMarks === Number(question.marks || 0),
    autoScored: ["mcq", "msq"].includes(question.question_type)
  };
}

router.get(
  "/question-bank/questions",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "").trim().toLowerCase();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(24, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
    const offset = (page - 1) * limit;
    const values = [];
    let where = "";

    if (search) {
      values.push(`%${search}%`);
      where = `
        WHERE LOWER(COALESCE(q.metadata->>'courseCode', '')) LIKE $1
           OR LOWER(q.prompt) LIKE $1
           OR LOWER(COALESCE(qb.title, '')) LIKE $1
      `;
    }

    values.push(limit, offset);

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM question q
        LEFT JOIN question_bank qb ON qb.id = q.bank_id
        ${where}
      `,
      search ? [values[0]] : []
    );

    const result = await pool.query(
      `
        SELECT
          q.id,
          q.question_type,
          q.prompt,
          q.options,
          q.correct_answer,
          q.default_marks,
          q.metadata,
          qb.title AS bank_title
        FROM question q
        LEFT JOIN question_bank qb ON qb.id = q.bank_id
        ${where}
        ORDER BY LOWER(COALESCE(q.metadata->>'courseCode', '')), LOWER(q.prompt)
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values
    );

    const total = Number(countResult.rows[0]?.total || 0);

    res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        questionType: row.question_type,
        prompt: row.prompt,
        options: row.options || [],
        correctAnswer: row.correct_answer,
        marks: Number(row.default_marks || 0),
        courseCodeTag: row.metadata?.courseCode || "",
        bankTitle: row.bank_title || "Question Bank"
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  })
);

async function ensureAbsentCandidatesEvaluated(client, { examId }) {
  const examMeta = await client.query(
    `
      SELECT id, title, course_code, rules, created_by, end_at
      FROM exam
      WHERE id = $1
    `,
    [examId]
  );

  if (!examMeta.rows.length) {
    return [];
  }

  const exam = examMeta.rows[0];
  if (new Date(exam.end_at).getTime() > Date.now()) {
    return [];
  }

  const questions = await client.query(
    `
      SELECT COALESCE(eq.marks_override, eq.default_marks_snapshot, q.default_marks) AS marks
      FROM exam_question eq
      LEFT JOIN question q ON q.id = eq.question_id
      WHERE eq.exam_id = $1
    `,
    [examId]
  );
  const totalMarks = questions.rows.reduce((sum, row) => sum + Number(row.marks || 0), 0);

  const absentees = await client.query(
    `
      SELECT
        ec.student_id,
        ec.attempt_no,
        ec.suspicion_score,
        COALESCE(vcs.case_status::text, 'not_opened') AS case_status
      FROM exam_candidate ec
      LEFT JOIN answer_submission s
        ON s.exam_id = ec.exam_id
       AND s.student_id = ec.student_id
       AND s.attempt_no = ec.attempt_no
      LEFT JOIN result r
        ON r.exam_id = ec.exam_id
       AND r.student_id = ec.student_id
      LEFT JOIN v_candidate_integrity_summary vcs
        ON vcs.exam_id = ec.exam_id
       AND vcs.student_id = ec.student_id
       AND vcs.attempt_no = ec.attempt_no
      WHERE ec.exam_id = $1
        AND ec.started_at IS NULL
        AND ec.submitted_at IS NULL
        AND (s.final_answers IS NULL)
        AND r.id IS NULL
    `,
    [examId]
  );

  const generated = [];

  for (const absentee of absentees.rows) {
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
          status,
          storage_metadata
        )
        VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, 0, $4, 'submitted', $5::jsonb)
        ON CONFLICT (exam_id, student_id, attempt_no)
        DO UPDATE SET
          final_answers = COALESCE(answer_submission.final_answers, '{}'::jsonb),
          final_submitted_at = COALESCE(answer_submission.final_submitted_at, EXCLUDED.final_submitted_at),
          status = 'submitted',
          storage_metadata = answer_submission.storage_metadata || EXCLUDED.storage_metadata,
          updated_at = NOW()
        RETURNING *
      `,
      [
        examId,
        absentee.student_id,
        absentee.attempt_no,
        exam.end_at,
        JSON.stringify({
          systemGenerated: "not_appeared",
          autoReason: "deadline_passed_without_attempt"
        })
      ]
    );

    await client.query(
      `
        INSERT INTO evaluation (submission_id, evaluator_id, awarded_marks, feedback, rubric_breakdown, evaluated_at)
        VALUES ($1, $2, 0, $3, $4::jsonb, NOW())
        ON CONFLICT (submission_id)
        DO UPDATE SET
          evaluator_id = EXCLUDED.evaluator_id,
          awarded_marks = 0,
          feedback = EXCLUDED.feedback,
          rubric_breakdown = EXCLUDED.rubric_breakdown,
          evaluated_at = NOW()
      `,
      [
        submissionResult.rows[0].id,
        exam.created_by,
        "Auto-evaluated as not appeared after the exam deadline passed.",
        JSON.stringify({
          autoGenerated: "not_appeared",
          rawScore: 0,
          penalty: 0
        })
      ]
    );

    const result = await client.query(
      `
        INSERT INTO result (
          exam_id, student_id, submission_id, total_marks, awarded_marks,
          integrity_score, case_status, submission_hash_verified, status
        ) VALUES ($1, $2, $3, $4, 0, $5, $6::case_status, FALSE, 'draft')
        ON CONFLICT (submission_id)
        DO UPDATE SET
          total_marks = EXCLUDED.total_marks,
          awarded_marks = 0,
          integrity_score = EXCLUDED.integrity_score,
          case_status = EXCLUDED.case_status,
          submission_hash_verified = FALSE,
          status = 'draft'
        RETURNING *
      `,
      [
        examId,
        absentee.student_id,
        submissionResult.rows[0].id,
        totalMarks,
        absentee.suspicion_score,
        normalizeResultCaseStatus(absentee.case_status)
      ]
    );

    await client.query(
      `
        UPDATE exam_candidate
        SET status = 'graded'
        WHERE exam_id = $1
          AND student_id = $2
          AND attempt_no = $3
      `,
      [examId, absentee.student_id, absentee.attempt_no]
    );

    await writeAuditLog(client, {
      actorUserId: exam.created_by,
      actorRole: "admin",
      action: "student_marked_not_appeared",
      entityType: "result",
      entityId: result.rows[0].id,
      ipAddress: null,
      details: {
        examId,
        studentId: absentee.student_id,
        attemptNo: absentee.attempt_no
      }
    });

    generated.push(result.rows[0]);
  }

  return generated;
}

async function buildEvaluatedResults(client, { examId, actorId, actorRole, ipAddress }) {
  const examMeta = await client.query(`SELECT id, title, course_code, rules FROM exam WHERE id = $1`, [examId]);
  if (!examMeta.rows.length) {
    const error = new Error("Exam not found.");
    error.statusCode = 404;
    throw error;
  }

  await ensureAbsentCandidatesEvaluated(client, { examId });

  const questions = await client.query(
    `
      SELECT
        eq.question_id AS id,
        COALESCE(eq.question_type_snapshot, q.question_type) AS question_type,
        COALESCE(eq.correct_answer_snapshot, q.correct_answer) AS correct_answer,
        COALESCE(eq.marks_override, eq.default_marks_snapshot, q.default_marks) AS marks
        FROM exam_question eq
        LEFT JOIN question q ON q.id = eq.question_id
       WHERE eq.exam_id = $1
    `,
    [examId]
  );

  const submissions = await client.query(
    `
      SELECT s.id AS submission_id, s.exam_id, s.student_id, s.final_answers, s.storage_metadata, ec.suspicion_score,
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
    const forceZeroMarks = ["not_appeared", "closed_attempt"].includes(String(submission.storage_metadata?.systemGenerated || ""));
    const rawScore = forceZeroMarks ? 0 : questions.rows.reduce((sum, question) => sum + scoreQuestion(question, answers), 0);
    const penalty = forceZeroMarks ? 0 : calculatePenalty(submission.suspicion_score, examMeta.rows[0].rules || {});
    const awardedMarks = forceZeroMarks ? 0 : Math.max(0, Number((rawScore - penalty).toFixed(2)));
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
        forceZeroMarks
          ? "Auto-evaluated as 0 marks because the student did not complete the exam attempt."
          : "Auto-evaluated from configured answer key and integrity rules.",
        JSON.stringify({
          rawScore,
          penalty,
          autoGenerated: submission.storage_metadata?.systemGenerated || null
        })
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
    const overdueExamIds = await pool.query(
      `
        SELECT DISTINCT e.id
        FROM exam e
        JOIN exam_candidate ec ON ec.exam_id = e.id
        WHERE ec.student_id = $1
          AND e.end_at <= NOW()
      `,
      [req.params.studentId]
    );

    for (const row of overdueExamIds.rows) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await ensureAbsentCandidatesEvaluated(client, { examId: row.id });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

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
          CASE
            WHEN s.storage_metadata->>'systemGenerated' = 'not_appeared' THEN 'not_appeared'
            ELSE ec.status::text
          END AS candidate_status,
          ec.suspicion_score,
          ec.suspicion_score AS integrity_score,
          COALESCE(vcs.case_status::text, 'not_opened') AS case_status,
          COALESCE(vcs.submission_hash_verified, FALSE) AS submission_hash_verified
        FROM exam_candidate ec
        JOIN exam e ON e.id = ec.exam_id
        LEFT JOIN answer_submission s ON s.exam_id = ec.exam_id AND s.student_id = ec.student_id AND s.attempt_no = ec.attempt_no
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
    const client = await pool.connect();

    try {
      const result = await client.query(
      `
        SELECT
          ec.student_id,
          u.full_name,
          u.email,
          u.email_verified,
          u.is_active,
          ec.attempt_no,
          CASE
            WHEN s.storage_metadata->>'systemGenerated' = 'not_appeared' THEN 'not_appeared'
            WHEN s.storage_metadata->>'systemGenerated' = 'closed_attempt' THEN 'closed'
            WHEN ec.started_at IS NOT NULL AND ec.submitted_at IS NULL THEN 'attempted'
            ELSE ec.status::text
          END AS candidate_status,
          ec.started_at,
          ec.submitted_at,
          ec.suspicion_score,
          COALESCE(r.awarded_marks, NULL) AS awarded_marks,
          COALESCE(r.percentage, NULL) AS percentage
        FROM exam_candidate ec
        JOIN app_user u ON u.id = ec.student_id
        LEFT JOIN answer_submission s ON s.exam_id = ec.exam_id AND s.student_id = ec.student_id AND s.attempt_no = ec.attempt_no
        LEFT JOIN result r ON r.exam_id = ec.exam_id AND r.student_id = ec.student_id AND r.submission_id = s.id
        WHERE ec.exam_id = $1
        ORDER BY u.full_name ASC
      `,
      [req.params.examId]
      );
      const latestRequests = await getLatestReassignRequestsByExam(client, req.params.examId);
      const requestByCandidate = new Map(latestRequests.map((request) => [`${request.studentId}:${request.attemptNo}`, request]));

      res.json({
        items: result.rows.map((item) => ({
          id: item.student_id,
          fullName: item.full_name,
          email: item.email,
          emailVerified: item.email_verified,
          isActive: item.is_active,
          attemptNo: item.attempt_no,
          status: item.candidate_status,
          startedAt: item.started_at,
          submittedAt: item.submitted_at,
          suspicionScore: item.suspicion_score,
          awardedMarks: item.awarded_marks,
          percentage: item.percentage,
          reassignRequest: requestByCandidate.get(`${item.student_id}:${item.attempt_no}`) || null
        }))
      });
    } finally {
      client.release();
    }
  })
);

router.get(
  "/:examId/paper",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const requestedStudentId = req.query.studentId;
    const studentId = req.user.role === "student" ? req.user.id : requestedStudentId;
    const isStudentAccess = req.user.role === "student";

    if (!studentId) {
      return res.status(400).json({ message: "studentId is required." });
    }
    if (req.user.role === "student" && requestedStudentId && String(requestedStudentId) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only access your own assigned exam paper." });
    }
    if (req.user.role !== "student" && !["admin", "auditor"].includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have access to this action." });
    }

    const client = await pool.connect();

    try {
      if (isStudentAccess) {
        await client.query("BEGIN");
      }

      const examResult = await client.query(
        `
          SELECT e.id, e.title, e.description, e.course_code, e.start_at, e.end_at, e.duration_minutes, e.rules,
                 ec.attempt_no, ec.status AS candidate_status, ec.started_at, ec.submitted_at
            FROM exam e
            JOIN exam_candidate ec ON ec.exam_id = e.id
           WHERE e.id = $1 AND ec.student_id = $2
        `,
        [examId, studentId]
      );

      if (!examResult.rows.length) {
        if (isStudentAccess) {
          await client.query("ROLLBACK");
        }
        return res.status(404).json({ message: "Assigned exam not found for this student." });
      }

      const examRow = examResult.rows[0];
      let effectiveStartedAt = examRow.started_at;

      if (isStudentAccess) {
        const now = new Date();
        const startAt = new Date(examRow.start_at);
        const endAt = new Date(examRow.end_at);

        if (now < startAt) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "This exam has not started yet." });
        }

        if (examRow.candidate_status === "closed") {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "This exam attempt was closed and cannot be restarted." });
        }
        if (examRow.submitted_at || examRow.candidate_status === "submitted") {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "This exam attempt has already been submitted." });
        }

        if (now > endAt) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "The exam window has already closed." });
        }

        if (!effectiveStartedAt) {
          const started = await client.query(
            `
              UPDATE exam_candidate
              SET started_at = NOW(),
                  status = 'in_progress'
              WHERE exam_id = $1
                AND student_id = $2
                AND attempt_no = $3
              RETURNING started_at, status
            `,
            [examId, studentId, examRow.attempt_no]
          );
          effectiveStartedAt = started.rows[0]?.started_at || now.toISOString();
          examRow.candidate_status = started.rows[0]?.status || "in_progress";

          await writeAuditLog(client, {
            actorUserId: req.user.id,
            actorRole: req.user.role,
            action: "exam_window_started",
            entityType: "exam",
            entityId: examId,
            ipAddress: req.ip,
            details: { attemptNo: examRow.attempt_no, studentId }
          });
        }

        const durationMs = Number(examRow.duration_minutes || 0) * 60 * 1000;
        const calculatedEnd = new Date(new Date(effectiveStartedAt).getTime() + durationMs);
        if (calculatedEnd <= now) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "The time limit for this exam attempt has already passed." });
        }

        await client.query("COMMIT");
      }

      const questionResult = await client.query(
        `
          SELECT
            eq.question_id AS id,
            COALESCE(eq.question_type_snapshot, q.question_type) AS question_type,
            COALESCE(eq.prompt_snapshot, q.prompt) AS prompt,
            COALESCE(eq.options_snapshot, q.options, '[]'::jsonb) AS options,
            COALESCE(eq.marks_override, eq.default_marks_snapshot, q.default_marks) AS marks,
            eq.sequence_no
            FROM exam_question eq
            LEFT JOIN question q ON q.id = eq.question_id
           WHERE eq.exam_id = $1
           ORDER BY eq.sequence_no ASC
        `,
        [examId]
      );

      const durationMs = Number(examRow.duration_minutes || 0) * 60 * 1000;
      const startedAt = effectiveStartedAt || examRow.started_at;
      const effectiveEndAt = startedAt
        ? new Date(Math.min(new Date(examRow.end_at).getTime(), new Date(startedAt).getTime() + durationMs)).toISOString()
        : examRow.end_at;

      res.json({
        exam: {
          ...examRow,
          started_at: startedAt,
          effective_end_at: effectiveEndAt
        },
        questions: questionResult.rows
      });
    } catch (error) {
      if (isStudentAccess) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Ignore rollback failures after commit.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/",
  requireAuth,
  requireRole("admin", "proctor", "evaluator", "auditor"),
  asyncHandler(async (req, res) => {
    const overdueExamIds = await pool.query(
      `
        SELECT DISTINCT id
        FROM exam
        WHERE end_at <= NOW()
      `
    );

    for (const row of overdueExamIds.rows) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await ensureAbsentCandidatesEvaluated(client, { examId: row.id });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    await ensurePublishApprovalSchema();
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
          latest_publish_request.status AS publish_approval_status,
          latest_publish_request.approved_at AS publish_approved_at,
          CASE
            WHEN COUNT(DISTINCT CASE WHEN r.status = 'published' THEN r.student_id END) > 0 THEN 'published'
            WHEN COUNT(DISTINCT ec.student_id) = 0 THEN 'waiting_for_submissions'
            WHEN COUNT(DISTINCT s.student_id) < COUNT(DISTINCT ec.student_id) THEN 'waiting_for_submissions'
            WHEN COUNT(DISTINCT CASE WHEN r.status = 'draft' THEN r.student_id END) < COUNT(DISTINCT ec.student_id) THEN 'waiting_for_evaluation'
            WHEN COALESCE(cp.pending_case_decision_count, 0) > 0 THEN 'waiting_for_proctor_decision'
            WHEN latest_publish_request.status = 'pending' THEN 'waiting_for_admin_approval'
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
        LEFT JOIN LATERAL (
          SELECT status, approved_at
          FROM result_publish_request rpr
          WHERE rpr.exam_id = e.id
          ORDER BY rpr.created_at DESC
          LIMIT 1
        ) latest_publish_request ON TRUE
        ${where}
        GROUP BY e.id, creator.full_name, cp.opened_case_count, cp.pending_case_decision_count, latest_publish_request.status, latest_publish_request.approved_at
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
              JSON.stringify({
                authoredIn: item.sourceQuestionId ? "question_bank_reused" : "admin_ui",
                courseCode: item.courseCodeTag || courseCode
              })
            ]
          );

          await client.query(
              `
                INSERT INTO exam_question (
                  exam_id, question_id, sequence_no, marks_override,
                  question_type_snapshot, prompt_snapshot, options_snapshot,
                  correct_answer_snapshot, default_marks_snapshot, metadata_snapshot
                ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb)
              `,
              [
                exam.id,
                questionResult.rows[0].id,
                index + 1,
                Number(item.marks || 1),
                item.questionType,
                item.prompt,
                JSON.stringify(item.options || []),
                JSON.stringify(item.correctAnswer),
                Number(item.marks || 1),
                JSON.stringify({
                  authoredIn: item.sourceQuestionId ? "question_bank_reused" : "admin_ui",
                  courseCode: item.courseCodeTag || courseCode
                })
              ]
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
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await ensureAbsentCandidatesEvaluated(client, { examId });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

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
        SELECT
          eq.question_id AS id,
          COALESCE(eq.question_type_snapshot, q.question_type) AS question_type,
          COALESCE(eq.prompt_snapshot, q.prompt) AS prompt,
          COALESCE(eq.options_snapshot, q.options, '[]'::jsonb) AS options,
          COALESCE(eq.correct_answer_snapshot, q.correct_answer) AS correct_answer,
          COALESCE(eq.marks_override, eq.default_marks_snapshot, q.default_marks) AS marks,
          eq.sequence_no
        FROM exam_question eq
        LEFT JOIN question q ON q.id = eq.question_id
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
          s.storage_metadata,
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
      const answers = questions.rows.map((question) => {
        const autoEvaluation = buildQuestionAutoEvaluation(question, finalAnswers);
        return {
          questionId: question.id,
          sequenceNo: question.sequence_no,
          prompt: question.prompt,
          questionType: question.question_type,
          options: question.options,
          correctAnswer: question.correct_answer,
          maxMarks: Number(question.marks),
          studentAnswer: finalAnswers[question.id] ?? (question.question_type === "msq" ? [] : ""),
          autoAwardedMarks: autoEvaluation.awardedMarks,
          autoMatched: autoEvaluation.autoMatched,
          autoScored: autoEvaluation.autoScored
        };
      });
      const autoAwardedMarks = answers.reduce((sum, answer) => sum + Number(answer.autoAwardedMarks || 0), 0);
      const overrideComment = submission.rubric_breakdown?.overrideComment || "";
      const autoGeneratedReason = submission.storage_metadata?.systemGenerated || null;
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
        autoAwardedMarks,
        feedback: submission.feedback || "",
        rubricBreakdown: submission.rubric_breakdown || {},
        overrideComment,
        evaluatedAt: submission.evaluated_at,
        didNotAppear: autoGeneratedReason === "not_appeared",
        autoEvaluated: ["not_appeared", "closed_attempt"].includes(autoGeneratedReason),
        autoGeneratedReason,
        totalMarks,
        answers
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
    const { awardedMarks, feedback = "", rubricBreakdown = {}, overrideComment = "" } = req.body;
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
            s.storage_metadata,
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

      const existingEvaluation = await client.query(
        `
          SELECT id
          FROM evaluation
          WHERE submission_id = $1
        `,
        [submissionId]
      );

      if (existingEvaluation.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Marks for this submission have already been saved and are now locked." });
      }

      const marksMeta = await client.query(
        `
          SELECT
            eq.question_id AS id,
            COALESCE(eq.question_type_snapshot, q.question_type) AS question_type,
            COALESCE(eq.correct_answer_snapshot, q.correct_answer) AS correct_answer,
            COALESCE(eq.marks_override, eq.default_marks_snapshot, q.default_marks) AS marks,
            s.final_answers
          FROM exam_question eq
          LEFT JOIN question q ON q.id = eq.question_id
          JOIN answer_submission s ON s.id = $2
          WHERE eq.exam_id = $1
        `,
        [examId, submissionId]
      );

      const totalMarks = marksMeta.rows.reduce((sum, row) => sum + Number(row.marks || 0), 0);
      const parsedAwardedMarks = Number(awardedMarks);
      const finalAnswers = marksMeta.rows[0]?.final_answers || {};
      const autoAwardedMarks = marksMeta.rows.reduce(
        (sum, row) => sum + buildQuestionAutoEvaluation(row, finalAnswers).awardedMarks,
        0
      );
      const autoGeneratedReason = String(submissionMeta.rows[0].storage_metadata?.systemGenerated || "");
      const normalizedOverrideComment = String(overrideComment || "").trim();

      if (["not_appeared", "closed_attempt"].includes(autoGeneratedReason)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Auto-evaluated attempts are frozen and cannot be changed by the evaluator." });
      }

      if (!Number.isFinite(parsedAwardedMarks) || parsedAwardedMarks < 0 || parsedAwardedMarks > totalMarks) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: `awardedMarks must be between 0 and ${totalMarks}.` });
      }
      if (Number(parsedAwardedMarks.toFixed(2)) !== Number(autoAwardedMarks.toFixed(2)) && !normalizedOverrideComment) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "A comment is required whenever the evaluator changes the auto-calculated total." });
      }

      const verifiedResult = await client.query(`SELECT verify_submission_hash($1::uuid) AS verified`, [submissionId]);
      const submissionHashVerified = verifiedResult.rows[0].verified;
      const finalRubricBreakdown = {
        ...(rubricBreakdown || {}),
        autoAwardedMarks,
        overrideComment: normalizedOverrideComment,
        manualOverrideApplied: Number(parsedAwardedMarks.toFixed(2)) !== Number(autoAwardedMarks.toFixed(2))
      };

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
        [submissionId, evaluatorId, parsedAwardedMarks, feedback, JSON.stringify(finalRubricBreakdown)]
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
        details: {
          examId,
          awardedMarks: parsedAwardedMarks,
          autoAwardedMarks,
          manualOverrideApplied: finalRubricBreakdown.manualOverrideApplied
        }
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

router.get(
  "/:examId/reassign-requests",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const client = await pool.connect();

    try {
      const candidates = await client.query(
        `
          SELECT
            ec.student_id,
            u.full_name,
            u.email,
            ec.attempt_no,
            CASE
              WHEN s.storage_metadata->>'systemGenerated' = 'not_appeared' THEN 'not_appeared'
              WHEN s.storage_metadata->>'systemGenerated' = 'closed_attempt' THEN 'closed'
              WHEN ec.started_at IS NOT NULL AND ec.submitted_at IS NULL THEN 'attempted'
              ELSE ec.status::text
            END AS candidate_status,
            ec.started_at,
            ec.submitted_at,
            COALESCE(r.awarded_marks, NULL) AS awarded_marks,
            COALESCE(r.percentage, NULL) AS percentage
          FROM exam_candidate ec
          JOIN app_user u ON u.id = ec.student_id
          LEFT JOIN answer_submission s ON s.exam_id = ec.exam_id AND s.student_id = ec.student_id AND s.attempt_no = ec.attempt_no
          LEFT JOIN result r ON r.exam_id = ec.exam_id AND r.student_id = ec.student_id AND r.submission_id = s.id
          WHERE ec.exam_id = $1
          ORDER BY u.full_name ASC
        `,
        [examId]
      );

      const requests = await getLatestReassignRequestsByExam(client, examId);
      const requestByCandidate = new Map(requests.map((request) => [`${request.studentId}:${request.attemptNo}`, request]));

      res.json({
        items: candidates.rows.map((item) => ({
          studentId: item.student_id,
          studentName: item.full_name,
          studentEmail: item.email,
          attemptNo: item.attempt_no,
          status: item.candidate_status,
          startedAt: item.started_at,
          submittedAt: item.submitted_at,
          awardedMarks: item.awarded_marks,
          percentage: item.percentage,
          reassignRequest: requestByCandidate.get(`${item.student_id}:${item.attempt_no}`) || null
        }))
      });
    } finally {
      client.release();
    }
  })
);

router.post(
  "/:examId/reassign-requests",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const { studentId, attemptNo = 1, note = "" } = req.body;
    const requesterId = req.user.id;
    const client = await pool.connect();

    if (!studentId) {
      return res.status(400).json({ message: "studentId is required." });
    }

    try {
      await client.query("BEGIN");
      await ensureReassignApprovalSchema();

      const candidate = await client.query(
        `
          SELECT
            ec.exam_id,
            ec.student_id,
            ec.attempt_no,
            CASE
              WHEN s.storage_metadata->>'systemGenerated' = 'not_appeared' THEN 'not_appeared'
              WHEN s.storage_metadata->>'systemGenerated' = 'closed_attempt' THEN 'closed'
              WHEN ec.started_at IS NOT NULL AND ec.submitted_at IS NULL THEN 'attempted'
              ELSE ec.status::text
            END AS candidate_status
          FROM exam_candidate ec
          LEFT JOIN answer_submission s ON s.exam_id = ec.exam_id AND s.student_id = ec.student_id AND s.attempt_no = ec.attempt_no
          WHERE ec.exam_id = $1 AND ec.student_id = $2 AND ec.attempt_no = $3
        `,
        [examId, studentId, attemptNo]
      );

      if (!candidate.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Assigned exam attempt not found for this student." });
      }

      if (!["attempted", "closed", "submitted", "graded", "not_appeared"].includes(candidate.rows[0].candidate_status)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Only attempted, closed, submitted, evaluated, or not appeared attempts can be sent for reassignment approval." });
      }

      const existingPending = await client.query(
        `
          SELECT id
          FROM exam_reassign_request
          WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3 AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [examId, studentId, attemptNo]
      );

      if (existingPending.rows.length) {
        await client.query("COMMIT");
        return res.json({ message: "A proctor approval request is already pending for this student attempt.", requestId: existingPending.rows[0].id });
      }

      const requestResult = await client.query(
        `
          INSERT INTO exam_reassign_request (exam_id, student_id, attempt_no, requested_by, status, admin_note)
          VALUES ($1, $2, $3, $4, 'pending', $5)
          RETURNING id
        `,
        [examId, studentId, attemptNo, requesterId, note.trim() || null]
      );

      await writeAuditLog(client, {
        actorUserId: requesterId,
        actorRole: req.user.role,
        action: "exam_reassign_requested",
        entityType: "exam",
        entityId: examId,
        ipAddress: req.ip,
        details: {
          requestId: requestResult.rows[0].id,
          studentId,
          attemptNo,
          note: note.trim() || null
        }
      });

      await client.query("COMMIT");
      res.status(201).json({
        message: "Reassign request sent to proctors for approval.",
        requestId: requestResult.rows[0].id
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
  "/reassign-requests/pending",
  requireAuth,
  requireRole("proctor"),
  asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
      const items = await getPendingReassignRequests(client);
      res.json({ items });
    } finally {
      client.release();
    }
  })
);

router.post(
  "/reassign-requests/:requestId/approve",
  requireAuth,
  requireRole("proctor"),
  asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const { note = "" } = req.body;
    const approverId = req.user.id;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await ensureReassignApprovalSchema();

      const requestResult = await client.query(
        `
          SELECT id, exam_id, student_id, attempt_no, requested_by, status
          FROM exam_reassign_request
          WHERE id = $1
          FOR UPDATE
        `,
        [requestId]
      );

      if (!requestResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Reassign request not found." });
      }

      const request = requestResult.rows[0];
      if (request.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This reassign request is no longer pending." });
      }

      const candidate = await client.query(
        `
          SELECT exam_id, student_id, attempt_no
          FROM exam_candidate
          WHERE exam_id = $1 AND student_id = $2 AND attempt_no = $3
          FOR UPDATE
        `,
        [request.exam_id, request.student_id, request.attempt_no]
      );

      if (!candidate.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "The exam attempt linked to this request no longer exists." });
      }

      await resetCandidateAttempt(client, {
        examId: request.exam_id,
        studentId: request.student_id,
        attemptNo: request.attempt_no
      });

      await client.query(
        `
          UPDATE exam_reassign_request
          SET status = 'completed',
              approved_by = $2,
              proctor_note = $3,
              approved_at = NOW(),
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [requestId, approverId, note.trim() || null]
      );

      await writeAuditLog(client, {
        actorUserId: approverId,
        actorRole: req.user.role,
        action: "exam_attempt_reassigned",
        entityType: "exam",
        entityId: request.exam_id,
        ipAddress: req.ip,
        details: {
          requestId,
          studentId: request.student_id,
          attemptNo: request.attempt_no,
          approvedBy: approverId,
          note: note.trim() || null
        }
      });

      await client.query("COMMIT");
      res.json({ message: "Reassign approved. The student can now start the same exam again." });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/:examId/publish-approval",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const client = await pool.connect();

    try {
      const readiness = await loadPublishReadiness(client, examId);
      const approval = await getLatestPublishRequest(client, examId);
      const currentRecipient = approval?.recipients.find((recipient) => String(recipient.adminId) === String(req.user.id)) || null;

      res.json({
        exam: readiness.exam,
        progress: readiness.progress,
        approval,
        canApprove: Boolean(
          approval &&
          approval.status === "pending" &&
          currentRecipient &&
          currentRecipient.status !== "approved" &&
          String(approval.requestedBy) !== String(req.user.id)
        ),
        canPublish: Boolean(
          approval &&
          approval.status === "approved" &&
          !approval.publishedAt
        )
      });
    } catch (error) {
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
  "/:examId/publish-approval",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const requesterId = req.user.id;
    const client = await pool.connect();
    let committed = false;

    try {
      await client.query("BEGIN");
      await ensurePublishApprovalSchema();

      const readiness = await loadPublishReadiness(client, examId);
      assertPublishReadiness(readiness);

      const admins = await client.query(
        `
          SELECT id, full_name, email
          FROM app_user
          WHERE role = 'admin' AND is_active = TRUE
          ORDER BY full_name ASC
        `
      );

      const recipients = admins.rows.filter((admin) => String(admin.id) !== String(requesterId));
      if (!recipients.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "At least one other active admin is required before requesting publish approval."
        });
      }

      const existing = await getLatestPublishRequest(client, examId);
      if (existing && ["pending", "approved"].includes(existing.status) && !existing.publishedAt) {
        await client.query("COMMIT");
        return res.json({
          approval: existing,
          message: existing.status === "approved"
            ? "A publish request is already approved for this exam. Results can now be published."
            : "A publish approval request is already pending for this exam."
        });
      }

      const requestResult = await client.query(
        `
          INSERT INTO result_publish_request (exam_id, requested_by, status)
          VALUES ($1, $2, 'pending')
          RETURNING id
        `,
        [examId, requesterId]
      );

      for (const recipient of recipients) {
        await client.query(
          `
            INSERT INTO result_publish_request_recipient (request_id, admin_id, status, notified_at)
            VALUES ($1, $2, 'notified', NOW())
          `,
          [requestResult.rows[0].id, recipient.id]
        );
      }

      await writeAuditLog(client, {
        actorUserId: requesterId,
        actorRole: req.user.role,
        action: "publish_approval_requested",
        entityType: "exam",
        entityId: examId,
        ipAddress: req.ip,
        details: { requestId: requestResult.rows[0].id, recipientCount: recipients.length }
      });

      await client.query("COMMIT");
      committed = true;

      const approval = await getLatestPublishRequest(client, examId);
      if (isMailConfigured()) {
        const approvalUrl = `${env.frontendUrl}/?role=admin`;
        await Promise.all(
          recipients.map((recipient) =>
            sendPublishApprovalEmail({
              toEmail: recipient.email,
              toName: recipient.full_name,
              examTitle: readiness.exam.title,
              courseCode: readiness.exam.course_code,
              requestedByName: req.user.fullName,
              approvalUrl
            }).catch(() => null)
          )
        );
      }

      res.status(201).json({
        approval,
        message: `Approval request sent to ${recipients.length} other admin(s).`,
        mailConfigured: isMailConfigured()
      });
    } catch (error) {
      if (!committed) {
        await client.query("ROLLBACK");
      }
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
  "/publish-approval/:requestId/approve",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const approverId = req.user.id;
    const client = await pool.connect();
    let committed = false;

    try {
      await client.query("BEGIN");
      await ensurePublishApprovalSchema();

      const requestResult = await client.query(
        `
          SELECT id, exam_id, requested_by, status, published_at
          FROM result_publish_request
          WHERE id = $1
        `,
        [requestId]
      );

      if (!requestResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Publish approval request not found." });
      }

      const request = requestResult.rows[0];
      if (String(request.requested_by) === String(approverId)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "The requesting admin cannot approve their own publish request." });
      }
      if (request.published_at || request.status === "published") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This publish request has already been used." });
      }
      if (request.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This publish request is no longer pending approval." });
      }

      const recipientResult = await client.query(
        `
          SELECT id, status
          FROM result_publish_request_recipient
          WHERE request_id = $1 AND admin_id = $2
        `,
        [requestId, approverId]
      );

      if (!recipientResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "This approval request was not sent to your admin account." });
      }

      await client.query(
        `
          UPDATE result_publish_request_recipient
          SET status = 'approved', responded_at = NOW()
          WHERE request_id = $1 AND admin_id = $2
        `,
        [requestId, approverId]
      );

      await client.query(
        `
          UPDATE result_publish_request
          SET status = 'approved',
              approved_by = $2,
              approved_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [requestId, approverId]
      );

      await writeAuditLog(client, {
        actorUserId: approverId,
        actorRole: req.user.role,
        action: "publish_approval_granted",
        entityType: "exam",
        entityId: request.exam_id,
        ipAddress: req.ip,
        details: { requestId }
      });

      await client.query("COMMIT");
      committed = true;

      const approval = await getLatestPublishRequest(client, request.exam_id);
      res.json({
        approval,
        message: "Publish approval recorded. Results can now be published."
      });
    } catch (error) {
      if (!committed) {
        await client.query("ROLLBACK");
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
    let committed = false;
    try {
      await client.query("BEGIN");
      const readiness = await loadPublishReadiness(client, examId);
      assertPublishReadiness(readiness);
      const candidateCount = readiness.progress.candidateCount;
      const latestApproval = await getLatestPublishRequest(client, examId);

      if (!latestApproval || latestApproval.status !== "approved" || latestApproval.publishedAt) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "Another admin must approve result publication before results can be published."
        });
      }

      const draftResults = await client.query(
        `
          SELECT r.id, r.exam_id, r.student_id, r.submission_id, r.total_marks, r.awarded_marks,
                 r.percentage, r.integrity_score,
                 COALESCE(latest_case.status::text, r.case_status::text) AS case_status,
                 r.submission_hash_verified,
                 u.email, u.full_name
          FROM result r
          JOIN app_user u ON u.id = r.student_id
          LEFT JOIN LATERAL (
            SELECT c.status
            FROM integrity_case c
            WHERE c.exam_id = r.exam_id
              AND c.student_id = r.student_id
            ORDER BY c.opened_at DESC
            LIMIT 1
          ) latest_case ON TRUE
          WHERE r.exam_id = $1 AND r.status = 'draft'
        `,
        [examId]
      );

      if (draftResults.rows.length < candidateCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "All assigned students in this exam must be evaluated before publishing results." });
      }

      const published = [];
      let hashFailuresCount = 0;
      let storedReportsCount = 0;
      for (const draft of draftResults.rows) {
        const verifiedResult = await client.query(`SELECT verify_submission_hash($1::uuid) AS verified`, [draft.submission_id]);
        const submissionHashVerified = Boolean(verifiedResult.rows[0]?.verified);
        if (!submissionHashVerified) {
          hashFailuresCount += 1;
        }

        const result = await client.query(
          `
            UPDATE result
               SET status = $5::result_status,
                   case_status = $3::case_status,
                   submission_hash_verified = $4,
                   published_by = $2,
                   published_at = NOW()
              WHERE id = $1
              RETURNING *
          `,
          [
            draft.id,
            publishedBy,
            normalizeResultCaseStatus(draft.case_status),
            submissionHashVerified,
            submissionHashVerified ? "published" : "withheld"
          ]
        );
        const outcome = buildPublishedResultOutcome(
          {
            ...draft,
            submission_hash_verified: submissionHashVerified
          },
          readiness.exam.integrity_threshold
        );
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
          submissionHashVerified
        };

        published.push(publishedItem);

        const storedReport = await createResultReportDocument(client, {
          exam: readiness.exam,
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
      await client.query(
        `
          UPDATE result_publish_request
          SET status = 'published',
              published_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [latestApproval.id]
      );
      await writeAuditLog(client, {
        actorUserId: publishedBy,
        actorRole: "admin",
        action: "results_published",
        entityType: "exam",
        entityId: examId,
        ipAddress: req.ip,
        details: {
          publishedCount: published.length,
          hashFailuresCount,
          requestId: latestApproval.id
        }
      });

      await client.query("COMMIT");
      committed = true;

      const emailIssues = [];
      if (isMailConfigured()) {
        for (const item of published) {
          try {
            await sendResultPublishedEmail({
              toEmail: item.email,
              toName: item.fullName,
              examTitle: readiness.exam.title,
              courseCode: readiness.exam.course_code,
              awardedMarks: item.awardedMarks,
              totalMarks: item.totalMarks,
              percentage: item.percentage,
              integrityScore: item.integrityScore,
              caseStatus: item.caseStatus,
              submissionHashVerified: item.submissionHashVerified,
              thresholdBreached: item.thresholdBreached,
              integrityThreshold: Number(readiness.exam.integrity_threshold || 0),
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
        hashFailuresCount,
        storedReportsCount
      });
    } catch (error) {
      if (!committed) {
        await client.query("ROLLBACK");
      }
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
