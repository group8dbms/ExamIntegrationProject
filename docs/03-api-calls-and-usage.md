# API Calls and Their Usage

Base backend groups:
- `/health`
- `/api/auth`
- `/api/exams`
- `/api/submissions`
- `/api/integrity`
- `/api/audit`
- `/api/documents`

## 1. Health API

### `GET /health`
Purpose:
- checks if backend is running
- checks if database is reachable

Used by:
- deployment health validation
- frontend status indicator

## 2. Authentication APIs

### `GET /api/auth/users?role=student|proctor|evaluator|auditor|admin`
Purpose:
- fetch users by role

Used by:
- admin dashboard for assigning students and faculty

### `POST /api/auth/bootstrap-user`
Purpose:
- create or update faculty/staff users

Used by:
- admin assigns `proctor`, `evaluator`, `auditor`, or `admin/instructor` access

Main inputs:
- `fullName`
- `email`
- `password`
- `role`

### `POST /api/auth/student-access`
Purpose:
- student unified registration or login flow

Behavior:
- if email does not exist, returns registration mode and creates student after full name is provided
- sends verification email automatically
- if email exists and is verified, performs login
- if email exists but is not verified, resends verification link

### `GET /api/auth/verify?token=...&redirect=student`
Purpose:
- auto-verifies student email using the mail link

Used by:
- verification email callback flow

### `POST /api/auth/login`
Purpose:
- general login for admin, proctor, evaluator, auditor, and also verified students

Main inputs:
- `email`
- `password`
- `role`

## 3. Exam APIs

### `GET /api/exams`
Purpose:
- fetch all exams with publish-state summary

Used by:
- admin publish dashboard
- admin active quiz view
- evaluator dashboard
- other exam summary screens

### `POST /api/exams`
Purpose:
- create a new exam and questions

Used by:
- admin prepare quiz page

Main inputs:
- `title`
- `description`
- `courseCode`
- `startAt`
- `endAt`
- `durationMinutes`
- `integrityThreshold`
- `createdBy`
- `studentIds`
- `questions`

### `GET /api/exams/assigned/:studentId`
Purpose:
- fetch assigned exams for a student

Used by:
- student dashboard

### `GET /api/exams/:examId/paper?studentId=...`
Purpose:
- fetch exam paper and question data for a student

Used by:
- exam start flow
- exam popup window

### `GET /api/exams/:examId/candidates`
Purpose:
- fetch students assigned to an exam

Used by:
- admin active quiz assignment management

### `POST /api/exams/:examId/candidates`
Purpose:
- assign more students to an existing exam

Used by:
- admin active quiz page

### `POST /api/exams/:examId/candidates/remove`
Purpose:
- remove assigned students from an exam

Used by:
- admin active quiz page

### `GET /api/exams/:examId/evaluation-submissions`
Purpose:
- fetch submitted answer scripts grouped under one exam

Used by:
- evaluator desk

### `POST /api/exams/:examId/evaluations/:submissionId`
Purpose:
- save evaluator marks and feedback for one submission

Used by:
- evaluator manual marking workflow

### `POST /api/exams/:examId/evaluate`
Purpose:
- auto-evaluate submissions using the answer key

Used by:
- backend support flow and evaluation logic

### `POST /api/exams/:examId/publish-results`
Purpose:
- publish all result records for an exam

Rules enforced:
- all assigned students must submit
- all submissions must be evaluated
- all opened cases must have a proctor decision

Additional behavior:
- sends result emails
- automatically uploads one `result_report` per student to S3

Used by:
- admin publish page

### `GET /api/exams/:examId/dashboard`
Purpose:
- fetch exam-level integrity and student dashboard summary

Used by:
- dashboard and reporting support

## 4. Submission APIs

### `POST /api/submissions/autosave`
Purpose:
- autosave current answers during the exam

Used by:
- student exam window

Main inputs:
- `examId`
- `studentId`
- `attemptNo`
- `currentAnswers`

### `POST /api/submissions/finalize`
Purpose:
- save final answers and mark exam as submitted

Used by:
- student final submit
- exam timeout handling

