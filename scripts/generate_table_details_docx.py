from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED


TABLES = [
    {
        "name": "app_user",
        "purpose": "Stores all platform users including admins, instructors, students, proctors, evaluators, and auditors. It is the main identity table used across the system.",
        "attributes": [
            ("id", "UUID, primary key", "Unique identifier for each user."),
            ("email", "CITEXT, unique, not null", "Login email address stored case-insensitively."),
            ("full_name", "TEXT, not null", "Full name of the user."),
            ("role", "user_role enum, not null", "Role of the user such as admin, student, proctor, evaluator, or auditor."),
            ("password_hash", "TEXT", "Hashed password used for authentication."),
            ("is_active", "BOOLEAN, default TRUE", "Marks whether the account is active."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Timestamp when the account was created."),
            ("updated_at", "TIMESTAMPTZ, default NOW()", "Timestamp when the account was last updated."),
            ("email_verified", "BOOLEAN, default FALSE", "Shows whether the student email has been verified."),
            ("email_verification_token", "TEXT", "Token used in the email verification link."),
            ("verification_sent_at", "TIMESTAMPTZ", "Time when the last verification email was sent."),
            ("last_login_at", "TIMESTAMPTZ", "Stores the last successful login time."),
        ],
    },
    {
        "name": "user_session",
        "purpose": "Tracks login sessions of users and stores session-level information for audit and integrity checks.",
        "attributes": [
            ("id", "BIGSERIAL, primary key", "Unique session record identifier."),
            ("user_id", "UUID, foreign key -> app_user.id", "User who owns the session."),
            ("login_at", "TIMESTAMPTZ, default NOW()", "Time at which the session started."),
            ("logout_at", "TIMESTAMPTZ", "Time at which the session ended."),
            ("ip_address", "INET", "IP address used during the session."),
            ("device_fingerprint", "TEXT", "Fingerprint used to identify the device/browser."),
            ("user_agent", "TEXT", "Browser or client information."),
            ("session_token_hash", "TEXT, not null", "Hashed session token."),
            ("is_active", "BOOLEAN, default TRUE", "Shows whether the session is still active."),
        ],
    },
    {
        "name": "exam",
        "purpose": "Stores the master record for each exam, including timing, rules, integrity threshold, and creator information.",
        "attributes": [
            ("id", "UUID, primary key", "Unique exam identifier."),
            ("title", "TEXT, not null", "Title of the exam."),
            ("description", "TEXT", "Description or instructions for the exam."),
            ("course_code", "TEXT, not null", "Course code associated with the exam."),
            ("status", "exam_status enum, default 'draft'", "Lifecycle status of the exam."),
            ("start_at", "TIMESTAMPTZ, not null", "Scheduled exam start time."),
            ("end_at", "TIMESTAMPTZ, not null", "Scheduled exam end time."),
            ("duration_minutes", "INTEGER, not null", "Allowed exam duration in minutes."),
            ("integrity_threshold", "NUMERIC(6,2), default 10", "Threshold for opening or escalating integrity cases."),
            ("rules", "JSONB, default {}", "Flexible JSON field for exam-level rule settings."),
            ("created_by", "UUID, foreign key -> app_user.id", "User who created the exam."),
            ("published_at", "TIMESTAMPTZ", "Time at which results were published."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Time at which the exam record was created."),
            ("updated_at", "TIMESTAMPTZ, default NOW()", "Time at which the exam record was last updated."),
        ],
    },
    {
        "name": "question_bank",
        "purpose": "Groups questions into reusable banks so question sets can be organized before attaching them to exams.",
        "attributes": [
            ("id", "UUID, primary key", "Unique question bank identifier."),
            ("title", "TEXT, not null", "Name of the question bank."),
            ("description", "TEXT", "Optional description of the bank."),
            ("created_by", "UUID, foreign key -> app_user.id", "User who created the bank."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Creation timestamp."),
        ],
    },
    {
        "name": "question",
        "purpose": "Stores individual questions with answer options, correct answers, marks, and metadata.",
        "attributes": [
            ("id", "UUID, primary key", "Unique question identifier."),
            ("bank_id", "UUID, foreign key -> question_bank.id", "Question bank containing this question."),
            ("created_by", "UUID, foreign key -> app_user.id", "User who created the question."),
            ("question_type", "TEXT, not null", "Type of question such as MCQ or MSQ."),
            ("prompt", "TEXT, not null", "Question statement shown to the student."),
            ("options", "JSONB, default []", "List of answer options."),
            ("correct_answer", "JSONB", "Expected answer stored in JSON format."),
            ("default_marks", "NUMERIC(8,2), default 1", "Default marks assigned to the question."),
            ("metadata", "JSONB, default {}", "Extra structured metadata."),
            ("is_active", "BOOLEAN, default TRUE", "Shows whether the question is active."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Creation timestamp."),
        ],
    },
    {
        "name": "exam_question",
        "purpose": "Maps questions to an exam and defines their order, marks override, and whether each question is required.",
        "attributes": [
            ("exam_id", "UUID, foreign key -> exam.id", "Exam that contains the question."),
            ("question_id", "UUID, foreign key -> question.id", "Question included in the exam."),
            ("sequence_no", "INTEGER, not null", "Display order of the question in the exam."),
            ("marks_override", "NUMERIC(8,2)", "Optional marks value that overrides the default question marks."),
            ("is_required", "BOOLEAN, default TRUE", "Shows whether answering the question is mandatory."),
        ],
    },
    {
        "name": "exam_candidate",
        "purpose": "Represents a student's assignment to an exam attempt and stores the running state of that attempt.",
        "attributes": [
            ("exam_id", "UUID, foreign key -> exam.id", "Assigned exam."),
            ("student_id", "UUID, foreign key -> app_user.id", "Student assigned to the exam."),
            ("attempt_no", "INTEGER, default 1", "Attempt number for the student in the exam."),
            ("assigned_at", "TIMESTAMPTZ, default NOW()", "When the student was assigned."),
            ("started_at", "TIMESTAMPTZ", "When the student started the exam."),
            ("submitted_at", "TIMESTAMPTZ", "When the exam attempt was submitted."),
            ("status", "submission_status enum, default 'in_progress'", "Current state of the attempt."),
            ("suspicion_score", "NUMERIC(8,2), default 0", "Running integrity score for the candidate."),
            ("last_ip", "INET", "Last known IP address during the attempt."),
            ("last_device", "TEXT", "Last known device or fingerprint."),
        ],
    },
    {
        "name": "answer_submission",
        "purpose": "Stores autosaved and final answers for a student's exam attempt along with submission hashing data.",
        "attributes": [
            ("id", "UUID, primary key", "Unique submission identifier."),
            ("exam_id", "UUID", "Exam linked to the submission."),
            ("student_id", "UUID", "Student who made the submission."),
            ("attempt_no", "INTEGER, default 1", "Attempt number tied to the submission."),
            ("current_answers", "JSONB, default {}", "Latest autosaved answers."),
            ("final_answers", "JSONB", "Final submitted answers."),
            ("autosave_version", "INTEGER, default 0", "Autosave version counter."),
            ("final_submitted_at", "TIMESTAMPTZ", "Time when final submission was made."),
            ("status", "submission_status enum, default 'in_progress'", "Current submission state."),
            ("submission_hash", "TEXT", "SHA-256 or similar hash of the final submission."),
            ("hash_algorithm", "TEXT, default 'sha256'", "Algorithm used for hashing."),
            ("hash_verified", "BOOLEAN, default FALSE", "Whether the stored hash has been verified."),
            ("storage_metadata", "JSONB, default {}", "Extra storage or submission metadata."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Creation timestamp."),
            ("updated_at", "TIMESTAMPTZ, default NOW()", "Last update timestamp."),
        ],
    },
    {
        "name": "integrity_event",
        "purpose": "Logs suspicious actions or anomalies during an exam attempt, such as tab switching or IP changes.",
        "attributes": [
            ("id", "BIGSERIAL, primary key", "Unique event identifier."),
            ("exam_id", "UUID", "Exam related to the integrity event."),
            ("student_id", "UUID", "Student involved in the event."),
            ("attempt_no", "INTEGER, default 1", "Attempt number for the event."),
            ("session_id", "BIGINT, foreign key -> user_session.id", "Session linked to the event."),
            ("event_type", "integrity_event_type enum", "Type of suspicious event."),
            ("event_time", "TIMESTAMPTZ, default NOW()", "Timestamp of the event."),
            ("weight", "NUMERIC(8,2)", "Penalty weight or severity weight."),
            ("ip_address", "INET", "IP address captured for the event."),
            ("device_fingerprint", "TEXT", "Device fingerprint captured for the event."),
            ("details", "JSONB, default {}", "Extra structured event details."),
            ("created_by", "UUID, foreign key -> app_user.id", "User or system actor that recorded the event."),
        ],
    },
    {
        "name": "proctor_flag",
        "purpose": "Stores proctor-created flags against a candidate attempt when suspicious behavior is manually noticed.",
        "attributes": [
            ("id", "UUID, primary key", "Unique flag identifier."),
            ("exam_id", "UUID", "Exam linked to the flag."),
            ("student_id", "UUID", "Flagged student."),
            ("attempt_no", "INTEGER, default 1", "Attempt number."),
            ("flagged_by", "UUID, foreign key -> app_user.id", "Proctor who raised the flag."),
            ("severity", "SMALLINT, default 1", "Severity of the flag."),
            ("reason", "TEXT, not null", "Reason written by the proctor."),
            ("status", "TEXT, default 'open'", "Current status of the flag."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Creation timestamp."),
        ],
    },
    {
        "name": "integrity_case",
        "purpose": "Represents a formal case opened for a student when integrity thresholds are crossed or serious issues are found.",
        "attributes": [
            ("id", "UUID, primary key", "Unique case identifier."),
            ("exam_id", "UUID", "Exam linked to the case."),
            ("student_id", "UUID", "Student linked to the case."),
            ("attempt_no", "INTEGER, default 1", "Attempt number tied to the case."),
            ("opened_at", "TIMESTAMPTZ, default NOW()", "Time when the case was opened."),
            ("opened_by", "UUID, foreign key -> app_user.id", "User who opened the case."),
            ("status", "case_status enum, default 'open'", "Current workflow status of the case."),
            ("current_score", "NUMERIC(8,2)", "Suspicion or integrity score when the case was recorded."),
            ("threshold_at_open", "NUMERIC(8,2)", "Threshold value that applied when the case was opened."),
            ("summary", "TEXT", "Summary of the issue."),
            ("decision", "decision_type enum", "Final decision taken on the case."),
            ("decision_notes", "TEXT", "Notes about the decision."),
            ("closed_at", "TIMESTAMPTZ", "Time when the case was closed."),
            ("resolved_by", "UUID, foreign key -> app_user.id", "User who resolved the case."),
        ],
    },
    {
        "name": "case_evidence",
        "purpose": "Stores evidence items attached to an integrity case, such as generated integrity reports or structured payloads.",
        "attributes": [
            ("id", "UUID, primary key", "Unique evidence identifier."),
            ("case_id", "UUID, foreign key -> integrity_case.id", "Case this evidence belongs to."),
            ("evidence_type", "TEXT, not null", "Category of evidence."),
            ("source_ref", "TEXT", "Reference or source label for the evidence."),
            ("payload", "JSONB, default {}", "Structured evidence payload."),
            ("added_by", "UUID, foreign key -> app_user.id", "User who added the evidence."),
            ("added_at", "TIMESTAMPTZ, default NOW()", "Timestamp when evidence was added."),
        ],
    },
    {
        "name": "case_action",
        "purpose": "Tracks actions taken on an integrity case, such as notes, escalations, or workflow updates.",
        "attributes": [
            ("id", "UUID, primary key", "Unique case action identifier."),
            ("case_id", "UUID, foreign key -> integrity_case.id", "Case on which the action was performed."),
            ("action_type", "TEXT, not null", "Type of case action."),
            ("note", "TEXT", "Optional explanatory note."),
            ("payload", "JSONB, default {}", "Structured action payload."),
            ("action_by", "UUID, foreign key -> app_user.id", "User who performed the action."),
            ("action_at", "TIMESTAMPTZ, default NOW()", "Timestamp of the action."),
        ],
    },
    {
        "name": "evaluation",
        "purpose": "Stores evaluator marks, feedback, and rubric data for a submitted answer script.",
        "attributes": [
            ("id", "UUID, primary key", "Unique evaluation identifier."),
            ("submission_id", "UUID, unique, foreign key -> answer_submission.id", "Submission being evaluated."),
            ("evaluator_id", "UUID, foreign key -> app_user.id", "Evaluator who graded the submission."),
            ("awarded_marks", "NUMERIC(10,2), default 0", "Marks awarded by the evaluator."),
            ("feedback", "TEXT", "Evaluator feedback."),
            ("rubric_breakdown", "JSONB, default {}", "Structured rubric-wise marks or notes."),
            ("evaluated_at", "TIMESTAMPTZ, default NOW()", "Time when evaluation was completed."),
        ],
    },
    {
        "name": "result",
        "purpose": "Stores the final computed result for each submitted exam, including marks, integrity state, and publication status.",
        "attributes": [
            ("id", "UUID, primary key", "Unique result identifier."),
            ("exam_id", "UUID, foreign key -> exam.id", "Exam for which the result was prepared."),
            ("student_id", "UUID, foreign key -> app_user.id", "Student whose result it is."),
            ("submission_id", "UUID, unique, foreign key -> answer_submission.id", "Submission from which the result was derived."),
            ("total_marks", "NUMERIC(10,2), not null", "Total marks available in the exam."),
            ("awarded_marks", "NUMERIC(10,2), not null", "Marks awarded to the student."),
            ("percentage", "NUMERIC(6,2), generated", "Calculated percentage based on total and awarded marks."),
            ("integrity_score", "NUMERIC(8,2), default 0", "Final integrity score considered while producing the result."),
            ("case_status", "case_status enum", "Integrity case status associated with the result."),
            ("submission_hash_verified", "BOOLEAN, default FALSE", "Whether the submission hash was verified."),
            ("status", "result_status enum, default 'draft'", "Publication status of the result."),
            ("published_by", "UUID, foreign key -> app_user.id", "User who published the result."),
            ("published_at", "TIMESTAMPTZ", "Publication timestamp."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Creation timestamp."),
        ],
    },
    {
        "name": "recheck_request",
        "purpose": "Stores student requests for result re-check and the final review decision.",
        "attributes": [
            ("id", "UUID, primary key", "Unique re-check request identifier."),
            ("result_id", "UUID, foreign key -> result.id", "Result against which re-check was requested."),
            ("student_id", "UUID, foreign key -> app_user.id", "Student who requested the re-check."),
            ("reason", "TEXT, not null", "Reason for requesting re-check."),
            ("status", "recheck_status enum, default 'requested'", "Current review status of the re-check."),
            ("requested_at", "TIMESTAMPTZ, default NOW()", "Time when the request was made."),
            ("reviewed_by", "UUID, foreign key -> app_user.id", "User who reviewed the request."),
            ("reviewed_at", "TIMESTAMPTZ", "Time when the request was reviewed."),
            ("decision_notes", "TEXT", "Reviewer notes on the decision."),
            ("adjusted_marks", "NUMERIC(10,2)", "Updated marks if the re-check changes the score."),
        ],
    },
    {
        "name": "audit_log",
        "purpose": "Stores audit trail entries for important system actions performed by users or system processes.",
        "attributes": [
            ("id", "BIGSERIAL, primary key", "Unique audit log identifier."),
            ("actor_user_id", "UUID, foreign key -> app_user.id", "User who performed the action."),
            ("actor_role", "user_role enum", "Role of the actor at the time of the action."),
            ("action", "TEXT, not null", "Action name such as exam_created or results_published."),
            ("entity_type", "TEXT, not null", "Type of entity that was acted on."),
            ("entity_id", "UUID", "Identifier of the target entity."),
            ("occurred_at", "TIMESTAMPTZ, default NOW()", "When the action occurred."),
            ("ip_address", "INET", "IP address from which the action was performed."),
            ("details", "JSONB, default {}", "Extra structured details about the action."),
        ],
    },
    {
        "name": "integrity_penalty_assignment",
        "purpose": "Stores manually assigned penalty points against a specific integrity event by a proctor or staff user.",
        "attributes": [
            ("id", "UUID, primary key", "Unique penalty assignment identifier."),
            ("event_id", "BIGINT, unique, foreign key -> integrity_event.id", "Integrity event receiving the penalty."),
            ("exam_id", "UUID, foreign key -> exam.id", "Exam related to the penalty."),
            ("student_id", "UUID, foreign key -> app_user.id", "Student receiving the penalty."),
            ("attempt_no", "INTEGER, default 1", "Attempt number."),
            ("penalty_points", "NUMERIC(8,2), default 0", "Penalty points assigned."),
            ("note", "TEXT", "Optional note explaining the penalty."),
            ("assigned_by", "UUID, foreign key -> app_user.id", "User who assigned the penalty."),
            ("assigned_at", "TIMESTAMPTZ, default NOW()", "Time when the penalty was assigned."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Creation timestamp."),
            ("updated_at", "TIMESTAMPTZ, default NOW()", "Last update timestamp."),
        ],
    },
    {
        "name": "stored_document",
        "purpose": "Stores metadata for files saved in AWS S3, such as published result reports and integrity evidence documents.",
        "attributes": [
            ("id", "UUID, primary key", "Unique stored document identifier."),
            ("exam_id", "UUID, foreign key -> exam.id", "Exam related to the stored document."),
            ("student_id", "UUID, foreign key -> app_user.id", "Student related to the document."),
            ("case_id", "UUID, foreign key -> integrity_case.id", "Integrity case related to the document, if any."),
            ("document_type", "TEXT, not null", "Document category such as result_report or integrity_evidence."),
            ("s3_key", "TEXT, unique, not null", "AWS S3 object key used to locate the file."),
            ("original_name", "TEXT", "Original or generated file name."),
            ("content_type", "TEXT", "MIME content type of the file."),
            ("uploaded_by", "UUID, foreign key -> app_user.id", "User who uploaded or triggered document creation."),
            ("created_at", "TIMESTAMPTZ, default NOW()", "Timestamp when the document metadata was stored."),
        ],
    },
]


def p(text, bold=False, size=None):
    text = escape(text)
    run_props = []
    if bold:
        run_props.append("<w:b/>")
    if size:
        run_props.append(f'<w:sz w:val="{size}"/>')
        run_props.append(f'<w:szCs w:val="{size}"/>')
    rpr = f"<w:rPr>{''.join(run_props)}</w:rPr>" if run_props else ""
    return (
        "<w:p>"
        f"<w:r>{rpr}<w:t xml:space=\"preserve\">{text}</w:t></w:r>"
        "</w:p>"
    )


def doc_xml():
    body = []
    body.append(p("Database Tables and Attributes", bold=True, size=32))
    body.append(p("Exam Integrity System", bold=True, size=24))
    body.append(
        p(
            "This document describes the tables used in the project database, their purpose, and the meaning of their main attributes."
        )
    )

    for table in TABLES:
        body.append(p(""))
        body.append(p(f"Table: {table['name']}", bold=True, size=24))
        body.append(p(f"Purpose: {table['purpose']}"))
        body.append(p("Attributes:", bold=True))
        for name, dtype, desc in table["attributes"]:
            body.append(p(f"- {name} ({dtype}): {desc}"))

    sect = (
        "<w:sectPr>"
        '<w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
        'w:header="708" w:footer="708" w:gutter="0"/>'
        "</w:sectPr>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" '
        'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
        'xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
        'xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:w10="urn:schemas-microsoft-com:office:word" '
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
        'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
        'xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" '
        'xmlns:wne="http://schemas.microsoft.com/office/2006/wordml" '
        'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
        'mc:Ignorable="w14 wp14">'
        f"<w:body>{''.join(body)}{sect}</w:body>"
        "</w:document>"
    )


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""


RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>
"""


CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Database Tables and Attributes</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
</cp:coreProperties>
"""


APP = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
</Properties>
"""


def main():
    root = Path(__file__).resolve().parents[1]
    out_path = root / "docs" / "database-table-details.docx"
    with ZipFile(out_path, "w", ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", RELS)
        zf.writestr("word/document.xml", doc_xml())
        zf.writestr("word/_rels/document.xml.rels", DOC_RELS)
        zf.writestr("docProps/core.xml", CORE)
        zf.writestr("docProps/app.xml", APP)
    print(out_path)


if __name__ == "__main__":
    main()
