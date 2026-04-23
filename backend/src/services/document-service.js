const path = require("path");
const { writeAuditLog } = require("./audit-service");
const { isStorageConfigured, uploadBuffer, removeObject } = require("./storage-service");

function safeSegment(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || fallback;
}

function buildDocumentKey({ examId, studentId, documentType, originalName }) {
  const safeName = path.basename(originalName || "document").replace(/[^a-zA-Z0-9._-]/g, "-");
  const prefix = documentType === "result_report" ? "reports" : "integrity-evidence";
  return `${prefix}/${examId}/${studentId}/${Date.now()}-${safeName}`;
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function formatDetails(details) {
  if (!details || typeof details !== "object") return "none";
  const entries = Object.entries(details);
  if (!entries.length) return "none";
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" | ");
}

async function replaceStoredDocument(client, {
  examId,
  studentId,
  caseId = null,
  documentType,
  originalName,
  contentType,
  body,
  uploadedBy = null,
  actorRole = "system",
  ipAddress = null,
  metadata = {}
}) {
  if (!isStorageConfigured()) {
    return { stored: false, reason: "storage_not_configured" };
  }

  const objectKey = buildDocumentKey({
    examId,
    studentId,
    documentType,
    originalName
  });

  await uploadBuffer({
    key: objectKey,
    body,
    contentType,
    metadata: {
      examId,
      studentId,
      caseId,
      documentType,
      ...metadata
    }
  });

  let inserted = null;
  try {
    const existingResult = await client.query(
      `
        SELECT id, s3_key
        FROM stored_document
        WHERE exam_id = $1
          AND student_id = $2
          AND document_type = $3
          AND (
            ($4::uuid IS NULL AND case_id IS NULL)
            OR case_id = $4::uuid
          )
      `,
      [examId, studentId, documentType, caseId]
    );

    inserted = await client.query(
      `
        INSERT INTO stored_document (
          exam_id, student_id, case_id, document_type, s3_key, original_name, content_type, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [examId, studentId, caseId, documentType, objectKey, originalName, contentType, uploadedBy]
    );

    if (existingResult.rows.length) {
      await client.query(
        `
          DELETE FROM stored_document
          WHERE id = ANY($1::uuid[])
        `,
        [existingResult.rows.map((row) => row.id)]
      );

      for (const existing of existingResult.rows) {
        if (existing.s3_key && existing.s3_key !== objectKey) {
          await removeObject(existing.s3_key).catch(() => null);
        }
      }
    }

    await writeAuditLog(client, {
      actorUserId: uploadedBy,
      actorRole,
      action: "document_uploaded",
      entityType: "stored_document",
      entityId: inserted.rows[0].id,
      ipAddress,
      details: {
        examId,
        studentId,
        caseId,
        documentType,
        originalName,
        s3Key: objectKey,
        generatedAutomatically: true
      }
    });
  } catch (error) {
    await removeObject(objectKey).catch(() => null);
    throw error;
  }

  return {
    stored: true,
    item: inserted.rows[0]
  };
}

async function createResultReportDocument(client, {
  exam,
  student,
  result,
  uploadedBy,
  actorRole = "admin",
  ipAddress = null
}) {
  const fileName = `${safeSegment(exam.course_code, "exam")}-${safeSegment(student.fullName || student.email, "student")}-result-report.txt`;
  const lines = [
    "Exam Integrity System - Result Report",
    "",
    `Exam Title: ${exam.title}`,
    `Course Code: ${exam.course_code}`,
    `Student Name: ${student.fullName}`,
    `Student Email: ${student.email}`,
    `Published At: ${formatDateTime(result.publishedAt || new Date().toISOString())}`,
    "",
    `Awarded Marks: ${result.awardedMarks}/${result.totalMarks}`,
    `Percentage: ${result.percentage}%`,
    `Integrity Score: ${result.integrityScore}`,
    `Integrity Threshold: ${exam.integrity_threshold}`,
    `Case Status: ${result.caseStatus || "not_opened"}`,
    `Submission Hash Verified: ${result.submissionHashVerified ? "Yes" : "No"}`,
    `Result Outcome: ${result.resultOutcome}`,
    ""
  ];

  if (result.thresholdBreached) {
    lines.push("Important Note: This student crossed the integrity threshold and the result outcome reflects that decision.");
    lines.push("");
  }

  if (result.submissionHashVerified === false) {
    lines.push("Important Note: This result has been withheld because the submitted answers could not be hash-verified.");
    lines.push("Please contact the proctor or admin for review.");
    lines.push("");
  }

  lines.push("This report was generated automatically when results were published.");

  return replaceStoredDocument(client, {
    examId: exam.id,
    studentId: student.id,
    documentType: "result_report",
    originalName: fileName,
    contentType: "text/plain; charset=utf-8",
    body: Buffer.from(lines.join("\n"), "utf8"),
    uploadedBy,
    actorRole,
    ipAddress,
    metadata: {
      courseCode: exam.course_code,
      resultOutcome: result.resultOutcome
    }
  });
}

async function createIntegrityEvidenceDocument(client, {
  caseRecord,
  exam,
  student,
  events = [],
  uploadedBy,
  actorRole = "proctor",
  ipAddress = null
}) {
  const fileName = `${safeSegment(exam.course_code, "exam")}-${safeSegment(student.fullName || student.email, "student")}-integrity-evidence.txt`;
  const lines = [
    "Exam Integrity System - Integrity Evidence Report",
    "",
    `Case ID: ${caseRecord.id}`,
    `Exam Title: ${exam.title}`,
    `Course Code: ${exam.course_code}`,
    `Student Name: ${student.fullName}`,
    `Student Email: ${student.email}`,
    `Attempt No: ${caseRecord.attempt_no}`,
    `Opened At: ${formatDateTime(caseRecord.opened_at)}`,
    `Closed At: ${formatDateTime(caseRecord.closed_at)}`,
    `Current Score: ${caseRecord.current_score}`,
    `Threshold At Open: ${caseRecord.threshold_at_open}`,
    `Workflow Status: ${caseRecord.status}`,
    `Decision: ${caseRecord.decision || "pending"}`,
    `Decision Notes: ${caseRecord.decision_notes || "none"}`,
    `Summary: ${caseRecord.summary || "none"}`,
    "",
    "Suspicious Events"
  ];

  if (!events.length) {
    lines.push("No suspicious events were attached to this case.");
  } else {
    for (const [index, event] of events.entries()) {
      lines.push("");
      lines.push(`Event ${index + 1}`);
      lines.push(`Type: ${event.event_type}`);
      lines.push(`Time: ${formatDateTime(event.event_time)}`);
      lines.push(`IP Address: ${event.ip_address || "unknown"}`);
      lines.push(`Device Fingerprint: ${event.device_fingerprint || "unknown"}`);
      lines.push(`Penalty Points: ${event.penalty_points === null || event.penalty_points === undefined ? "not assigned" : event.penalty_points}`);
      lines.push(`Penalty Note: ${event.penalty_note || "none"}`);
      lines.push(`Details: ${formatDetails(event.details)}`);
    }
  }

  lines.push("");
  lines.push("This evidence report was generated automatically when the proctor saved the case decision.");

  const stored = await replaceStoredDocument(client, {
    examId: exam.id,
    studentId: student.id,
    caseId: caseRecord.id,
    documentType: "integrity_evidence",
    originalName: fileName,
    contentType: "text/plain; charset=utf-8",
    body: Buffer.from(lines.join("\n"), "utf8"),
    uploadedBy,
    actorRole,
    ipAddress,
    metadata: {
      decision: caseRecord.decision || "pending",
      caseStatus: caseRecord.status
    }
  });

  if (stored.stored && stored.item) {
    await client.query(
      `
        DELETE FROM case_evidence
        WHERE case_id = $1
          AND evidence_type = 'integrity_report'
      `,
      [caseRecord.id]
    );

    await client.query(
      `
        INSERT INTO case_evidence (case_id, evidence_type, source_ref, payload, added_by)
        VALUES ($1, 'integrity_report', $2, $3::jsonb, $4)
      `,
      [
        caseRecord.id,
        stored.item.id,
        JSON.stringify({
          documentId: stored.item.id,
          s3Key: stored.item.s3_key,
          originalName: stored.item.original_name,
          documentType: stored.item.document_type
        }),
        uploadedBy
      ]
    );
  }

  return stored;
}

module.exports = {
  createResultReportDocument,
  createIntegrityEvidenceDocument
};
