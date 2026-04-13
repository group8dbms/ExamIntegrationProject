# Exam Integrity System Presentation Version

## Slide 1: Title

Exam Integrity System

Role-Based Online Examination Platform with Integrity Monitoring and Audit Reporting

## Slide 2: Problem Statement

- basic online exam systems focus only on question delivery
- they often do not support strong integrity monitoring
- they usually lack investigation workflows
- they rarely provide audit-ready reporting

## Slide 3: Project Objective

- create a secure online examination system
- support role-based workflows
- monitor suspicious activity
- control result publication
- maintain audit and evidence records

## Slide 4: User Roles

- Admin
- Student
- Proctor
- Evaluator
- Auditor

## Slide 5: Core Features

- exam creation and scheduling
- MCQ and MSQ question support
- student registration and email verification
- autosave and final submission
- suspicious activity logging
- proctor case handling
- evaluator marking
- result publishing
- audit review

## Slide 6: Tech Stack

## Frontend

- React
- Vite
- JavaScript
- CSS

## Backend

- Node.js
- Express.js

## Database

- PostgreSQL
- Neon

## Cloud

- AWS EC2
- AWS S3
- Nginx
- PM2

## Slide 7: Dependencies Used

## Backend

- express
- pg
- nodemailer
- multer
- cors
- dotenv
- helmet
- morgan
- AWS SDK

## Frontend

- react
- react-dom
- vite
- eslint packages

## Slide 8: Integrations Done

- Neon PostgreSQL integration for application data
- SMTP integration for verification and result emails
- S3 integration for reports and evidence
- EC2 hosting integration for frontend and backend deployment

## Slide 9: System Flow

1. admin creates exam
2. students are assigned
3. student logs in and starts exam
4. suspicious activity is logged when detected
5. evaluator marks submission
6. proctor reviews integrity cases
7. admin publishes results
8. auditor checks final reports and logs

## Slide 10: Integrity Flow

- suspicious events are stored in database
- proctor assigns penalty points
- case can be opened for flagged attempts
- final decision is stored
- integrity evidence report is generated and uploaded to S3

## Slide 11: Result Flow

- evaluation is completed
- integrity cases must be decided
- admin publishes exam-wise results
- emails are sent to students
- result reports are uploaded to S3

## Slide 12: Deployment Flow

1. database created in Neon
2. project developed locally
3. EC2 instance created
4. Node.js, PM2, Nginx installed
5. S3 bucket created
6. IAM role attached to EC2
7. backend run with PM2
8. frontend served through Nginx

## Slide 13: Key Advantages

- clear role separation
- secure exam workflow
- integrity monitoring
- manual investigation support
- cloud-based document storage
- audit-ready reporting

## Slide 14: Conclusion

The Exam Integrity System is a full-stack cloud-enabled examination platform that combines exam delivery, security, integrity review, and audit reporting in one complete system.
