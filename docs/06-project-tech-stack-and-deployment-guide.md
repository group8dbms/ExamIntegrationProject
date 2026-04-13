# Project Tech Stack and End-to-End Deployment Guide

This document explains the complete technology stack used in the Exam Integrity System, the integrations implemented in the project, the dependencies installed in both frontend and backend, and the full setup and deployment flow from local development to AWS deployment.

It is based on the current repository contents, including:

- `frontend/package.json`
- `backend/package.json`
- `backend/src/...`
- `sql/...`
- `scripts/apply-neon-schema.ps1`
- `docs/05-aws-ec2-and-s3-setup.md`
- `docs/neon-setup.md`
- root `README.md`

## 1. Project Overview

The project is a full-stack role-based web application for conducting and monitoring online exams with integrity controls.

Main user roles implemented:

- Admin
- Student
- Proctor
- Evaluator
- Auditor

The system supports:

- role-based login and access
- student registration with email verification
- exam creation and student assignment
- exam attempt window with autosave and final submission
- suspicious activity logging
- proctor-based penalty and case handling
- evaluator-based marking
- result publication
- email notifications
- audit review
- document generation and S3 storage

## 2. Full Technology Stack

## 2.1 Frontend Stack

The frontend is built using:

- React
- Vite
- JavaScript (ES modules)
- Custom CSS

Frontend responsibilities:

- role-based portal UI
- student login and registration flow
- exam assignment display
- exam window launch
- admin quiz creation and publishing workflow
- proctor, evaluator, and auditor dashboards
- REST API consumption through `fetch`

Important frontend files:

- `frontend/src/App.jsx`
- `frontend/src/lib/api.js`
- `frontend/src/pages/AdminPage.jsx`
- `frontend/src/pages/StudentPage.jsx`
- `frontend/src/pages/StudentExamWindow.jsx`
- `frontend/src/pages/ProctorPage.jsx`
- `frontend/src/pages/EvaluatorPage.jsx`
- `frontend/src/pages/AuditorPage.jsx`

## 2.2 Backend Stack

The backend is built using:

- Node.js
- Express.js
- PostgreSQL client library `pg`
- REST APIs

Backend responsibilities:

- authentication and login APIs
- student registration and verification flow
- exam management APIs
- submission APIs
- integrity event and case APIs
- evaluation and result publishing APIs
- audit data APIs
- document upload and signed URL APIs
- SMTP email sending
- S3 integration

Important backend files:

- `backend/src/app.js`
- `backend/src/server.js`
- `backend/src/config/env.js`
- `backend/src/db/pool.js`
- `backend/src/routes/auth-routes.js`
- `backend/src/routes/exam-routes.js`
- `backend/src/routes/submission-routes.js`
- `backend/src/routes/integrity-routes.js`
- `backend/src/routes/audit-routes.js`
- `backend/src/routes/documents-routes.js`
- `backend/src/services/mail-service.js`
- `backend/src/services/storage-service.js`
- `backend/src/services/document-service.js`

## 2.3 Database Stack

The database used is:

- PostgreSQL
- Neon hosted Postgres

Database responsibilities:

- users and roles
- exams and scheduling
- question banks and exam questions
- student assignments
- autosaved and final answer submissions
- suspicious event logging
- integrity cases
- evaluation records
- final results
- audit logs
- stored S3 document metadata

SQL assets used in the project:

- `sql/000_full_schema.sql`
- `sql/001_extensions.sql`
- `sql/002_schema.sql`
- `sql/003_functions_triggers_views.sql`
- `sql/004_smoke_test.sql`
- `sql/005_auth_verification.sql`
- `sql/005_manual_proctor_penalties.sql`
- `sql/006_stored_documents.sql`

Postgres extensions explicitly used:

- `pgcrypto`
- `citext`

## 2.4 Cloud and Deployment Stack

Cloud and infrastructure services used in the project:

- AWS EC2
- AWS S3
- Nginx
- PM2
- GitHub
- Neon Postgres

Purpose of each:

- `EC2`: hosts the application server
- `S3`: stores generated result reports and integrity evidence files
- `Nginx`: serves frontend static files and reverse proxies API calls
- `PM2`: keeps the backend process alive
- `GitHub`: source code hosting and deployment source
- `Neon`: managed PostgreSQL database

## 2.5 External Service Integrations