Main inputs:
- `examId`
- `studentId`
- `attemptNo`
- `finalAnswers`

## 5. Integrity APIs

### `GET /api/integrity/live-exams`
Purpose:
- fetch exams that have suspicious activity records

Used by:
- proctor dashboard

### `GET /api/integrity/dashboard`
Purpose:
- fetch dashboard-level suspicious activity summary

Used by:
- integrity overview reporting

### `GET /api/integrity/exams/:examId/live-logs`
Purpose:
- fetch flagged students and their suspicious event history for one exam

Used by:
- proctor exam drill-down page

### `POST /api/integrity/events`
Purpose:
- log one suspicious event

Used by:
- student exam popup when tab switch, IP change, or related suspicious action occurs

Main inputs:
- `examId`
- `studentId`
- `attemptNo`
- `sessionId`
- `eventType`
- `ipAddress`
- `deviceFingerprint`
- `details`

### `POST /api/integrity/events/:eventId/penalty`
Purpose:
- manually assign penalty points to one suspicious event

Used by:
- proctor penalty workflow

### `POST /api/integrity/cases/open`
Purpose:
- open or reuse a cheating investigation case for a flagged student

Used by:
- proctor dashboard

### `GET /api/integrity/cases`
Purpose:
- list integrity cases

Used by:
- case review and audit support

### `GET /api/integrity/cases/:caseId`
Purpose:
- fetch one case with evidence and actions

Used by:
- detailed investigation view

### `PATCH /api/integrity/cases/:caseId/decision`
Purpose:
- save final proctor/auditor decision for a case

Additional behavior:
- automatically generates and uploads `integrity_evidence` document to S3

Used by:
- proctor decision workflow

## 6. Audit APIs

### `GET /api/audit/logs`
Purpose:
- fetch raw audit logs with filters

Used by:
- audit review support

### `GET /api/audit/exams`
Purpose:
- fetch exam-wise audit group summary

Used by:
- auditor landing page

### `GET /api/audit/exams/:examId`
Purpose:
- fetch full audit packet for one exam

Returns:
- exam details
- student audit rows
- audit logs

Used by:
- auditor detailed report page

## 7. Document APIs

### `GET /api/documents`
Purpose:
- fetch stored document metadata

Filters:
- `examId`
- `studentId`
- `documentType`

Used by:
- auditor document table

### `POST /api/documents/upload`
Purpose:
- upload a document to S3 and store metadata

Current allowed document types:
- `result_report`
- `integrity_evidence`

Used by:
- manual testing
- backend-aligned document storage flow

### `GET /api/documents/:documentId/access-url`
Purpose:
- create a signed URL for opening a stored S3 file

Used by:
- auditor document open button

## 8. Which APIs Are Called by Which Role

| Role | Main APIs |
|---|---|
| Admin | `/api/auth/bootstrap-user`, `/api/exams`, `/api/exams/:examId/candidates`, `/api/exams/:examId/candidates/remove`, `/api/exams/:examId/publish-results` |
| Student | `/api/auth/student-access`, `/api/auth/verify`, `/api/exams/assigned/:studentId`, `/api/exams/:examId/paper`, `/api/submissions/autosave`, `/api/submissions/finalize`, `/api/integrity/events` |
| Proctor | `/api/integrity/live-exams`, `/api/integrity/exams/:examId/live-logs`, `/api/integrity/events/:eventId/penalty`, `/api/integrity/cases/open`, `/api/integrity/cases/:caseId/decision` |
| Evaluator | `/api/exams/:examId/evaluation-submissions`, `/api/exams/:examId/evaluations/:submissionId`, `/api/exams` |
| Auditor | `/api/audit/exams`, `/api/audit/exams/:examId`, `/api/documents`, `/api/documents/:documentId/access-url`, `/api/audit/logs` |

## 9. Presentation Summary
The API design is role-oriented:
- authentication APIs manage access
- exam APIs manage setup and results
- submission APIs manage answer flow
- integrity APIs manage suspicious logs and case workflow
- audit APIs manage traceability
- document APIs manage secure cloud-backed reports
