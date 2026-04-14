# Installation and Deployment Guide

This document is the project runbook for setting up the Exam Integrity System from scratch.

It covers:

- importing the project from GitHub
- local environment setup
- dependency installation
- PostgreSQL / Neon database setup
- the exact SQL files to run
- AWS S3 bucket setup
- EC2 server setup
- PM2 and Nginx configuration
- the exact EC2 commands used to install and deploy the project

## 1. Project Stack

This project uses the following stack:

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL on Neon
- File storage: AWS S3
- Deployment: AWS EC2 + PM2 + Nginx
- Email: SMTP

## 2. Repository Import From GitHub

Clone the project to your local machine:

```powershell
git clone https://github.com/group8dbms/ExamIntegrationProject.git
cd ExamIntegrationProject
```

If you are working from a ZIP instead of GitHub, extract the project and open the root folder.

## 3. Prerequisites

Install the following before starting:

- Node.js LTS
- npm
- Git
- PostgreSQL client tools if you want to apply SQL from terminal using `psql`
- A Neon Postgres project
- An SMTP account for verification and result emails
- An AWS account for EC2 and S3

Recommended versions:

- Node.js 18 LTS or newer
- npm 9 or newer

## 4. Project Structure

Important folders:

- `backend/` for the Express API
- `frontend/` for the React UI
- `sql/` for schema and migration SQL files
- `scripts/` for helper scripts
- `docs/` for project documentation

## 5. Environment Variable Setup

## 5.1 Root `.env`

The root example file contains:

```env
DATABASE_URL=postgresql://<user>:<password>@<endpoint>/<db>?sslmode=require
```

The backend loader can read `.env` from:

- `backend/.env`
- project root `.env`

Preferred approach:

- keep a full backend config in `backend/.env`

## 5.2 Backend `.env`

Create the backend environment file:

```powershell
cd backend
Copy-Item .env.example .env
```

Update it with real values:

```env
PORT=4000
DATABASE_URL=postgresql://<user>:<password>@<endpoint>/<db>?sslmode=require
FRONTEND_URL=http://127.0.0.1:5173
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Exam Integrity <no-reply@example.com>"
AWS_REGION=ap-south-1
S3_BUCKET=your-s3-bucket-name
MAX_UPLOAD_SIZE_BYTES=10485760
```

Meaning of each variable:

- `PORT`: backend port, default `4000`
- `DATABASE_URL`: Neon / PostgreSQL connection string
- `FRONTEND_URL`: frontend URL used for email verification redirect
- `SMTP_HOST`: SMTP server hostname
- `SMTP_PORT`: SMTP port, usually `587` or `465`
- `SMTP_USER`: SMTP username
- `SMTP_PASS`: SMTP password or app password
- `SMTP_FROM`: sender name and email
- `AWS_REGION`: AWS region of the S3 bucket
- `S3_BUCKET`: S3 bucket name for generated files
- `MAX_UPLOAD_SIZE_BYTES`: document upload size limit

## 5.3 Frontend Configuration Note

The frontend currently does not use a `.env` file for its API URL.

The API base is hardcoded in:

- `frontend/src/lib/api.js`

Current code:

```js
export const API_BASE = "http://127.0.0.1:4000";
```

What this means:

- local development works as-is
- production deployment on EC2 will not work correctly in a browser unless this value is changed before building the frontend

Recommended production change:

- change `API_BASE` to your public backend URL, or
- if Nginx is reverse proxying `/api`, change it to an empty base or a same-origin path strategy

Example:

```js
export const API_BASE = "";
```

That allows calls like `/api/exams` to go through the same EC2 host when Nginx is configured as a reverse proxy.

## 6. Installing Dependencies Locally

## 6.1 Backend Dependencies

Install backend dependencies:

```powershell
cd backend
npm install
```

This installs the packages defined in `backend/package.json`, including:

- `express`
- `pg`
- `nodemailer`
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `cors`
- `helmet`
- `morgan`
- `multer`
- `dotenv`
- `nodemon`

## 6.2 Frontend Dependencies

Install frontend dependencies:

```powershell
cd frontend
npm install
```

This installs the packages defined in `frontend/package.json`, including:

- `react`
- `react-dom`
- `vite`
- `eslint`

## 7. Database Setup

The application uses Neon PostgreSQL.

