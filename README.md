# Exam Integrity System

Exam Integrity System is a role-based online examination platform for managing the full exam lifecycle: exam creation, student assignment, secure attempt handling, evaluation, integrity review, result publishing, auditing, and cloud-backed document storage.

It is built for institutions that want controlled online exams with accountability across `admin`, `student`, `evaluator`, `proctor`, and `auditor` roles.

## What The App Does

- creates and manages online exams with time windows and question papers
- assigns students and staff to exams through role-based workflows
- allows students to take exams in a dedicated exam window with autosave and secure submission
- logs suspicious events such as tab switches, focus loss, and attempt closure
- lets proctors review suspicious activity, assign penalties, and close integrity cases
- lets evaluators mark submissions and review recheck requests
- blocks result publication until required approvals, evaluations, and integrity decisions are complete
- sends verification and result emails
- stores generated reports and integrity evidence in AWS S3 when configured
- gives auditors an audit-ready view of logs, evidence, status transitions, and stored documents

## Main Roles

### Admin
- assigns faculty roles such as `proctor`, `evaluator`, and `auditor`
- creates quizzes and exams with title, course code, timing, duration, and integrity threshold
- builds question papers using structured `MCQ` and `MSQ` fields
- assigns students while filtering for active and email-verified users
- reopens closed attempts through a proctor-approved reassign workflow
- requests and approves result publication
- publishes final results only when all rules are satisfied

### Student
- registers and verifies account through email
- views assigned exams and their current status
- starts exams only during the valid exam window
- answers questions in a dedicated exam window
- grants webcam and screen-sharing permission inside the exam popup before attempting
- benefits from background autosave and manual autosave
- submits the final attempt securely
- sees attempt status such as assigned, attempted, closed, submitted, graded, or not appeared
- can request recheck after results are published when enabled

### Evaluator
- opens evaluated exam queues by exam
- reviews each student submission question by question
- enters marks and comments
- handles recheck review workflows
- sees auto-evaluated no-show and closed attempts as already evaluated
- cannot edit marks for auto-evaluated zero-mark attempts

### Proctor
- reviews flagged exams and suspicious student activity
- sees suspicious events row-wise per student in one compact review card
- assigns penalty points and notes to individual suspicious events
- opens integrity cases and records proctor decisions
- generates integrity evidence when case decisions are saved
- approves admin requests to reopen closed or interrupted attempts
- monitors live shared-screen and webcam snapshot boards per current exam
- opens stored integrity reports, shared-screen evidence, and webcam evidence directly from the dashboard

### Auditor
- reviews audit logs and exam-wise audit summaries
- checks integrity case history and decisions
- verifies submission hashes
- opens stored result reports and integrity evidence documents
- reviews workflow events for transparency and accountability

## Core Functionalities

### 1. Authentication And User Management
- student self-registration
- verification email flow with verification links
- role-based login and dashboards
- active/inactive and verified/unverified user filtering

### 2. Exam Creation And Management
- create exams with title and course code
- set start time, end time, and duration
- define integrity threshold
- build question papers using structured forms
- support `MCQ` and `MSQ` question types
- preview created questions before saving

### 3. Reusable Question Bank
- stores reusable questions for future exams
- tags questions with the course code used when they were created
- previews question bank questions directly inside quiz creation
- searches question bank items by prompt text and course-code tag
- adds question bank questions directly into a new quiz
- paginates the question bank so long banks remain usable

### 4. Student Assignment
- assign students during quiz creation
- assign more students later to already active quizzes
- hide already assigned students from the add-more list
- remove assigned students when needed
- show selected and already assigned students in compact readable lists

### 5. Student Exam Window
- dedicated exam-taking interface
- countdown timer
- question navigation
- autosave in the background
- manual `Autosave Now` action
- manual autosave success notification shown only on manual click
- final submission flow
- webcam enforcement inside the popup window
- screen-sharing enforcement inside the popup window
- automatic face-presence monitoring inside the webcam stream
- periodic webcam and shared-screen evidence capture

### 6. Attempt Safety And Closure Logic
- detects when an exam attempt is closed unexpectedly
- marks the attempt as `closed`
- prevents closed attempts from being restarted automatically
- prevents countdown restart for already closed attempts
- keeps closure state visible in student and admin flows