The application integrates with:

- SMTP mail server
- AWS S3
- Neon PostgreSQL

These integrations are implemented directly in backend code.

## 3. Dependencies Installed

## 3.1 Backend Dependencies

From `backend/package.json`, the backend dependencies are:

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

Backend development dependency:

- `nodemon`

Why these were installed:

- `@aws-sdk/client-s3`: upload, download, and delete objects in S3
- `@aws-sdk/s3-request-presigner`: generate secure signed download URLs
- `cors`: allow frontend-to-backend communication
- `dotenv`: load environment variables from `.env`
- `express`: build the backend API server
- `helmet`: add secure HTTP headers
- `morgan`: request logging
- `multer`: handle file uploads in memory
- `nodemailer`: send verification and result emails
- `pg`: connect to PostgreSQL / Neon
- `nodemon`: auto-restart backend during development

## 3.2 Frontend Dependencies

From `frontend/package.json`, the frontend dependencies are:

- `react`
- `react-dom`

Frontend development dependencies:

- `@eslint/js`
- `@types/react`
- `@types/react-dom`
- `@vitejs/plugin-react`
- `eslint`
- `eslint-plugin-react-hooks`
- `eslint-plugin-react-refresh`
- `globals`
- `vite`

Why these were installed:

- `react`: build the UI
- `react-dom`: render the React app in the browser
- `vite`: frontend dev server and production build tool
- `@vitejs/plugin-react`: React support for Vite
- `eslint` and plugins: linting and code quality
- `@types/react` and `@types/react-dom`: editor and tooling support
- `globals`: lint environment definitions

## 4. Project Structure

```text
DBMSProject/
|-- backend/
|   |-- src/
|   |   |-- config/
|   |   |-- db/
|   |   |-- middleware/
|   |   |-- routes/
|   |   |-- services/
|   |-- package.json
|   |-- .env.example
|
|-- frontend/
|   |-- src/
|   |   |-- assets/
|   |   |-- lib/
|   |   |-- pages/
|   |-- public/
|   |-- package.json
|
|-- sql/
|-- scripts/
|-- docs/
|-- README.md
```

## 5. Integrations Implemented

## 5.1 Frontend to Backend Integration

The frontend calls the backend using the helper in:

- `frontend/src/lib/api.js`

This file defines a reusable API wrapper around `fetch`.

Current behavior:

- all requests go through `fetch`
- JSON content type is added automatically
- non-200 responses are converted into JavaScript errors

Important note:

- the current API base is hardcoded as `http://127.0.0.1:4000`
- this works for local development
- for public production deployment, this usually needs to be changed to the public API URL or proxied through Nginx

## 5.2 Backend to Neon Postgres Integration

The backend connects to Neon using:

- `backend/src/db/pool.js`

Implementation details:

- uses `pg.Pool`
- reads `DATABASE_URL` from environment variables
- enables SSL automatically when `sslmode=require` is present

Environment loading is handled in:

- `backend/src/config/env.js`

This file searches for `.env` in:

- `backend/.env`
- project root `.env`
- one more parent location as fallback

## 5.3 SMTP Email Integration

Email integration is implemented in:

- `backend/src/services/mail-service.js`

Used for:

- student account verification email
- result publication email

Flow implemented:

1. student registers through `/api/auth/student-access`
2. backend creates verification token
3. backend sends verification email through SMTP
4. student clicks verification link
5. backend marks email as verified
6. frontend redirects student back to login flow

When results are published:

1. admin publishes an exam’s results
2. backend updates result status to `published`
3. backend sends result emails to students
4. mail content includes marks, percentage, integrity score, case status, and hash verification status

Required SMTP environment variables:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## 5.4 AWS S3 Integration

S3 integration is implemented in:

- `backend/src/services/storage-service.js`
- `backend/src/services/document-service.js`
- `backend/src/routes/documents-routes.js`

Used for:

- `result_report`
- `integrity_evidence`

What happens in this integration:

- backend uploads generated files to S3
- backend stores metadata in `stored_document`
- backend can generate signed access URLs for secure download
- backend can replace old stored files when newer ones are generated

Document metadata stored in Postgres includes:

- exam id
- student id
- case id
- document type
- S3 object key
- original file name
- content type
- uploaded by
- created at

Environment variables used:

- `AWS_REGION`
- `S3_BUCKET`
- `MAX_UPLOAD_SIZE_BYTES`

## 5.5 Audit Logging Integration

Audit behavior is used across the backend through service calls like:

- `writeAuditLog(...)`

Audit records are written for actions such as:

- student registration
- exam creation
- exam assignment
- evaluation
- result publication
- integrity event logging
- penalty assignment
- case decisions
- document upload

This gives the project an audit-ready history of important actions.

## 5.6 Integrity and Hash Verification Integration

The project includes database-driven integrity logic.

Implemented features:

- suspicious event logging
- penalty assignment
- integrity case opening
- proctor decision capture
- submission hash verification

Database logic mentioned in existing docs:

- `answer_submission.submission_hash` stores SHA-256 digest
- `verify_submission_hash(uuid)` recomputes and verifies the final submission payload
- `integrity_event` records affect suspicion score
- case state is exposed through views such as `v_candidate_integrity_summary`

## 6. How the Application Was Built From Start to End

This section describes the practical build flow of the project.

## 6.1 Step 1: Create the Database Design

The first major layer of the project is the database.

Work done:

- designed user and role tables
- designed exam and question structures
- designed submission and evaluation structures
- designed integrity event and case structures
- designed audit and stored document structures
- added views, triggers, and helper functions

Files used:

- `sql/001_extensions.sql`
- `sql/002_schema.sql`
- `sql/003_functions_triggers_views.sql`
- `sql/006_stored_documents.sql`

## 6.2 Step 2: Prepare the Backend APIs

After the schema, the backend APIs were built using Express.

Route groups created:

- `/health`
- `/api/auth`
- `/api/exams`
- `/api/submissions`
- `/api/integrity`
- `/api/audit`
- `/api/documents`

Backend features implemented:

- environment loading
- database pool creation
- secure middleware setup
- role-specific APIs
- validation and transactional DB writes
- integrations with email and S3

Middleware used:

- `helmet`
- `cors`
- `express.json`
- `morgan`
- custom async and error handling middleware

## 6.3 Step 3: Build the Frontend Role-Based UI

The frontend was then built as a single React application with separate role workspaces.

UI areas implemented:

- access portal
- admin workspace
- student workspace
- exam window
- proctor workspace
- evaluator workspace
- auditor workspace

Frontend development pattern:

- React state with hooks
- page-level components in `src/pages`
- reusable API helper in `src/lib/api.js`
- Vite for local development and production build

## 6.4 Step 4: Add Student Verification and Staff Access

Authentication behavior implemented:

- staff accounts can be bootstrapped by admin
- students can self-register
- students must verify email before active use
- login returns role-aware user information

Backend endpoints involved:

- `POST /api/auth/bootstrap-user`
- `POST /api/auth/student-access`
- `GET /api/auth/verify`
- `POST /api/auth/login`

## 6.5 Step 5: Add Exam Lifecycle Features

The core exam flow implemented in the project is:

1. admin creates exam
2. admin adds questions
3. admin assigns students
4. student sees assigned exams
5. student starts exam in allowed time window
6. answers are autosaved
7. final submission is saved
8. evaluator evaluates submission
9. proctor resolves any integrity cases
10. admin publishes results
11. auditor reviews logs and stored evidence

## 6.6 Step 6: Add Integrity Monitoring

Integrity monitoring includes:

- event logging for suspicious activity
- penalty assignment by proctor
- score updates on candidates
- integrity case opening
- decision recording
- evidence generation

Important backend endpoints:

- `POST /api/integrity/events`
- `POST /api/integrity/events/:eventId/penalty`
- `POST /api/integrity/cases/open`
- `PATCH /api/integrity/cases/:caseId/decision`

## 6.7 Step 7: Add Result Publication and S3-backed Reports

When results are published:

1. backend checks all students are assigned
2. backend checks all students submitted
3. backend checks all students are evaluated
4. backend checks all opened cases have decisions
5. backend publishes each result
6. backend generates a result report
7. backend uploads the report to S3
8. backend stores S3 metadata in Postgres
9. backend optionally sends result email

When a proctor saves a case decision:

1. backend updates the case
2. backend reads related suspicious events
3. backend generates integrity evidence text
4. backend uploads it to S3
5. backend stores metadata in `stored_document`
6. backend links the evidence to the case