There are two setup approaches:

- Option A: run SQL directly in the Neon SQL editor
- Option B: apply SQL using `psql`

## 7.1 Important Schema Note

For the current state of this repository, do not rely only on:

- `sql/000_full_schema.sql`
- or `scripts/apply-neon-schema.ps1`

Reason:

- the current backend code depends on later schema updates for:
  - email verification columns
  - manual proctor penalty assignments
  - S3 document metadata storage

Those are defined in:

- `sql/005_auth_verification.sql`
- `sql/005_manual_proctor_penalties.sql`
- `sql/006_stored_documents.sql`

So the safest setup is to run the individual SQL files in the exact order shown below.

## 7.2 Exact SQL Files To Run

Run these SQL files in this order:

1. `sql/001_extensions.sql`
2. `sql/002_schema.sql`
3. `sql/003_functions_triggers_views.sql`
4. `sql/005_auth_verification.sql`
5. `sql/005_manual_proctor_penalties.sql`
6. `sql/006_stored_documents.sql`

Optional verification file:

7. `sql/004_smoke_test.sql`

Why this order matters:

- `001` creates required PostgreSQL extensions
- `002` creates tables, enums, and base schema
- `003` creates functions, triggers, and views
- `005_auth_verification` adds student verification columns used by auth routes
- `005_manual_proctor_penalties` adds the penalty assignment table used by proctor workflows
- `006_stored_documents` adds the S3 metadata table used by document APIs
- `004_smoke_test` is for verification only and should be run after the schema is ready

## 7.3 Option A: Run Schema In Neon SQL Editor

1. Create a Neon project.
2. Create a database.
3. Copy the connection string.
4. Open the Neon SQL editor.
5. Run the files one by one in this order:

```text
001_extensions.sql
002_schema.sql
003_functions_triggers_views.sql
005_auth_verification.sql
005_manual_proctor_penalties.sql
006_stored_documents.sql
```

6. If you want a validation run, execute:

```text
004_smoke_test.sql
```

## 7.4 Option B: Run Schema Using `psql`

Set the environment variable first:

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<endpoint>/<db>?sslmode=require"
```

Then run:

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f sql\001_extensions.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f sql\002_schema.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f sql\003_functions_triggers_views.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f sql\005_auth_verification.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f sql\005_manual_proctor_penalties.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f sql\006_stored_documents.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f sql\004_smoke_test.sql
```

## 7.5 Database Verification Queries

After schema setup, run these checks:

```sql
SELECT NOW();
SELECT COUNT(*) FROM app_user;
SELECT COUNT(*) FROM exam;
SELECT COUNT(*) FROM stored_document;
SELECT * FROM v_candidate_integrity_summary LIMIT 5;
```

## 8. Local Project Startup

## 8.1 Start Backend

```powershell
cd backend
npm run dev
```

The backend starts on:

- `http://127.0.0.1:4000`

Health endpoint:

- `http://127.0.0.1:4000/health`

## 8.2 Start Frontend

Open a second terminal and run:

```powershell
cd frontend
npm run dev
```

The frontend usually starts on:

- `http://127.0.0.1:5173`

## 8.3 Local Verification Checklist

Verify:

- frontend loads in browser
- backend `/health` returns database connected
- student registration works if SMTP is configured
- admin login works for bootstrapped staff users
- S3-backed document generation works only after `AWS_REGION` and `S3_BUCKET` are configured

## 9. AWS S3 Bucket Setup

The application uses S3 to store:

- `result_report`
- `integrity_evidence`

It does not store raw exam answers in S3.

## 9.1 Create The Bucket

1. Open AWS Console.
2. Go to S3.
3. Click `Create bucket`.
4. Enter a globally unique bucket name.
5. Choose the same AWS region you plan to use on EC2.
6. Keep the bucket private.
7. Create the bucket.

Example bucket naming style:

- `exam-integrity-system-documents`
- `group8-dbms-documents`

## 9.2 Set Bucket In Backend Environment

In `backend/.env`:

```env
AWS_REGION=ap-south-1
S3_BUCKET=group8-dbms-documents
```

## 9.3 Recommended S3 Access Model

Use an IAM role attached to the EC2 instance instead of storing AWS access keys in `.env`.

This is the safest approach because:

