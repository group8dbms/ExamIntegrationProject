# System Flow Overview

This document provides a whole-project flow for explanation and presentation.

## 1. High-Level Idea
The system works as a pipeline:

1. admin prepares the exam
2. student takes the exam
3. suspicious actions are logged if they happen
4. evaluator marks submissions
5. proctor reviews suspicious cases
6. admin publishes results
7. auditor reviews final evidence and logs

## 2. End-to-End Flow Diagram

```mermaid
flowchart TD
    A["Admin Login"] --> B["Create Exam"]
    B --> C["Add MCQ/MSQ Questions"]
    C --> D["Assign Verified Students"]
    D --> E["Assign Proctor / Evaluator / Auditor Roles"]

    E --> F["Student Registers / Verifies Email / Logs In"]
    F --> G["Student Dashboard Shows Assigned Exams"]
    G --> H{"Exam Start Time Reached?"}
    H -- No --> I["Start Button Disabled"]
    H -- Yes --> J["Open Exam Window"]

    J --> K["Student Answers Questions"]
    K --> L["Autosave Answers"]
    K --> M{"Suspicious Activity?"}
    M -- No --> N["Continue Exam"]
    M -- Yes --> O["Log Integrity Event"]
    O --> P["Show Local Warning To Student"]
    P --> N
    N --> Q["Final Submit"]

    Q --> R["Secure Submission Stored"]
    R --> S["Submission Hash Verification Available"]
    R --> T["Evaluator Reviews Submission"]
    T --> U["Evaluator Assigns Marks"]

    O --> V["Proctor Dashboard Shows Flagged Student"]
    V --> W["Proctor Reviews Event Log"]
    W --> X["Proctor Assigns Penalties"]
    X --> Y["Open Case If Needed"]
    Y --> Z["Save Proctor Decision"]
    Z --> ZA["Integrity Evidence Report Auto Uploaded To S3"]

    U --> ZB{"All Students Evaluated?"}
    Z --> ZC{"All Open Cases Decided?"}
    ZB --> ZD{"All Assigned Students Submitted?"}

    ZD --> ZE["Admin Publish Results"]
    ZB --> ZE
    ZC --> ZE

    ZE --> ZF["Result Emails Sent To Students"]
    ZE --> ZG["Result Reports Auto Uploaded To S3"]
    ZE --> ZH["Results Visible In Published State"]

    ZH --> ZI["Auditor Opens Exam Audit Report"]
    ZI --> ZJ["Review Audit Logs"]
    ZI --> ZK["Review Submission Hash Verification"]
    ZI --> ZL["Review Integrity Cases"]
    ZI --> ZM["Open Stored Result Reports / Integrity Evidence"]
```

## 3. Role-Wise Flow

### Admin Flow
```mermaid
flowchart LR
    A["Admin Login"] --> B["Assign Staff Roles"]
    B --> C["Prepare Quiz"]
    C --> D["Assign Students"]
    D --> E["Wait For Submission + Evaluation + Proctor Decision"]
    E --> F["Publish Results"]
```

### Student Flow
```mermaid
flowchart LR
    A["Register / Login"] --> B["Verify Email"]
    B --> C["Open Dashboard"]
    C --> D["Start Assigned Exam"]
    D --> E["Autosave Answers"]
    E --> F["Submit Final Answers"]
```

### Proctor Flow
```mermaid
flowchart LR
    A["Open Proctor Dashboard"] --> B["Select Exam With Suspicious Logs"]
    B --> C["Review Flagged Student"]
    C --> D["Assign Penalties"]
    D --> E["Open Case"]
    E --> F["Save Decision"]
    F --> G["Auto Generate Integrity Evidence"]
```

### Evaluator Flow
```mermaid
flowchart LR
    A["Open Evaluator Dashboard"] --> B["Select Submitted Exam"]
    B --> C["Choose Student Submission"]
    C --> D["Review Answers"]
    D --> E["Assign Marks and Feedback"]
```

### Auditor Flow
```mermaid
flowchart LR
    A["Open Auditor Dashboard"] --> B["Select Exam"]
    B --> C["View Student Audit Table"]
    C --> D["Check Hash Verification"]
    C --> E["Check Integrity Status"]
    C --> F["Open Stored Documents"]
    C --> G["Review Audit Logs"]
```

## 4. Data Flow Summary
- frontend sends role-based requests to backend REST APIs
- backend stores transactional data in Neon Postgres
- backend writes suspicious events, case actions, and audit logs into DB
- backend sends emails through SMTP
- backend uploads result and integrity reports to S3
- auditor accesses stored document metadata from DB and opens signed S3 URLs

## 5. Security / Integrity Flow
- student final answers are stored securely
- submission hash verification supports tamper detection
- suspicious activities are logged only when events actually occur
- proctor assigns penalties manually instead of auto-punishment
- result publication is blocked until investigation decisions are completed

## 6. Presentation Summary
This system is not only an exam portal. It is a controlled exam lifecycle platform with:
- controlled access
- secure submission
- integrity event tracking
- investigation workflow
- evaluator marking
- gated result publication
- audit-ready reporting