## 7. How the Database Was Created on Neon

The repository already includes two ways to apply schema.

## 7.1 Option A: Neon SQL Editor

This is the easiest method used in the project docs.

Steps:

1. create a Neon project
2. create a database
3. copy the connection string
4. open Neon SQL Editor
5. run `sql/000_full_schema.sql`
6. optionally run `sql/004_smoke_test.sql`

This creates:

- extensions
- tables
- enums
- functions
- triggers
- views
- stored document table

## 7.2 Option B: Apply Schema Using PowerShell Script

Script used:

- `scripts/apply-neon-schema.ps1`

What the script does:

- reads `DATABASE_URL`
- checks `psql` availability
- applies:
  - `sql/001_extensions.sql`
  - `sql/002_schema.sql`
  - `sql/003_functions_triggers_views.sql`

Typical usage:

```powershell
.\scripts\apply-neon-schema.ps1 -DatabaseUrl "postgresql://..."
```

Or:

```powershell
$env:DATABASE_URL="postgresql://..."
.\scripts\apply-neon-schema.ps1
```

## 8. Environment Variables Used

## 8.1 Root `.env.example`

The root example currently contains:

```env
DATABASE_URL=postgresql://<user>:<password>@<endpoint>/<db>?sslmode=require
```

## 8.2 Backend `.env.example`

The backend example currently contains:

```env
PORT=4000
DATABASE_URL=postgresql://<user>:<password>@<endpoint>/<db>?sslmode=require
FRONTEND_URL=http://127.0.0.1:5173
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Exam Integrity <no-reply@example.com>"
```

For AWS-backed storage and document uploads, the README also requires:

```env
AWS_REGION=your-region
S3_BUCKET=your-bucket-name
MAX_UPLOAD_SIZE_BYTES=10485760
```

## 9. Local Development Setup From Start to End

## 9.1 Clone the Repository

```powershell
git clone https://github.com/group8dbms/ExamIntegrationProject.git
cd ExamIntegrationProject
```

## 9.2 Prepare Backend Environment

Create backend environment file:

```powershell
cd backend
Copy-Item .env.example .env
```

Then set:

- `DATABASE_URL`
- `FRONTEND_URL`
- SMTP values if email is needed
- AWS values if S3 is needed

## 9.3 Install Backend Dependencies

```powershell
cd backend
npm install
```

This installs:

- Express backend dependencies
- Postgres client
- SMTP library
- AWS SDK libraries
- development tools like Nodemon

## 9.4 Install Frontend Dependencies

```powershell
cd frontend
npm install
```

This installs:

- React
- React DOM
- Vite
- linting and frontend tooling packages

## 9.5 Apply Database Schema

Either:

- run the SQL in Neon SQL Editor

Or:

```powershell
cd C:\Users\bunty\OneDrive\Desktop\DBMSProject
.\scripts\apply-neon-schema.ps1
```

## 9.6 Start Backend

```powershell
cd backend
npm run dev
```

Backend default port:

- `4000`

## 9.7 Start Frontend

```powershell
cd frontend
npm run dev
```

Frontend default Vite port:

- normally `5173`

## 10. How EC2 Was Created and Used

The repo documentation shows that one Ubuntu EC2 instance was used to host the application.

## 10.1 Why EC2 Was Chosen

Reasons:

- simple full control of server
- can host frontend and backend together
- suitable for demo / academic deployment
- easy to connect with GitHub, PM2, and Nginx

## 10.2 EC2 Setup Flow

The exact instance size, AMI version, and security groups are not stored in the repository, but the deployment flow in project docs implies the following standard setup:

1. create an Ubuntu EC2 instance in AWS
2. allow SSH access in security group
3. allow HTTP and optionally HTTPS access
4. download the `.pem` key file
5. SSH into the server
6. install runtime software

Main software installed on EC2:

- Node.js
- npm
- PM2
- Nginx
- Git
- AWS CLI

Typical installation flow on Ubuntu:

