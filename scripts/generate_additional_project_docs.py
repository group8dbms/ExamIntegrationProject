from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"

styles = getSampleStyleSheet()
TITLE = ParagraphStyle(
    "TitleCustomExtra",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=21,
    textColor=colors.HexColor("#10243e"),
    alignment=TA_CENTER,
    spaceAfter=14,
)
HEADING = ParagraphStyle(
    "HeadingExtra",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=14,
    textColor=colors.HexColor("#12355b"),
    spaceBefore=8,
    spaceAfter=6,
)
BODY = ParagraphStyle(
    "BodyExtra",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=10.2,
    leading=13.5,
    textColor=colors.HexColor("#1f1f1f"),
    spaceAfter=5,
)
SMALL = ParagraphStyle(
    "SmallExtra",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=8.8,
    leading=11,
    textColor=colors.HexColor("#1f1f1f"),
)
TABLE_HEAD = ParagraphStyle(
    "TableHeadExtra",
    parent=SMALL,
    fontName="Helvetica-Bold",
    textColor=colors.white,
)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#10243e"))
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


def make_table(rows, widths):
    processed = []
    for i, row in enumerate(rows):
        processed.append(
            [
                Paragraph(str(cell), TABLE_HEAD if i == 0 else SMALL)
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


def detailed_guide_story():
    story = [
        p("This document presents the complete project technology stack, installed dependencies, implemented integrations, and the full development-to-deployment workflow followed in the Exam Integrity System."),
        Paragraph("Technology Stack", HEADING),
        make_table(
            [
                ["Layer", "Technologies"],
                ["Frontend", "React, Vite, JavaScript, Custom CSS"],
                ["Backend", "Node.js, Express.js, REST APIs"],
                ["Database", "PostgreSQL, Neon hosted Postgres"],
                ["Cloud and Hosting", "AWS EC2, AWS S3, Nginx, PM2"],
                ["Supporting Services", "SMTP, GitHub"],
            ],
            [4.1 * cm, 10.4 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Installed Dependencies", HEADING),
        make_table(
            [
                ["Area", "Installed Packages"],
                ["Backend", "@aws-sdk/client-s3, @aws-sdk/s3-request-presigner, cors, dotenv, express, helmet, morgan, multer, nodemailer, pg, nodemon"],
                ["Frontend", "react, react-dom, vite, @vitejs/plugin-react, eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, @eslint/js, @types/react, @types/react-dom, globals"],
            ],
            [3.0 * cm, 11.5 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Integrations Implemented", HEADING),
    ]
    for item in [
        "Neon PostgreSQL integration for users, exams, submissions, integrity events, results, audit logs, and stored-document metadata.",
        "SMTP integration for student verification mail and result publication mail.",
        "AWS S3 integration for result_report and integrity_evidence document storage with signed URL access.",
        "EC2 deployment integration using PM2 for backend runtime and Nginx for frontend serving and reverse proxying.",
        "Database-level integrity and submission-hash verification support through SQL functions, triggers, and views.",
    ]:
        story.append(bullet(item))
    story += [
        Spacer(1, 0.25 * cm),
        Paragraph("End-to-End Implementation Flow", HEADING),
    ]
    for item in [
        "Design PostgreSQL schema and supporting views, functions, and triggers.",
        "Build Express backend routes and services for authentication, exams, submissions, integrity, audit, and documents.",
        "Build the React frontend with separate role-based workspaces.",
        "Add SMTP verification and result email workflows.",
        "Add suspicious activity, penalty, case, and proctor decision workflows.",
        "Add evaluation, gated publishing, and S3-backed document storage.",
        "Deploy on EC2 with Node.js, PM2, Nginx, Git, and AWS CLI.",
    ]:
        story.append(bullet(item))
    story += [
        Spacer(1, 0.25 * cm),
        Paragraph("Deployment Sequence", HEADING),
        make_table(
            [
                ["Step", "Action"],
                ["1", "Create database in Neon and apply schema scripts."],
                ["2", "Configure backend environment variables."],
                ["3", "Install frontend and backend dependencies."],
                ["4", "Create EC2 instance and install Node.js, PM2, Nginx, Git, and AWS CLI."],
                ["5", "Create S3 bucket and attach IAM role to EC2."],
                ["6", "Run backend with PM2 and publish frontend build through Nginx."],
                ["7", "Validate login, exam flow, email delivery, result publication, and document access."],
            ],
            [1.4 * cm, 13.1 * cm],
        ),
    ]
    return story


def submission_story():
    story = [
        p("This report presents the Exam Integrity System in a formal project-submission style covering objective, modules, technologies, integrations, deployment, and outcomes."),
        Paragraph("Project Objective", HEADING),
    ]
    for item in [
        "Build a secure online examination platform.",
        "Support academic and integrity workflows together.",
        "Provide role-based access for admin, student, proctor, evaluator, and auditor.",
        "Maintain evidence, logs, and audit-ready records.",
    ]:
        story.append(bullet(item))
    story += [
        Spacer(1, 0.25 * cm),
        Paragraph("Modules Implemented", HEADING),
        make_table(
            [
                ["Module", "Main Function"],
                ["Authentication and Access", "Student registration, verification, staff login, role-based access."],
                ["Exam Management", "Exam creation, question setup, threshold configuration, student assignment."],
                ["Student Exam Module", "Assigned exams, exam launch, autosave, final submission."],
                ["Integrity Monitoring", "Suspicious event logging and integrity history."],
                ["Proctor Investigation", "Penalty assignment, case opening, final decisions, evidence generation."],
                ["Evaluation", "Submission review, marking, and evaluation record saving."],
                ["Result Publication", "Controlled publish flow, result mail, and S3 report upload."],
                ["Audit", "Audit review, hash verification, report and evidence access."],
            ],
            [4.3 * cm, 10.2 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Technology and Deployment", HEADING),
        make_table(
            [
                ["Area", "Used In Project"],
                ["Frontend", "React and Vite"],
                ["Backend", "Node.js and Express.js"],
                ["Database", "PostgreSQL on Neon"],
                ["Cloud", "AWS EC2 and AWS S3"],
                ["Process and Hosting", "PM2 and Nginx"],
                ["Email", "SMTP"],
            ],
            [4.3 * cm, 10.2 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Project Outcomes", HEADING),
    ]
    for item in [
        "Implemented a complete exam lifecycle platform instead of only a quiz portal.",
        "Introduced controlled publication rules based on submission, evaluation, and integrity-case completion.",
        "Integrated cloud-backed report storage using S3.",
        "Maintained audit and verification support for post-exam review.",
    ]:
        story.append(bullet(item))
    return story


def viva_story():
    story = [
        p("This short version is designed for viva preparation and quick oral explanation."),
        Paragraph("What the Project Does", HEADING),
    ]
    for item in [
        "Creates and manages online exams.",
        "Lets students register, verify email, and take assigned exams.",
        "Logs suspicious activity during the exam.",
        "Lets evaluators mark submissions and proctors resolve suspicious cases.",
        "Publishes results only after all workflows are completed.",
        "Stores result and integrity reports in AWS S3 for audit review.",
    ]:
        story.append(bullet(item))
    story += [
        Spacer(1, 0.25 * cm),
        Paragraph("Fast Stack Summary", HEADING),
        make_table(
            [
                ["Part", "Technology"],
                ["Frontend", "React + Vite"],
                ["Backend", "Node.js + Express"],
                ["Database", "PostgreSQL on Neon"],
                ["Cloud", "AWS EC2 + AWS S3"],
                ["Email", "SMTP"],
            ],
            [4.2 * cm, 10.3 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Best Viva Line", HEADING),
        p("The Exam Integrity System is a full-stack cloud-enabled online examination platform that combines exam delivery, integrity monitoring, manual review, result publication, and audit reporting in one system."),
    ]
    return story


def presentation_story():
    story = [
        p("This slide-ready version summarizes the project in a clean presentation format."),
        Paragraph("Presentation Flow", HEADING),
        make_table(
            [
                ["Slide", "Focus"],
                ["1", "Title and problem statement"],
                ["2", "Project objective"],
                ["3", "User roles"],
                ["4", "Core features"],
                ["5", "Technology stack"],
                ["6", "Dependencies and integrations"],
                ["7", "System flow and integrity flow"],
                ["8", "Deployment on EC2 and S3"],
                ["9", "Advantages and conclusion"],
            ],
            [1.8 * cm, 12.7 * cm],
        ),
        Spacer(1, 0.25 * cm),
        Paragraph("Key Slide Points", HEADING),
    ]
    for item in [
        "Role-based design for admin, student, proctor, evaluator, and auditor.",
        "Suspicious-event logging plus manual proctor review instead of blind auto-punishment.",
        "Result publication blocked until academic and integrity workflows are complete.",
        "Generated reports stored in S3 and referenced in PostgreSQL for audit access.",
        "Deployment handled through EC2, PM2, Nginx, and Neon.",
    ]:
        story.append(bullet(item))
    return story


def main():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    build_pdf("06-project-tech-stack-and-deployment-guide.pdf", "Project Tech Stack and End-to-End Deployment Guide", detailed_guide_story())
    build_pdf("07-project-submission-report.pdf", "Exam Integrity System Project Submission Report", submission_story())
    build_pdf("08-viva-quick-summary.pdf", "Exam Integrity System Viva Quick Summary", viva_story())
    build_pdf("09-presentation-version.pdf", "Exam Integrity System Presentation Version", presentation_story())
    print("Additional project PDFs generated successfully.")


if __name__ == "__main__":
    main()
