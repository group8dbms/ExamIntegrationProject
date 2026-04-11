CREATE TABLE IF NOT EXISTS stored_document (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID REFERENCES exam(id) ON DELETE CASCADE,
    student_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
    case_id UUID REFERENCES integrity_case(id) ON DELETE SET NULL,
    document_type TEXT NOT NULL,
    s3_key TEXT NOT NULL UNIQUE,
    original_name TEXT,
    content_type TEXT,
    uploaded_by UUID REFERENCES app_user(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stored_document_exam ON stored_document(exam_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stored_document_student ON stored_document(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stored_document_case ON stored_document(case_id, created_at DESC);
