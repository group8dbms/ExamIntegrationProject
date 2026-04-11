# Exam Integrity System

Exam Integrity System is a role-based web platform for conducting online examinations with strong integrity controls, controlled evaluation, gated result publication, and audit-ready reporting.

The project combines:
- exam scheduling and assignment
- MCQ/MSQ question delivery
- autosave and secure final submission
- suspicious activity logging during the exam
- proctor-led investigation workflow
- evaluator-based marking
- result publication with email notifications
- audit review with submission-hash verification
- AWS S3 storage for generated reports and integrity evidence

## Project Highlights

- Dark-theme web UI with dedicated pages for `admin`, `student`, `proctor`, `evaluator`, and `auditor`
- Student registration with verification email and auto-verification link flow
- Admin-controlled exam creation, student assignment, and result publication
- Suspicious event tracking such as tab switching, window focus loss, and IP-related changes
- Proctor dashboard for penalties, case opening, and decision recording
- Evaluator workflow for reviewing submissions and assigning marks
- Auditor dashboard with exam-wise logs, hash verification, case details, and stored documents
- Automatic S3 upload of:
  - `result_report` when results are published
  - `integrity_evidence` when a proctor saves a case decision

## User Roles

### Admin
- logs in through the staff panel
- creates exams and sets timing, duration, and integrity threshold
- builds question papers using MCQ/MSQ fields
- assigns students to active exams
- assigns staff roles such as proctor, evaluator, and auditor
- publishes results only after evaluation and case decisions are complete

### Student
- registers if new
- verifies account through email link
- logs in and views assigned exams
- starts the exam only after start time
- answers questions with autosave support
- submits final answers securely

### Proctor
- reviews suspicious activity logs
- assigns penalty points to suspicious events
- opens and manages integrity cases
- records final case decisions
- triggers automatic integrity evidence generation

### Evaluator
- opens submitted exams
- reviews student answer scripts
- assigns marks and feedback

### Auditor
- reviews exam-wise audit reports
- checks submission hash verification
- inspects integrity cases and outcomes
- opens stored result and integrity evidence documents

## Technology Stack

### Frontend
- React
- Vite
- JavaScript
- Custom CSS

### Backend
- Node.js
- Express.js
- REST APIs

### Database
- PostgreSQL
- Neon hosted Postgres

### Cloud / Hosting
- AWS EC2
- Nginx
- PM2
- AWS S3

### Mail
- SMTP for student verification and result notifications

## System Overview

```text
Admin -> creates exam -> assigns students/staff
Student -> verifies email -> takes exam -> suspicious events logged if needed
Evaluator -> marks submission
Proctor -> reviews suspicious logs -> saves case decision
Admin -> publishes results
Auditor -> reviews logs, verification state, and stored reports
```

## Core Functional Areas

### 1. Exam Setup
- create exam title, course code, timing, and duration
- set integrity threshold
- add structured questions for `MCQ` and `MSQ`
- assign verified students

### 2. Student Exam Flow
- registration + email verification
- login and assigned exam display
- time-gated start button
- dedicated exam window
- autosave and final submit

### 3. Integrity Monitoring
- log suspicious actions when they occur
- track tab switches, focus changes, and IP-related changes
- show local warning to the test taker
- preserve suspicious logs for future retrieval

### 4. Proctor Workflow
- inspect flagged exams
- review student-wise suspicious logs
- assign penalties
- open cases
- save decisions

### 5. Evaluation and Publishing
- evaluator reviews submissions
- admin can publish only when:
  - all assigned students submitted
  - all students were evaluated
  - all opened cases received a proctor decision
- result publication sends mail and stores result reports automatically

### 6. Audit and Reporting
- exam-wise audit table
- submission hash verification
- integrity status and case status
- stored S3-backed result reports and integrity evidence
- audit log trail

## Repository Structure

```text
backend/    Express backend and business logic
frontend/   React frontend
sql/        PostgreSQL schema, triggers, and helper scripts
docs/       Project documentation and presentation PDFs
scripts/    Utility scripts such as PDF generation and schema helpers
```

## Important Backend Route Groups

- `/health`
- `/api/auth`
- `/api/exams`
- `/api/submissions`
- `/api/integrity`
- `/api/audit`
- `/api/documents`

## Database Notes

The PostgreSQL design supports:
- role-based users and sessions
- exam scheduling and assignment
- question banks and exam questions
- autosaved and final answer submissions
- suspicious event logging
- integrity cases, evidence, and actions
- evaluator marks and final results
- audit logs
- stored S3 document metadata

Important files:
- `sql/000_full_schema.sql`
- `sql/001_extensions.sql`
- `sql/002_schema.sql`
- `sql/003_functions_triggers_views.sql`
- `sql/004_smoke_test.sql`
- `sql/005_auth_verification.sql`
- `sql/005_manual_proctor_penalties.sql`
- `sql/006_stored_documents.sql`

## Local Setup

### 1. Clone the repository
```powershell
git clone https://github.com/group8dbms/ExamIntegrationProject.git
cd ExamIntegrationProject
```

### 2. Configure environment variables
Create `.env` files as required and provide:

```env
DATABASE_URL=your_neon_connection_string
FRONTEND_URL=http://127.0.0.1:5173
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
AWS_REGION=...
S3_BUCKET=...
MAX_UPLOAD_SIZE_BYTES=10485760
```

### 3. Prepare database
Fastest route:
- open Neon SQL editor
- run `sql/000_full_schema.sql`
- optionally run `sql/004_smoke_test.sql`

### 4. Run backend
```powershell
cd backend
npm install
npm run dev
```

### 5. Run frontend
```powershell
cd frontend
npm install
npm run dev
```

## Deployment Summary

The project is designed to be deployed on EC2 with:
- frontend served by Nginx
- backend managed by PM2
- Neon as hosted PostgreSQL
- S3 as generated document storage

Typical update flow:

```bash
cd /home/ubuntu/ExamIntegrationProject
git pull origin main

cd /home/ubuntu/ExamIntegrationProject/backend
npm install
pm2 restart exam-integrity-backend

cd /home/ubuntu/ExamIntegrationProject/frontend
npm install
npm run build
sudo rsync -av --delete dist/ /var/www/exam-integrity/
sudo systemctl reload nginx
```

## Stored Reports

The system currently stores the following document types in S3:
- `result_report`
- `integrity_evidence`

The metadata for these files is stored in PostgreSQL so auditors can retrieve them from the application.

## Documentation

Detailed project documents are available in the [`docs`](./docs) folder.

Presentation-friendly PDFs:
- [`01-functional-requirements-and-roles.pdf`](./docs/01-functional-requirements-and-roles.pdf)
- [`02-database-er-diagram-and-schema.pdf`](./docs/02-database-er-diagram-and-schema.pdf)
- [`03-api-calls-and-usage.pdf`](./docs/03-api-calls-and-usage.pdf)
- [`04-system-flow-overview.pdf`](./docs/04-system-flow-overview.pdf)
- [`05-aws-ec2-and-s3-setup.pdf`](./docs/05-aws-ec2-and-s3-setup.pdf)

Supporting markdown files:
- [`docs/neon-setup.md`](./docs/neon-setup.md)

## Current Status

The project currently includes:
- end-to-end exam lifecycle support
- integrity logging and manual proctor review
- evaluator and auditor workflows
- automatic report generation and S3 storage
- cloud-ready deployment structure

## Repository

GitHub:
[https://github.com/group8dbms/ExamIntegrationProject](https://github.com/group8dbms/ExamIntegrationProject)