### 7. Suspicious Activity Monitoring
- logs suspicious actions during the exam
- tracks tab switches
- tracks focus loss and exit-screen events
- tracks webcam-denied or webcam-disconnected states
- tracks screen-share denied or stopped states
- tracks when no face is detected continuously in the webcam for the configured threshold
- records IP-related and device-related details
- surfaces warnings to the student in the exam window
- preserves all events for later proctor and auditor review

### 8. No-Show And Closed-Attempt Auto Evaluation
- if the exam deadline passes and a student never appeared, the system marks the attempt as `not appeared`
- no-show students are automatically assigned `0` marks
- if an attempt is closed, the system can also auto-assign `0` marks
- auto-generated zero-mark cases are marked as evaluated so result publication is not blocked
- evaluator sees these cases as completed rather than pending

### 9. Proctor Review And Integrity Cases
- flagged exams are shown in the proctor dashboard
- each flagged student can be reviewed with all suspicious rows in one place
- device info and event details are shown without overflowing the UI
- penalties can be assigned event by event
- integrity cases can be opened, updated, and closed
- case decisions are recorded before publishing
- current-exam monitoring tabs show live-updating shared-screen and webcam tiles
- proctors can open stored evidence files directly from closed case reviews

### 10. Reassign And Reopen Workflow
- admin gets a separate tab to review student attempts and request reopening
- only eligible attempted or closed cases can be raised for reassign approval
- proctor gets a separate approval queue for reassign requests
- approved requests reset the blocked attempt and allow the same exam to be started again
- workflow state is visible to admin and proctor

### 11. Evaluation Workflow
- evaluator opens submissions exam-wise
- marks descriptive or manually reviewed responses
- sees automatically handled cases correctly labeled
- auto-evaluated `not appeared` and `closed attempt` submissions are frozen
- frozen zero-mark submissions cannot be edited by evaluator

### 12. Result Approval And Publishing
- publication requires assignment progress, evaluation completion, and case resolution
- one admin can request approval for publishing
- another admin can approve publishing
- publish button stays disabled and greyed out until approval is obtained
- request approval remains active and highlighted when action is needed
- publication sends result emails
- failed outcomes are clearly reflected in result emails

### 13. Student Result And Recheck Support
- students can view published results
- result state includes pass/fail outcomes
- recheck workflow is available for review where supported

### 14. Audit And Evidence
- workflow actions are tracked for auditor visibility
- integrity reports and result reports are generated
- generated documents can be stored in S3 when configured
- auditors can review stored document metadata and evidence trails
- submission hash verification supports audit confidence
- webcam snapshots and shared-screen snapshots are stored as evidence documents
- result publication re-verifies submission hashes before report generation

### 15. UI And Usability Improvements
- compact row-based proctor review cards
- reduced overflow from long device fingerprints and metadata
- smaller and cleaner assignment cards across admin flows
- denser student selection, assigned lists, and reassign views
- better readability in quiz preparation and management screens

## New Functionalities Added Recently

The latest round of changes added the following:

- fixed the exam submit flow where the submit button was not working correctly
- manual autosave now shows a success notification inside the exam window
- closed attempts are blocked from restarting
- no-show students after deadline are auto-marked as `not appeared`, assigned `0`, and marked evaluated
- closed attempts can also be auto-assigned `0` and treated as evaluated
- evaluator cannot edit marks after `Save Marks`, and auto-evaluated zero-mark cases stay frozen
- admin can request reassign for interrupted or closed attempts
- proctor can approve reassign requests from a dedicated tab
- result publishing is locked until approval is obtained, and once approved only the publish action remains active
- failed students now receive correct failed-result email wording
- question bank questions now carry course-code tags
- question bank search supports subject-wise reuse
- question bank preview and selection now support pagination
- proctor suspicious-event review is shown row-wise inside one card per student
- admin assignment and reassign interfaces are more compact and easier to scan
- integrity threshold logic was restored so suspicious-score breaches auto-open or refresh integrity cases again
- admin `Quizzes Active` now hides exams whose end time has already passed
- publish flow re-verifies submission hashes just before generating reports
- hash verification failures now withhold the result and instruct the student to contact the proctor or admin instead of publishing a normal result
- student exam popup now enforces webcam and shared-screen permission inside the exam window
- webcam and screen-share stop events block continued answering until restored
- webcam snapshots and shared-screen snapshots are captured every `5` seconds and stored through the document pipeline
- webcam monitoring now checks for face presence and logs a `face_absent` integrity event after `10` seconds of continuous absence
- when a `face_absent` event is logged, the system uploads webcam evidence and auto-opens or reuses an integrity case for proctor review
- student webcam panel now shows the active detection engine and a no-face debug timer for easier live testing
- proctor dashboard now has dedicated current-exam tiles for shared-screen and webcam evidence, refreshing with the latest snapshot per student

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