- no secret access keys are stored in the repo
- AWS SDK on EC2 can use instance role credentials automatically

## 9.4 Minimum S3 Permissions

The backend needs permission for:

- `s3:PutObject`
- `s3:GetObject`
- `s3:DeleteObject`
- `s3:ListBucket`

Scope the policy to your bucket.

## 10. EC2 Setup

## 10.1 Launch The Instance

Create one Ubuntu EC2 instance.

Recommended baseline:

- AMI: Ubuntu Server LTS
- Instance type: `t2.micro` or `t3.micro` for demo use
- Storage: at least 16 GB

Security group inbound rules:

- `22` for SSH from your IP
- `80` for HTTP from anywhere
- `443` for HTTPS from anywhere if you plan to use SSL

Download the PEM key file and keep it safe.

## 10.2 Attach An IAM Role

Create an IAM role for EC2 and attach it to the instance.

High-level steps:

1. Open IAM.
2. Create a new role.
3. Choose trusted entity type `AWS service`.
4. Choose use case `EC2`.
5. Attach an S3 access policy for your project bucket.
6. Save the role.
7. Attach the role to the EC2 instance.

## 10.3 Connect To EC2

From your local machine:

```bash
ssh -i "GroupDBMS.pem" ubuntu@<EC2_PUBLIC_IP>
```

If your key file is in another path, use that absolute path instead.

## 11. Exact EC2 Installation Commands

Run the following commands on the EC2 instance.

## 11.1 Update The Server

```bash
sudo apt update
sudo apt upgrade -y
```

## 11.2 Install Core Tools

```bash
sudo apt install -y git nginx awscli rsync
```

## 11.3 Install Node.js And npm

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 11.4 Install PM2

```bash
sudo npm install -g pm2
pm2 -v
```

## 11.5 Confirm AWS Role Access

```bash
aws sts get-caller-identity
aws s3 ls
```

If the role is attached correctly, these commands should work without adding AWS keys manually.

## 12. Clone Project On EC2

Choose a working directory and clone the repository:

```bash
cd /home/ubuntu
git clone https://github.com/group8dbms/ExamIntegrationProject.git
cd ExamIntegrationProject
```

## 13. Backend Setup On EC2

## 13.1 Create Backend Environment

```bash
cd /home/ubuntu/ExamIntegrationProject/backend
cp .env.example .env
nano .env
```

Suggested production values:

```env
PORT=4000
DATABASE_URL=postgresql://<user>:<password>@<endpoint>/<db>?sslmode=require
FRONTEND_URL=http://<EC2_PUBLIC_IP>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Exam Integrity <no-reply@example.com>"
AWS_REGION=ap-south-1
S3_BUCKET=your-s3-bucket-name
MAX_UPLOAD_SIZE_BYTES=10485760
```

If you use a domain name, replace `FRONTEND_URL` with the domain instead of the public IP.

## 13.2 Install Backend Dependencies

```bash
cd /home/ubuntu/ExamIntegrationProject/backend
npm install
```

## 13.3 Start Backend With PM2

```bash
cd /home/ubuntu/ExamIntegrationProject/backend
pm2 start src/server.js --name exam-integrity-backend
pm2 save
pm2 startup
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs exam-integrity-backend
pm2 restart exam-integrity-backend
pm2 stop exam-integrity-backend
```

## 13.4 Verify Backend

```bash
curl http://127.0.0.1:4000/health
```

Expected outcome:

- backend responds with JSON
- database should show `connected`

## 14. Frontend Setup On EC2

## 14.1 Production API Base Requirement

Before building the frontend for EC2, update:

- `frontend/src/lib/api.js`

Recommended production version:

```js
export const API_BASE = "";
```

That allows the frontend to call the same host and lets Nginx proxy `/api/...` requests to the backend.

## 14.2 Install Frontend Dependencies

```bash
cd /home/ubuntu/ExamIntegrationProject/frontend
npm install
```

## 14.3 Build Frontend

```bash
cd /home/ubuntu/ExamIntegrationProject/frontend
npm run build
```

## 14.4 Publish Frontend Build To Nginx Web Root

```bash
sudo mkdir -p /var/www/exam-integrity
sudo rsync -av --delete dist/ /var/www/exam-integrity/
```

## 15. Nginx Setup On EC2

Create a site config:

