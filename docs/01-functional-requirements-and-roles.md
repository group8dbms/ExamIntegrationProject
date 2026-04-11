# Exam Integrity System

## 1. Project Scope
The project is a web-based online examination platform designed to conduct exams with strict integrity monitoring, controlled evaluation, auditable publishing, and post-exam investigation support.

The system supports:
- exam setup and scheduling
- question preparation for `MCQ` and `MSQ`
- student assignment and secure submission
- suspicious activity logging during the exam
- evaluator-based marking
- proctor-led cheating case review
- audit-friendly result and integrity reporting

## 2. Core Functional Requirements

### Exam Management
- Admin can create exams with title, course code, start time, end time, duration, and integrity threshold.
- Admin can build question papers using structured fields instead of raw JSON.
- Questions support:
  - `MCQ`: one correct answer
  - `MSQ`: multiple correct answers
- Admin can assign verified students to an exam.
- Admin can reopen active quizzes later and assign or remove students.

### Student Access and Exam Attempt
- Student can register using email, full name, and password.
- If the student email is new, the system creates the account and sends a verification email.
- Verification happens automatically by clicking the email link.
- Verified students can log in and see assigned exams.
- Exam start button remains disabled until the configured exam start time is reached.
- When the exam starts, a dedicated exam window opens and the countdown begins.
- Student answers are autosaved and can be finalized for submission.

### Integrity Monitoring
- Suspicious activity is logged only when an actual suspicious event occurs.
- Logged activities include:
  - tab switching
  - window blur/focus loss
  - IP change
  - device/browser change where detected
  - multiple login style anomalies or related suspicious actions
- Each suspicious event is stored for later review.
- The test-taker receives a local warning when such activity is detected.

### Proctor Workflow
- Proctor sees exams that contain suspicious activity.
- Proctor opens an exam and reviews flagged students.
- Proctor sees a live and historical suspicious event trail.
- Proctor manually assigns penalty points to each event.
- Proctor can open a case for a student.
- Proctor records the final case decision.
- Saving the final decision automatically generates an integrity evidence report and stores it in S3.

### Evaluation Workflow
- Evaluator sees exams that have submissions.
- Evaluator opens one exam and reviews student submissions one by one.
- Evaluator checks answers and awards marks.
- Result entries remain in draft state until all required workflows are complete.

### Result Publishing
- Admin can publish results only when:
  - all assigned students have submitted
  - all submitted students have been evaluated
  - all opened integrity cases have a proctor decision
- Publishing is grouped by exam, not student by student.
- Publishing automatically:
  - marks result entries as published
  - sends result emails to students
  - generates and uploads result reports to S3

### Audit and Integrity Reporting
- Auditor can open exam-wise audit reports.
- Auditor sees:
  - exam details
  - student-wise submission timing
  - hash verification status
  - integrity scores
  - case status and decisions
  - audit log trail
  - stored result reports and integrity evidence documents

## 3. Tech Stack

### Frontend
- React
- Vite
- JavaScript
- Custom CSS dark theme UI

### Backend
- Node.js
- Express.js
- REST API architecture

### Database
- PostgreSQL
- Neon hosted Postgres

### Cloud / Hosting
- AWS EC2 for application hosting
- Nginx for static frontend serving and reverse proxy
- PM2 for backend process management
- AWS S3 for report and evidence storage

### Supporting Services
- SMTP mail server for student verification and result mail delivery

## 4. User Roles and Detailed Responsibilities

## Admin
Admin is the main operational controller of the system.

Tasks:
- log in through the staff login panel
- assign `proctor`, `evaluator`, and `auditor` style staff access to faculty email IDs
- create exams and configure duration, date/time, and integrity threshold
- create question papers using structured form fields
- assign verified students to exams
- revisit active quizzes and update student assignment
- publish results only after evaluator and proctor workflows are complete
- trigger automatic result report generation and result email delivery

## Student
Student is the exam participant.

Tasks:
- register if first-time user
- receive and click verification email
- log in after verification
- view assigned exams
- start exam only after allowed start time
- answer questions and rely on autosave
- submit final answers within exam timing
- receive result mail after publication

## Proctor
Proctor is responsible for integrity monitoring and case handling.

Tasks:
- log in with proctor role
- open suspicious-activity exams
- inspect suspicious logs student by student
- assign penalty points to suspicious events
- open an integrity case where needed
- save decision such as `warning`, `no_issue`, `manual_review`, or `invalidate_exam`
- close the case workflow so result publication can proceed
- automatically generate integrity evidence report upon decision save

## Evaluator
Evaluator is responsible for academic marking.

Tasks:
- log in with evaluator role
- view exams with submitted answer scripts
- open exam-wise submission groups
- inspect student answers
- assign marks and save evaluation
- help move the exam toward publish-ready state

## Auditor
Auditor is responsible for compliance and traceability review.

Tasks:
- log in with auditor role
- open exam-wise audit reports
- verify submission hash status
- inspect student-level integrity summaries
- review stored result reports and integrity evidence
- inspect audit logs like start, submit, evaluate, publish, and integrity actions

## 5. Key Outputs of the System
- evaluated result records
- published results
- student result notification emails
- secure submission hash verification status
- suspicious event logs
- integrity case decisions
- S3-stored `result_report`
- S3-stored `integrity_evidence`

## 6. Presentation Summary
In one line, this project is:

> A role-based online exam platform that combines exam delivery, integrity monitoring, manual case review, secure submission verification, result publication, and audit-ready reporting.
