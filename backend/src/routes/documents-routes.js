const path = require("path");
const express = require("express");
const multer = require("multer");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const env = require("../config/env");
const { writeAuditLog } = require("../services/audit-service");
const { isStorageConfigured, uploadBuffer, createDownloadUrl } = require("../services/storage-service");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const ALLOWED_DOCUMENT_TYPES = new Set(["result_report", "integrity_evidence"]);

function canAccessDocument(user, document) {
  if (["admin", "auditor"].includes(user.role)) return true;
  if (user.role === "proctor") return document.document_type === "integrity_evidence";
  if (user.role === "student") {
    return document.document_type === "result_report" && String(document.student_id) === String(user.id);
  }
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadSizeBytes }
});

function buildDocumentKey({ examId, studentId, documentType, originalName }) {
  const safeName = path.basename(originalName || "document").replace(/[^a-zA-Z0-9._-]/g, "-");
  const prefix = documentType === "result_report" ? "reports" : "integrity-evidence";
  return `${prefix}/${examId}/${studentId}/${Date.now()}-${safeName}`;
}

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examId, documentType } = req.query;
    const requestedStudentId = req.query.studentId;
    const values = [];
    const filters = [];

    if (examId) {
      values.push(examId);
      filters.push(`sd.exam_id = $${values.length}`);
    }

    if (requestedStudentId) {
      values.push(requestedStudentId);
      filters.push(`sd.student_id = $${values.length}`);
    }

    if (documentType) {
      values.push(documentType);
      filters.push(`sd.document_type = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query(
      `
        SELECT
          sd.id,
          sd.exam_id,
          sd.student_id,
          sd.case_id,
          sd.document_type,
          sd.s3_key,
          sd.original_name,
          sd.content_type,
          sd.created_at,
          uploader.full_name AS uploaded_by_name,
          student.full_name AS student_name,
          exam.title AS exam_title,
          exam.course_code
        FROM stored_document sd
        LEFT JOIN app_user uploader ON uploader.id = sd.uploaded_by
        LEFT JOIN app_user student ON student.id = sd.student_id
        LEFT JOIN exam ON exam.id = sd.exam_id
        ${where}
        ORDER BY sd.created_at DESC
      `,
      values
    );

    const filteredItems = result.rows.filter((item) => canAccessDocument(req.user, item));
    res.json({ items: filteredItems, storageConfigured: isStorageConfigured() });
  })
);

router.post(
  "/upload",
  requireAuth,
  requireRole("admin", "proctor"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!isStorageConfigured()) {
      return res.status(400).json({ message: "S3 storage is not configured yet on the backend." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "A file is required." });
    }

    const {
      examId = null,
      studentId = null,
      caseId = null,
      documentType = "result_report",
      actorRole = req.user.role
    } = req.body;
    const uploadedBy = req.user.id;

    if (!ALLOWED_DOCUMENT_TYPES.has(documentType)) {
      return res.status(400).json({ message: "documentType must be either result_report or integrity_evidence." });
    }

    if (!examId || !studentId) {
      return res.status(400).json({ message: "examId and studentId are required for stored documents." });
    }

    if (documentType === "integrity_evidence" && !caseId) {
      return res.status(400).json({ message: "caseId is required when uploading integrity_evidence." });
    }

    const objectKey = buildDocumentKey({
      examId,
      studentId,
      documentType,
      originalName: req.file.originalname
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await uploadBuffer({
        key: objectKey,
        body: req.file.buffer,
        contentType: req.file.mimetype,
        metadata: {
          examId,
          studentId,
          caseId,
          documentType
        }
      });

      const inserted = await client.query(
        `
          INSERT INTO stored_document (
            exam_id, student_id, case_id, document_type, s3_key, original_name, content_type, uploaded_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
        [examId, studentId, caseId, documentType, objectKey, req.file.originalname, req.file.mimetype, uploadedBy]
      );

      await writeAuditLog(client, {
        actorUserId: uploadedBy,
        actorRole,
        action: "document_uploaded",
        entityType: "stored_document",
        entityId: null,
        ipAddress: req.ip,
        details: {
          documentId: inserted.rows[0].id,
          examId,
          studentId,
          caseId,
          documentType,
          originalName: req.file.originalname,
          s3Key: objectKey
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
  "/:documentId/access-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isStorageConfigured()) {
      return res.status(400).json({ message: "S3 storage is not configured yet on the backend." });
    }

    const result = await pool.query(
      `
        SELECT id, s3_key, original_name, content_type
        FROM stored_document
        WHERE id = $1
      `,
      [req.params.documentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Document not found." });
    }

    const item = result.rows[0];
    const accessMeta = await pool.query(
      `
        SELECT id, student_id, document_type
        FROM stored_document
        WHERE id = $1
      `,
      [req.params.documentId]
    );
    if (!accessMeta.rows.length || !canAccessDocument(req.user, accessMeta.rows[0])) {
      return res.status(403).json({ message: "You do not have access to this document." });
    }
    const url = await createDownloadUrl(item.s3_key);
    res.json({
      id: item.id,
      originalName: item.original_name,
      contentType: item.content_type,
      url
    });
  })
);

module.exports = router;