### Infrastructure
- AWS EC2
- Nginx
- PM2
- AWS S3

### Notifications
- SMTP for account verification and result mail delivery

## System Flow

```text
Admin -> creates exam -> assigns students and staff
Student -> verifies account -> starts exam -> answers saved during attempt
System -> logs suspicious actions and attempt state changes
Proctor -> reviews suspicious events -> assigns penalties -> records decisions
Evaluator -> marks submissions or sees auto-evaluated zero-mark cases
Admin -> requests approval -> approves -> publishes results
Auditor -> reviews logs, hashes, evidence, and stored reports
```

## Backend Route Areas

- `/health`
- `/api/auth`
- `/api/exams`
- `/api/submissions`
- `/api/integrity`
- `/api/audit`
- `/api/documents`

## Repository Structure

```text
backend/    Express backend and business logic
frontend/   React frontend
sql/        PostgreSQL schema, triggers, and helper scripts
docs/       Project documentation and presentation PDFs
scripts/    Utility scripts and generators
```

## Database Coverage

The PostgreSQL schema supports:

- users, roles, and sessions
- exam scheduling and candidate assignment
- reusable questions and exam questions
- autosaved and final submissions
- suspicious event logging
- integrity cases and decisions
- evaluator marks and final results
- audit logs
- stored document metadata

Important SQL files:

- `sql/000_full_schema.sql`
- `sql/001_extensions.sql`
- `sql/002_schema.sql`
- `sql/003_functions_triggers_views.sql`
- `sql/004_smoke_test.sql`
- `sql/005_auth_verification.sql`
- `sql/005_manual_proctor_penalties.sql`
- `sql/006_stored_documents.sql`

## Local Setup

### 1. Clone

```powershell
git clone https://github.com/group8dbms/ExamIntegrationProject.git
cd ExamIntegrationProject
```

### 2. Configure Environment Variables

Create `.env` files as needed and provide:

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

### 3. Prepare Database

Fastest route:

- open the Neon SQL editor
- run `sql/000_full_schema.sql`
- optionally run `sql/004_smoke_test.sql`

### 4. Run Backend

```powershell
cd backend
npm install
npm run dev
```

### 5. Run Frontend

```powershell
cd frontend
npm install
npm run dev
```

## Deployment Summary

This project is deployed with:

- frontend served by Nginx
- backend managed by PM2
- Neon as hosted PostgreSQL
- S3 as generated document storage

Typical server update flow:

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

When configured, the system stores these document types in S3:

- `result_report`
- `integrity_evidence`
- `screen_share_evidence`
- `webcam_evidence`

Their metadata remains in PostgreSQL so the application can retrieve and audit them.

## Documentation

Project documents are available in the [`docs`](./docs) folder.

Presentation PDFs:

- [`01-functional-requirements-and-roles.pdf`](./docs/01-functional-requirements-and-roles.pdf)
- [`02-database-er-diagram-and-schema.pdf`](./docs/02-database-er-diagram-and-schema.pdf)
- [`03-api-calls-and-usage.pdf`](./docs/03-api-calls-and-usage.pdf)
- [`04-system-flow-overview.pdf`](./docs/04-system-flow-overview.pdf)
- [`05-aws-ec2-and-s3-setup.pdf`](./docs/05-aws-ec2-and-s3-setup.pdf)

Supporting markdown:

- [`docs/neon-setup.md`](./docs/neon-setup.md)
- [`docs/11-installation-and-deployment-guide.md`](./docs/11-installation-and-deployment-guide.md)

## Repository

GitHub:
[https://github.com/group8dbms/ExamIntegrationProject](https://github.com/group8dbms/ExamIntegrationProject)
