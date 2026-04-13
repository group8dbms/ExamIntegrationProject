# Exam Integrity System Viva Quick Summary

## 1. What Is This Project?

The Exam Integrity System is a role-based online examination platform.

It supports:

- exam creation
- student registration and verification
- online exam attempt
- suspicious activity logging
- proctor review
- evaluator marking
- result publication
- audit review

In one sentence:

> It is an online exam system with integrity monitoring and audit-ready reporting.

## 2. Main Technologies Used

## Frontend

- React
- Vite
- JavaScript
- Custom CSS

## Backend

- Node.js
- Express.js
- REST APIs

## Database

- PostgreSQL
- Neon hosted Postgres

## Deployment / Cloud

- AWS EC2
- AWS S3
- Nginx
- PM2

## External Services

- SMTP mail server

## 3. Main Roles in the System

## Admin

- creates exams
- adds questions
- assigns students
- assigns staff roles
- publishes results

## Student

- registers
- verifies email
- logs in
- takes exam
- submits answers

## Proctor

- reviews suspicious logs
- assigns penalties
- opens cases
- records final decision

## Evaluator

- checks submitted answers
- assigns marks

## Auditor

- checks audit logs
- checks hash verification
- reviews reports and evidence

## 4. Important Integrations

## Neon Integration

Used to store:

- users
- exams
- submissions
- integrity events
- results
- audit logs

## SMTP Integration

Used to:

- send student verification email
- send result publication email

## S3 Integration

Used to store:

- result reports
- integrity evidence reports

## EC2 Integration

Used to host:

- backend
- frontend

## 5. Main Dependencies Installed

## Backend

- express
- pg
- nodemailer
- multer
- cors
- dotenv
- helmet
- morgan
- AWS SDK for S3
- nodemon

## Frontend

- react
- react-dom
- vite
- eslint packages

## 6. End-to-End Flow

1. admin creates exam
2. admin adds questions
3. admin assigns verified students
4. student logs in and starts exam
5. answers are autosaved
6. suspicious actions are logged if they happen
7. student submits exam
8. evaluator gives marks
9. proctor decides integrity cases
10. admin publishes results
11. result reports are uploaded to S3
12. auditor reviews everything

## 7. How Deployment Was Done

1. database created in Neon
2. backend and frontend developed locally
3. EC2 instance created on AWS
4. Node.js, PM2, Nginx, Git, and AWS CLI installed
5. S3 bucket created
6. IAM role attached to EC2 for S3 access
7. backend run with PM2
8. frontend built and served through Nginx

## 8. Why This Project Is Strong

- role-based architecture
- secure and structured exam flow
- suspicious event tracking
- manual investigation workflow
- result publication control
- cloud document storage
- audit-ready design

## 9. Best One-Line Conclusion

> This project is a full-stack cloud-enabled online examination system that combines academic workflow, integrity monitoring, and audit reporting in one platform.