```bash
sudo nano /etc/nginx/sites-available/exam-integrity
```

Use this configuration:

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/exam-integrity;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/exam-integrity /etc/nginx/sites-enabled/exam-integrity
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## 16. Database Setup From EC2

You can still use the Neon web SQL editor, which is the easiest approach.

If you want to apply schema from EC2 using `psql`, first install the client:

```bash
sudo apt install -y postgresql-client
```

Then run:

```bash
export DATABASE_URL="postgresql://<user>:<password>@<endpoint>/<db>?sslmode=require"
cd /home/ubuntu/ExamIntegrationProject
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001_extensions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/002_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/003_functions_triggers_views.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/005_auth_verification.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/005_manual_proctor_penalties.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/006_stored_documents.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/004_smoke_test.sql
```

## 17. Full First-Time Deployment Flow On EC2

Use this sequence on a fresh server:

1. Launch Ubuntu EC2.
2. Open ports `22`, `80`, and optionally `443`.
3. Attach IAM role with S3 permissions.
4. SSH into EC2.
5. Install Git, Nginx, AWS CLI, Node.js, and PM2.
6. Clone the GitHub repository.
7. Create `backend/.env`.
8. Set Neon, SMTP, S3, and frontend URL values.
9. Apply the database schema in the correct file order.
10. Install backend dependencies.
11. Start the backend with PM2.
12. Update `frontend/src/lib/api.js` for production.
13. Install frontend dependencies.
14. Build the frontend.
15. Copy `dist/` to `/var/www/exam-integrity/`.
16. Create the Nginx config.
17. Reload Nginx.
18. Test `/health`, login, email verification, result publication, and document access.

## 18. Update / Redeployment Commands On EC2

Whenever new code is pushed to GitHub:

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

## 19. Post-Deployment Verification

Run these checks on EC2:

```bash
pm2 status
pm2 logs exam-integrity-backend --lines 50
curl http://127.0.0.1:4000/health
sudo nginx -t
sudo systemctl status nginx
aws s3 ls s3://your-s3-bucket-name
```

Browser checks:

- open `http://<EC2_PUBLIC_IP>`
- verify frontend loads
- verify login works
- verify `/health` is reachable through the server
- verify student verification email redirects to the frontend URL
- verify report generation can upload to S3

## 20. Common Issues

## 20.1 Backend Fails With `DATABASE_URL is required`

Cause:

- `backend/.env` is missing or incomplete

Fix:

- add a valid `DATABASE_URL`

## 20.2 Student Registration Fails For Verification Mail

Cause:

- SMTP variables are missing or incorrect

Fix:

- set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`

## 20.3 S3 Upload Fails

Cause:

- `AWS_REGION` or `S3_BUCKET` is missing
- EC2 IAM role does not have S3 permissions

Fix:

- check backend `.env`
- verify IAM role
- run `aws sts get-caller-identity`

## 20.4 Frontend Works Locally But Fails On EC2

Cause:

- `frontend/src/lib/api.js` still points to `http://127.0.0.1:4000`

Fix:

- change `API_BASE` before production build
- rebuild frontend
- re-sync `dist/`

## 20.5 Some Features Work But Auth, Penalties, Or Documents Fail

Cause:

- only partial schema was applied

Fix:

- make sure all of these were run:
  - `001_extensions.sql`
  - `002_schema.sql`
  - `003_functions_triggers_views.sql`
  - `005_auth_verification.sql`
  - `005_manual_proctor_penalties.sql`
  - `006_stored_documents.sql`

## 21. Final Recommended Setup Summary

For this repository, the most reliable setup is:

1. Clone from GitHub.
2. Create `backend/.env`.
3. Install backend and frontend dependencies with `npm install`.
4. Create Neon database and run the SQL files in the required order.
5. Configure SMTP.
6. Create S3 bucket.
7. Launch EC2 and attach an IAM role for S3 access.
8. Install Node.js, PM2, Nginx, Git, AWS CLI, and rsync on EC2.
9. Clone the project on EC2.
10. Start backend with PM2.
11. Build frontend and serve it from Nginx.
12. Use Nginx to proxy `/api` and `/health` to the backend.

This gives a complete working deployment with:

- React frontend
- Express backend
- Neon PostgreSQL database
- SMTP email verification
- S3-based document storage
- EC2-hosted deployment
