# Backend

This backend is a Node.js + Express API for the exam integrity system.

## Endpoints included

- `GET /health`
- `GET /api/exams`
- `POST /api/exams`
- `POST /api/exams/:examId/candidates`
- `GET /api/exams/:examId/dashboard`
- `POST /api/submissions/autosave`
- `POST /api/submissions/finalize`
- `POST /api/integrity/events`
- `GET /api/integrity/cases`
- `PATCH /api/integrity/cases/:caseId/decision`

## Run locally

```powershell
cd C:\ExamIntegritySystem\backend
Copy-Item .env.example .env
npm install
npm run dev
```

You can also keep `DATABASE_URL` in `C:\ExamIntegritySystem\.env` and the backend will pick it up automatically.
