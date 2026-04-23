BEGIN;

ALTER TABLE stored_document
    DROP CONSTRAINT IF EXISTS stored_document_document_type_check;

ALTER TABLE stored_document
    ADD CONSTRAINT stored_document_document_type_check
    CHECK (document_type IN ('result_report', 'integrity_evidence', 'screen_share_evidence'));

COMMIT;
