from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.platypus.flowables import Flowable


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"


class DrawingFlowable(Flowable):
    def __init__(self, drawing, width, height):
        super().__init__()
        self.drawing = drawing
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        return self.width, self.height

    def draw(self):
        renderPDF.draw(self.drawing, self.canv, 0, 0)


styles = getSampleStyleSheet()
TITLE = ParagraphStyle(
    "TitleCustom",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=22,
    textColor=colors.HexColor("#0b1f36"),
    alignment=TA_CENTER,
    spaceAfter=14,
)
SUBTITLE = ParagraphStyle(
    "SubtitleCustom",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=15,
    textColor=colors.HexColor("#12355b"),
    spaceBefore=10,
    spaceAfter=8,
)
BODY = ParagraphStyle(
    "BodyCustom",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=10.5,
    leading=14,
    textColor=colors.HexColor("#1c1c1c"),
    spaceAfter=5,
)
SMALL = ParagraphStyle(
    "SmallCustom",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9,
    leading=12,
    textColor=colors.HexColor("#333333"),
    spaceAfter=4,
)
TABLE_HEADER = ParagraphStyle(
    "TableHeader",
    parent=SMALL,
    fontName="Helvetica-Bold",
    fontSize=9,
    leading=11,
    textColor=colors.white,
)
TABLE_CELL = ParagraphStyle(
    "TableCell",
    parent=SMALL,
    fontName="Helvetica",
    fontSize=8.4,
    leading=10.5,
    textColor=colors.HexColor("#1c1c1c"),
)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#0b1f36"))
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(1.8 * cm, A4[1] - 1.2 * cm, "Exam Integrity System")
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(A4[0] - 1.8 * cm, 1.0 * cm, f"Page {doc.page}")
    canvas.restoreState()


def p(text, style=BODY):
    return Paragraph(text, style)


def bullet(text):
    return Paragraph(f"&bull; {text}", BODY)