```bash
sudo apt update
sudo apt install -y git nginx awscli
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 10.3 IAM Role Attachment for EC2

The project docs state that an IAM role was attached to the EC2 instance for S3 access.

This means:

- AWS access keys do not need to be stored in code
- the Node.js backend can use the instance role automatically
- S3 permissions are controlled through IAM policy

Typical IAM process:

1. create IAM role
2. choose trusted entity `EC2`
3. grant S3 permissions required by the app
4. attach role to the EC2 instance

## 11. How S3 Was Created and Used

The project uses S3 only for generated documents, not for raw exam answers.

## 11.1 S3 Bucket Creation Flow

Typical setup flow used for this project:

1. open AWS S3
2. create a new bucket
3. choose AWS region
4. choose a globally unique bucket name
5. keep bucket for private server-side access
6. use IAM permissions through EC2 role

## 11.2 What Is Stored in S3

The application stores:

- result reports
- integrity evidence reports

Object key format is created in backend code and follows patterns like:

- `reports/<examId>/<studentId>/<timestamp>-<fileName>`
- `integrity-evidence/<examId>/<studentId>/<timestamp>-<fileName>`

## 11.3 How S3 Access Works in This Project

Flow:

1. backend generates file content in memory
2. backend uploads buffer to S3
3. backend stores metadata in `stored_document`
4. auditor requests the document
5. backend generates a signed URL
6. browser opens the file securely

## 12. How Frontend and Backend Were Promoted to Server

In this project, promotion means pushing the code to GitHub and updating the EC2-hosted deployment.

## 12.1 Backend Promotion Flow

Backend promotion flow:

1. pull latest code on EC2
2. install dependencies if changed
3. restart the backend through PM2

Typical commands:

```bash
cd /home/ubuntu/ExamIntegrationProject/backend
npm install
pm2 restart exam-integrity-backend
```

Backend PM2 process example:

```bash
pm2 start src/server.js --name exam-integrity-backend
pm2 save
pm2 startup
```

## 12.2 Frontend Promotion Flow

Frontend promotion flow:

1. pull latest code on EC2
2. install dependencies if changed
3. create production build using Vite
4. copy `dist/` output into Nginx web root
5. reload Nginx

Typical commands:

```bash
cd /home/ubuntu/ExamIntegrationProject/frontend
npm install
npm run build
sudo rsync -av --delete dist/ /var/www/exam-integrity/
sudo systemctl reload nginx
```

## 12.3 Nginx Responsibility in Promotion

Nginx serves:

- the built frontend files
- reverse proxy for backend API routes

Deployment model:

- frontend static assets are public through Nginx
- backend remains on port `4000`
- Nginx forwards `/api/...` requests to backend

## 13. Recommended End-to-End Deployment Sequence

This is the clean full sequence from zero to live server.

1. build database schema in Neon
2. prepare backend `.env`
3. prepare frontend and backend locally
4. verify local app works
5. create EC2 instance
6. install Node.js, PM2, Nginx, Git, AWS CLI
7. create S3 bucket
8. attach IAM role to EC2 with S3 permissions
9. clone project on EC2
10. configure backend environment variables on EC2
11. run backend with PM2
12. build frontend with Vite
13. publish frontend build to Nginx web root
14. reload Nginx
15. test login, exam flow, email, result publication, and document download

## 14. Complete Deployment Update Flow

Whenever a new version is ready:

1. push code to GitHub
2. SSH into EC2
3. pull latest code
4. update backend dependencies if needed
5. restart PM2 backend
6. update frontend dependencies if needed
7. rebuild frontend
8. sync `dist/` to Nginx folder
9. reload Nginx
10. verify app health and dashboards

Commands:

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

## 15. Summary

This project uses a modern but practical academic full-stack architecture:

- React + Vite on the frontend
- Node.js + Express on the backend
- Neon PostgreSQL as managed relational database
- SMTP for email verification and result notifications
- AWS S3 for generated result and evidence documents
- AWS EC2 for deployment
- PM2 for backend process management
- Nginx for frontend hosting and reverse proxying

From start to end, the implementation flow was:

1. design schema in PostgreSQL
2. build backend APIs
3. build role-based frontend
4. integrate email verification
5. integrate integrity monitoring
6. integrate evaluation and publishing
7. integrate S3-backed document storage
8. deploy on EC2 with PM2 and Nginx

## 16. Operational Notes

The repository gives strong evidence for the application architecture and deployment flow, but a few infrastructure details are not version-controlled:

- exact EC2 instance type
- exact security group rules
- exact Nginx config file contents
- exact bucket name and AWS region used in the live deployment

Those can be added later if you want an environment-specific production runbook.
