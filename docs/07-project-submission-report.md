# Exam Integrity System Project Submission Report

## 1. Project Title

Exam Integrity System

## 2. Project Objective

The objective of this project is to build a secure, role-based online examination platform that supports the complete exam lifecycle from exam creation to final audit review.

The system was designed to solve multiple real-world problems in online assessment:

- secure exam delivery
- student identity and access control
- suspicious activity tracking during the exam
- controlled evaluation workflow
- gated result publication
- evidence-based proctor review
- audit-ready reporting and traceability

In simple terms, this project is not only an exam portal. It is an exam lifecycle management system with integrity and audit support.

## 3. Problem Statement

Traditional online exam systems often focus only on question delivery and answer submission. They usually do not provide:

- proper role separation between admin, evaluator, proctor, and auditor
- suspicious behavior tracking
- investigation workflows
- tamper-check style submission verification
- secure report storage for later review

This project addresses those gaps by creating one integrated platform where academic workflow and integrity workflow run together.

## 4. Scope of the Project

The project covers the following areas:

- admin-controlled exam scheduling and preparation
- student registration and email verification
- role-based access for admin, student, proctor, evaluator, and auditor
- exam participation with autosave and final submission
- suspicious event logging during exam attempts
- penalty and integrity case handling by proctor
- answer evaluation and result preparation
- controlled result publication
- audit log review and stored report retrieval

## 5. Modules Implemented

## 5.1 Authentication and Access Module

This module supports:

- staff login
- student self-registration
- email verification for students
- role-based dashboard access

Implemented roles:

- Admin
- Student
- Proctor
- Evaluator
- Auditor

## 5.2 Exam Management Module

This module allows the admin to:

- create exams
- define exam title, course code, start time, end time, and duration
- set integrity threshold
- create MCQ and MSQ questions
- assign verified students to the exam
- reopen active quizzes and manage assignments

## 5.3 Student Exam Module

This module allows students to:

- view assigned exams
- start the exam only after allowed time
- open a dedicated exam window
- answer questions
- rely on autosave
- submit final answers securely

## 5.4 Integrity Monitoring Module

This module records suspicious activity such as:

- tab switching
- focus loss
- IP change
- browser or device related anomaly data where detected

It stores integrity events for later review and supports penalty assignment.

## 5.5 Proctor Investigation Module

This module allows the proctor to:

- review flagged students
- inspect suspicious event history
- assign penalty points
- open integrity cases
- save final decisions

When the proctor saves a decision, the system can generate an integrity evidence document and store it in S3.

## 5.6 Evaluation Module

This module allows the evaluator to:

- review student answers
- award marks
- save evaluation records
- move the exam toward publish-ready status

## 5.7 Result Publication Module

This module allows the admin to publish results only when:

- all assigned students have submitted
- all assigned students have been evaluated
- all open integrity cases have decisions

The publication process also:

- updates result status
- sends result emails
- generates result reports
- uploads reports to S3

## 5.8 Audit Module

This module allows the auditor to:

- review exam-wise audit reports
- inspect integrity summaries
- check submission hash verification
- review audit logs
- open stored S3-backed result reports and integrity evidence

## 6. Technology Stack Used

## 6.1 Frontend

- React
- Vite
- JavaScript
- Custom CSS

## 6.2 Backend

- Node.js
- Express.js
- REST API architecture

## 6.3 Database

- PostgreSQL
- Neon hosted Postgres

## 6.4 Cloud and Hosting

- AWS EC2
- AWS S3
- Nginx
- PM2

## 6.5 Supporting Services

- SMTP mail server
- GitHub

## 7. Dependencies Installed

## 7.1 Backend Dependencies

- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `cors`
- `dotenv`
- `express`
- `helmet`
- `morgan`
- `multer`
- `nodemailer`
- `pg`
- `nodemon` as development dependency

## 7.2 Frontend Dependencies

- `react`
- `react-dom`
- `vite`
- `@vitejs/plugin-react`
- `eslint`
- `eslint-plugin-react-hooks`
- `eslint-plugin-react-refresh`
- `@eslint/js`
- `@types/react`
- `@types/react-dom`
- `globals`

## 8. Integrations Implemented

The following integrations were completed in the project.

## 8.1 Neon PostgreSQL Integration

The backend connects to Neon using `pg.Pool` and `DATABASE_URL`.

Used for:

- transactional data
- user accounts
- exams
- submissions
- integrity events
- evaluation records
- results
- audit logs
- document metadata

## 8.2 SMTP Integration

SMTP is used for:

- student verification mail
- result publication mail

The backend creates verification links and sends them through the configured SMTP server.

## 8.3 AWS S3 Integration

S3 is used for:

- `result_report`
- `integrity_evidence`

The backend uploads generated document buffers to S3, stores metadata in PostgreSQL, and generates signed URLs for secure access.

## 8.4 EC2 Hosting Integration

EC2 is used to host:

- the backend service
- the frontend build
- server-side deployment utilities

The application runs on EC2 using:

- PM2 for backend process management
- Nginx for public access and reverse proxy

## 9. Database Design Summary

Major database entities include:

- `app_user`
- `exam`
- `question_bank`
- `question`
- `exam_question`
- `exam_candidate`
- `answer_submission`
- `integrity_event`
- `integrity_case`
- `integrity_penalty_assignment`
- `case_evidence`
- `case_action`
- `evaluation`
- `result`
- `audit_log`
- `stored_document`

The database also uses:

- `pgcrypto`
- `citext`
- functions
- triggers
- views for integrity and reporting logic

## 10. How the Project Was Developed

The project development flow can be summarized as follows:

1. design database schema and workflow entities
2. implement PostgreSQL scripts and helper functions
3. build backend API routes and services
4. build frontend role-based dashboards
5. integrate authentication and email verification
6. add suspicious event and case handling
7. add evaluation and result publication workflows
8. add S3-backed report storage
9. deploy application on EC2 using PM2 and Nginx

## 11. Deployment Summary

## 11.1 Local Setup

- clone repository
- configure `.env`
- install backend and frontend dependencies
- apply Neon schema
- run backend and frontend locally

## 11.2 Server Setup

- create Ubuntu EC2 instance
- install Node.js, npm, PM2, Nginx, Git, and AWS CLI
- attach IAM role with S3 permissions
- create S3 bucket
- clone project on EC2
- configure backend environment variables
- run backend with PM2
- build frontend with Vite
- publish frontend build through Nginx

## 11.3 Promotion Flow

- push code to GitHub
- SSH into EC2
- pull latest code
- restart backend
- rebuild and redeploy frontend
- reload Nginx

## 12. Key Features Achieved

- role-based exam platform
- email-verified student onboarding
- timed exam access
- autosave and final submission
- suspicious event capture
- manual proctor review and decision workflow
- evaluator marking
- gated result publication
- result email notification
- S3-backed generated reports
- audit-ready logs and verification records

## 13. Limitations / Environment-Specific Notes

The repository shows the application architecture clearly, but some infrastructure values are environment-specific and not stored directly in version control:

- exact EC2 instance type
- exact Nginx server block configuration
- exact public domain
- exact bucket name and AWS region used in deployment

## 14. Conclusion

The Exam Integrity System successfully combines exam management, secure submission, integrity monitoring, manual case review, result publication, and audit support in one integrated platform.

The project demonstrates full-stack development using React, Node.js, Express, PostgreSQL, AWS EC2, AWS S3, and SMTP integration. It also shows how cloud services and database logic can be used together to build a practical academic examination system with stronger integrity and reporting features than a basic exam portal.