def normalize(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def make_table(rows, widths):
    processed = []
    for row_index, row in enumerate(rows):
        processed.append(
            [
                Paragraph(normalize(cell), TABLE_HEADER if row_index == 0 else TABLE_CELL)
                for cell in row
            ]
        )

    table = Table(processed, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#12355b")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b8c4d6")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eef4fb")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def draw_box(drawing, x, y, w, h, title, fill="#dce8f5", stroke="#12355b", font_size=8):
    drawing.add(
        Rect(
            x,
            y,
            w,
            h,
            rx=8,
            ry=8,
            fillColor=colors.HexColor(fill),
            strokeColor=colors.HexColor(stroke),
            strokeWidth=1.2,
        )
    )
    text_width = stringWidth(title, "Helvetica-Bold", font_size)
    drawing.add(
        String(
            x + max((w - text_width) / 2, 4),
            y + h / 2 - 4,
            title,
            fontName="Helvetica-Bold",
            fontSize=font_size,
            fillColor=colors.HexColor("#10243e"),
        )
    )


def arrow(drawing, x1, y1, x2, y2):
    drawing.add(Line(x1, y1, x2, y2, strokeColor=colors.HexColor("#355070"), strokeWidth=1.3))
    dx = x2 - x1
    dy = y2 - y1
    if dx == dy == 0:
        return
    if abs(dx) >= abs(dy):
        sign = 1 if dx >= 0 else -1
        drawing.add(Line(x2, y2, x2 - 6 * sign, y2 + 3, strokeColor=colors.HexColor("#355070"), strokeWidth=1.3))
        drawing.add(Line(x2, y2, x2 - 6 * sign, y2 - 3, strokeColor=colors.HexColor("#355070"), strokeWidth=1.3))
    else:
        sign = 1 if dy >= 0 else -1
        drawing.add(Line(x2, y2, x2 - 3, y2 - 6 * sign, strokeColor=colors.HexColor("#355070"), strokeWidth=1.3))
        drawing.add(Line(x2, y2, x2 + 3, y2 - 6 * sign, strokeColor=colors.HexColor("#355070"), strokeWidth=1.3))


def role_flow_drawing():
    d = Drawing(500, 170)
    draw_box(d, 15, 110, 90, 42, "Admin")
    draw_box(d, 145, 110, 90, 42, "Student")
    draw_box(d, 275, 110, 90, 42, "Proctor")
    draw_box(d, 405, 110, 90, 42, "Evaluator")
    draw_box(d, 210, 35, 90, 42, "Auditor", fill="#e9f6ec")
    arrow(d, 105, 131, 145, 131)
    arrow(d, 235, 131, 275, 131)
    arrow(d, 365, 131, 405, 131)
    arrow(d, 320, 110, 255, 77)
    arrow(d, 450, 110, 255, 77)
    arrow(d, 60, 110, 240, 77)
    d.add(String(145, 8, "Role Interaction Snapshot", fontName="Helvetica-Bold", fontSize=12, fillColor=colors.HexColor("#12355b")))
    return d


def er_drawing():
    d = Drawing(520, 260)
    draw_box(d, 20, 200, 92, 34, "app_user")
    draw_box(d, 145, 200, 92, 34, "exam")
    draw_box(d, 270, 200, 100, 34, "question")
    draw_box(d, 400, 200, 92, 34, "audit_log")
    draw_box(d, 145, 130, 110, 34, "exam_candidate")
    draw_box(d, 290, 130, 120, 34, "answer_submission")
    draw_box(d, 20, 60, 110, 34, "integrity_event")
    draw_box(d, 160, 60, 100, 34, "integrity_case")
    draw_box(d, 290, 60, 92, 34, "evaluation")
    draw_box(d, 400, 60, 92, 34, "result")
    draw_box(d, 400, 10, 92, 34, "stored_document", fill="#e9f6ec")
    arrow(d, 66, 200, 190, 164)
    arrow(d, 191, 200, 200, 164)
    arrow(d, 320, 200, 225, 164)
    arrow(d, 255, 147, 290, 147)
    arrow(d, 185, 130, 76, 94)
    arrow(d, 205, 130, 210, 94)
    arrow(d, 350, 130, 336, 94)
    arrow(d, 350, 130, 446, 94)
    arrow(d, 446, 60, 446, 44)
    arrow(d, 210, 60, 446, 28)
    arrow(d, 446, 200, 446, 94)
    d.add(String(140, 242, "Database Relationship Overview", fontName="Helvetica-Bold", fontSize=12, fillColor=colors.HexColor("#12355b")))
    return d


def api_drawing():
    d = Drawing(520, 170)
    draw_box(d, 20, 105, 90, 38, "/auth")
    draw_box(d, 120, 105, 90, 38, "/exams")
    draw_box(d, 220, 105, 90, 38, "/submissions")
    draw_box(d, 320, 105, 90, 38, "/integrity")
    draw_box(d, 420, 105, 80, 38, "/audit")
    draw_box(d, 200, 35, 120, 38, "/documents", fill="#e9f6ec")
    arrow(d, 265, 105, 260, 73)
    arrow(d, 365, 105, 260, 73)
    d.add(String(155, 8, "Backend API Grouping", fontName="Helvetica-Bold", fontSize=12, fillColor=colors.HexColor("#12355b")))
    return d


def overview_drawing():
    d = Drawing(520, 260)
    draw_box(d, 25, 200, 120, 38, "Admin Setup")
    draw_box(d, 200, 200, 120, 38, "Student Attempt")
    draw_box(d, 375, 200, 120, 38, "Integrity Logging")
    draw_box(d, 25, 115, 120, 38, "Evaluator Marking")
    draw_box(d, 200, 115, 120, 38, "Proctor Decision")
    draw_box(d, 375, 115, 120, 38, "Publish Results")
    draw_box(d, 200, 30, 120, 38, "Auditor Review", fill="#e9f6ec")
    arrow(d, 145, 219, 200, 219)
    arrow(d, 320, 219, 375, 219)
    arrow(d, 260, 200, 85, 153)
    arrow(d, 435, 200, 260, 153)
    arrow(d, 145, 134, 200, 134)
    arrow(d, 320, 134, 375, 134)
    arrow(d, 260, 115, 260, 68)
    arrow(d, 435, 115, 260, 68)
    d.add(String(158, 245, "Whole Project Lifecycle", fontName="Helvetica-Bold", fontSize=12, fillColor=colors.HexColor("#12355b")))
    return d


def aws_drawing():
    d = Drawing(520, 170)
    draw_box(d, 25, 105, 100, 38, "Browser")
    draw_box(d, 160, 105, 100, 38, "Nginx on EC2")
    draw_box(d, 295, 105, 100, 38, "Backend")
    draw_box(d, 430, 105, 70, 38, "S3", fill="#e9f6ec")
    draw_box(d, 295, 35, 100, 38, "Neon DB")
    draw_box(d, 160, 35, 100, 38, "PM2")
    arrow(d, 125, 124, 160, 124)
    arrow(d, 260, 124, 295, 124)
    arrow(d, 395, 124, 430, 124)
    arrow(d, 345, 105, 345, 73)
    arrow(d, 295, 54, 260, 54)
    d.add(String(145, 8, "EC2 and S3 Deployment Overview", fontName="Helvetica-Bold", fontSize=12, fillColor=colors.HexColor("#12355b")))
    return d


def build_pdf(filename, title, story):
    doc = SimpleDocTemplate(
        str(DOCS_DIR / filename),
        pagesize=A4,
        topMargin=1.8 * cm,
        bottomMargin=1.6 * cm,
        leftMargin=1.8 * cm,
        rightMargin=1.8 * cm,
    )
    doc.build([Paragraph(title, TITLE), Spacer(1, 0.2 * cm)] + story, onFirstPage=header_footer, onLaterPages=header_footer)


def functional_doc():
    story = [
        p("This document formally presents the functional requirements of the Exam Integrity System, the technology stack used to implement it, and the responsibilities attached to each user role."),
        DrawingFlowable(role_flow_drawing(), 500, 170),
        Paragraph("Functional Requirements", SUBTITLE),
    ]
    for item in [
        "The system shall allow an administrator to create exams with title, course code, timing, duration, and integrity threshold.",
        "The system shall support structured question creation for MCQ and MSQ formats with options and answer keys.",
        "The system shall allow only active and verified students to be assigned to examinations.",
        "The system shall allow students to register, verify email automatically through a link, log in, and attempt assigned examinations.",
        "The system shall autosave answers during the exam and support final secure submission.",
        "The system shall record suspicious activity such as tab switching, window changes, IP changes, and related integrity events.",
        "The system shall provide proctor-driven case handling with penalty assignment and decision recording.",
        "The system shall support evaluator-based marking and controlled result publication.",
        "The system shall support audit review with logs, hash verification, integrity summary, and stored reports.",
    ]:
        story.append(bullet(item))

    story += [
        Spacer(1, 0.2 * cm),
        Paragraph("Technology Stack", SUBTITLE),
        make_table(
            [
                ["Layer", "Technology Used"],
                ["Frontend", "React, Vite, JavaScript, and a custom dark-theme interface."],
                ["Backend", "Node.js with Express.js following a REST API design."],
                ["Database", "PostgreSQL hosted on Neon."],
                ["Mail", "SMTP for verification email and result notifications."],
                ["Hosting", "AWS EC2 with Nginx and PM2."],
                ["Document Storage", "AWS S3 for generated result and integrity reports."],
            ],
            [4.0 * cm, 10.5 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("User Roles and Responsibilities", SUBTITLE),
        make_table(
            [
                ["Role", "Formal Responsibility Statement"],
                ["Admin", "Creates exams, configures question papers, assigns students and staff roles, and publishes evaluated results."],
                ["Student", "Registers, verifies identity through email, logs in, attempts assigned exams, and submits responses."],
                ["Proctor", "Monitors suspicious events, assigns penalties, opens investigation cases, and records final case decisions."],
                ["Evaluator", "Reviews submitted responses and assigns academic marks and feedback."],
                ["Auditor", "Reviews audit logs, case status, hash verification, and stored result or evidence documents."],
            ],
            [3.0 * cm, 11.5 * cm],
        ),
    ]
    return story


def database_doc():
    story = [
        p("This document provides a formal overview of the PostgreSQL schema and the principal relationships maintained by the system."),
        DrawingFlowable(er_drawing(), 520, 260),
        Paragraph("Principal Tables and Their Purpose", SUBTITLE),
        make_table(
            [
                ["Table", "Purpose"],
                ["app_user", "Stores all users including admin, student, proctor, evaluator, and auditor accounts."],
                ["exam", "Stores master examination data such as title, timing, threshold, and publication metadata."],
                ["question, question_bank, exam_question", "Store authored questions and their mapping to individual examinations."],
                ["exam_candidate", "Stores the relationship between a student and a scheduled examination attempt."],
                ["answer_submission", "Stores autosaved answers, final answers, and secure submission metadata."],
                ["integrity_event", "Stores suspicious activity events recorded during the exam."],
                ["integrity_case", "Stores investigation workflow data when a student attempt is formally reviewed."],
                ["case_evidence and case_action", "Store evidence references and case action history."],
                ["evaluation", "Stores evaluator marks, feedback, and rubric-related data."],
                ["result", "Stores final academic and integrity-aware result state."],
                ["audit_log", "Stores system-wide audit activity for traceability."],
                ["stored_document", "Stores metadata for S3-backed result reports and integrity evidence."],
            ],
            [4.8 * cm, 9.7 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Relationship Summary", SUBTITLE),
    ]
    for item in [
        "An examination can have multiple assigned students through the exam_candidate bridge table.",
        "Each assigned exam attempt can produce one submission, multiple integrity events, and optionally an integrity case.",
        "A finalized submission can later be evaluated and converted into a result record.",
        "An integrity case can contain many evidence records and many action records.",
        "Stored cloud documents can be linked to an exam, a student, and optionally to a specific case.",
    ]:
        story.append(bullet(item))
    return story


def api_doc():
    story = [
        p("This document summarizes the backend API surface used by the application and explains the operational role of each endpoint group."),
        DrawingFlowable(api_drawing(), 520, 170),
        Paragraph("API Groups", SUBTITLE),
        make_table(
            [
                ["Base Group", "Primary Use"],
                ["/health", "Health and database connectivity check."],
                ["/api/auth", "Registration, login, verification, and user lookup functions."],
                ["/api/exams", "Exam creation, assignment, paper retrieval, evaluation, and publication."],
                ["/api/submissions", "Autosave and final submission operations."],
                ["/api/integrity", "Suspicious-event logging, penalties, investigation cases, and proctor actions."],
                ["/api/audit", "Audit logs and exam-wise audit review endpoints."],
                ["/api/documents", "Stored document metadata, uploads, and signed access URLs."],
            ],
            [4.0 * cm, 10.5 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Important Operational Calls", SUBTITLE),
        make_table(
            [
                ["Endpoint", "Use"],
                ["POST /api/auth/student-access", "Handles student registration, verification resend, and login path decisions."],
                ["POST /api/auth/bootstrap-user", "Creates or updates faculty/staff accounts under admin control."],
                ["POST /api/exams", "Creates the exam schedule, question set, and assignment payload."],
                ["POST /api/submissions/autosave", "Persists in-progress answers during the attempt."],
                ["POST /api/submissions/finalize", "Stores final answers and marks the candidate as submitted."],
                ["POST /api/integrity/events", "Writes suspicious activity records during the exam window."],
                ["PATCH /api/integrity/cases/:caseId/decision", "Records the final proctor decision and triggers integrity-evidence generation."],
                ["POST /api/exams/:examId/publish-results", "Publishes results and triggers automatic result-report generation."],
                ["GET /api/audit/exams/:examId", "Returns the exam-wise audit packet for the auditor dashboard."],
            ],
            [6.0 * cm, 8.5 * cm],
        ),
    ]
    return story


def overview_doc():
    story = [
        p("This document gives a formal whole-system overview of the project lifecycle from exam preparation through post-publication audit review."),
        DrawingFlowable(overview_drawing(), 520, 260),
        Paragraph("Lifecycle Narrative", SUBTITLE),
    ]
    for item in [
        "The administrator first prepares the examination, question paper, staffing assignments, and student mapping.",
        "Verified students log in and start the examination only after the scheduled time has been reached.",
        "During the exam, answers are autosaved and suspicious events are recorded whenever integrity anomalies are detected.",
        "After submission, evaluators review student responses and save awarded marks.",
        "Where suspicious behavior has been recorded, the proctor reviews logs, assigns penalties, and records the case decision.",
        "Only after all required academic and integrity workflows are completed does the administrator publish results.",
        "Finally, the auditor reviews logs, hash verification, stored documents, and decision history for traceability.",
    ]:
        story.append(bullet(item))
    return story


def aws_doc():
    story = [
        p("This document explains the AWS deployment approach used in the project, specifically the role of EC2 in hosting the application and S3 in storing generated reports."),
        DrawingFlowable(aws_drawing(), 520, 170),
        Paragraph("Installed Components on EC2", SUBTITLE),
        make_table(
            [
                ["Component", "Reason"],
                ["Node.js and npm", "Required to run the backend service and build the frontend application."],
                ["PM2", "Required to keep the backend service active and manageable as a background process."],
                ["Nginx", "Required to serve the frontend build and reverse proxy application traffic."],
                ["Git", "Required to pull project changes from the GitHub repository."],
                ["AWS CLI", "Used to validate S3 integration and server IAM configuration."],
            ],
            [4.5 * cm, 10.0 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("How AWS Is Used in the Project", SUBTITLE),
    ]
    for item in [
        "EC2 hosts both the frontend and backend components of the application.",
        "Nginx serves the Vite frontend build and proxies API calls to the backend service running on port 4000.",
        "The backend uses the IAM role attached to EC2 to access S3 securely without hardcoded AWS credentials.",
        "S3 stores two generated document categories: result_report and integrity_evidence.",
        "Neon PostgreSQL continues to store the transactional exam and metadata records, including S3 document references.",
    ]:
        story.append(bullet(item))
    story += [
        Spacer(1, 0.25 * cm),
        Paragraph("Deployment Update Flow", SUBTITLE),
        make_table(
            [
                ["Step", "Operational Action"],
                ["1", "Commit and push application changes from the local system to GitHub."],
                ["2", "SSH into the EC2 instance and pull the latest code."],
                ["3", "Install backend dependencies if required and restart the PM2-managed backend."],
                ["4", "Build the frontend and synchronize the output to the Nginx web root."],
                ["5", "Reload Nginx and verify health and browser accessibility."],
            ],
            [1.2 * cm, 13.3 * cm],
        ),
    ]
    return story


def main():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    build_pdf("01-functional-requirements-and-roles.pdf", "Functional Requirements, Technology Stack, and Role Responsibilities", functional_doc())
    build_pdf("02-database-er-diagram-and-schema.pdf", "Database ER Diagram and Schema Overview", database_doc())
    build_pdf("03-api-calls-and-usage.pdf", "API Calls and Operational Usage", api_doc())
    build_pdf("04-system-flow-overview.pdf", "System Flow and Project Overview", overview_doc())
    build_pdf("05-aws-ec2-and-s3-setup.pdf", "AWS EC2 and S3 Deployment Notes", aws_doc())
    print("PDF documents generated successfully.")


if __name__ == "__main__":
    main()
