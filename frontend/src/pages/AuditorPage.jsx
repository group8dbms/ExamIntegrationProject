import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatActionLabel(action) {
  return String(action || "unknown").replaceAll("_", " ");
}

function formatDetails(details) {
  if (!details || typeof details !== "object") return "No extra details";
  const entries = Object.entries(details);
  if (!entries.length) return "No extra details";
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" | ");
}

export default function AuditorPage({ session, onLogout, setMessage }) {
  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedExam, setSelectedExam] = useState(null);
  const [students, setStudents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [storageConfigured, setStorageConfigured] = useState(false);

  useEffect(() => {
    void loadExamAudits();
  }, [session?.id]);

  const summary = useMemo(() => ({
    totalStudents: students.length,
    verifiedHashes: students.filter((item) => item.submission_hash_verified).length,
    failedHashes: students.filter((item) => item.submission_id && !item.submission_hash_verified).length,
    openCases: students.filter((item) => item.case_id && !item.case_closed_at && !["resolved", "cleared", "confirmed_cheating"].includes(item.case_workflow_status)).length
  }), [students]);

  async function loadExamAudits() {
    try {
      const data = await api("/api/audit/exams");
      const items = data.items || [];
      setExams(items);
      setMessage(items.length ? `Loaded ${items.length} exam audit group(s).` : "No exam audit records found yet.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openExam(examId, announce = true) {
    try {
      const data = await api(`/api/audit/exams/${examId}`);
      setSelectedExamId(examId);
      setSelectedExam(data.exam || null);
      setStudents(data.students || []);
      setLogs(data.logs || []);
      const docs = await api(`/api/documents?examId=${examId}`);
      setDocuments(docs.items || []);
      setStorageConfigured(Boolean(docs.storageConfigured));
      if (announce) {
        setMessage(`Loaded audit details for ${data.exam?.title || "the selected exam"}.`);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openDocument(documentId) {
    try {
      const data = await api(`/api/documents/${documentId}/access-url`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error.message);
    }
  }

  function closeExamView() {
    setSelectedExamId("");
    setSelectedExam(null);
    setStudents([]);
    setLogs([]);
    setDocuments([]);
    setStorageConfigured(false);
  }

  return <section className="workspace-shell">
    <div className="workspace-header">
      <div>
        <p className="eyebrow">Auditor Workspace</p>
        <h2>{session.fullName}</h2>
        <p className="info-line">{session.email}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onLogout}>Logout</button>
    </div>

    {!selectedExam ? <div className="task-page">
      <div className="task-intro">
        <p className="eyebrow">Audit Review</p>
        <h3>Select an Exam Category</h3>
        <p>Choose an exam to open its audit report. The next screen shows exam details, student submission hash verification, integrity summary, and audit logs in table form.</p>
      </div>

      <div className="task-card">
        <div className="task-card-header"><h3>Exam Categories</h3><button type="button" className="secondary-button" onClick={loadExamAudits}>Refresh</button></div>
        <div className="list-box">
          {exams.map((exam) => <button key={exam.id} type="button" className="publish-card ready" onClick={() => openExam(exam.id)}>
            <div className="publish-card-top">
              <div>
                <strong>{exam.title}</strong>
                <p>{exam.course_code}</p>
              </div>
              <span className={exam.published_at ? "status-badge published" : "status-badge waiting"}>{exam.published_at ? "Published" : "Audit open"}</span>
            </div>
            <p className="info-line">Assigned: {exam.candidate_count} | Submitted: {exam.submitted_count}</p>
            <p className="info-line">Hash verified: {exam.verified_hash_count} | Hash issues: {exam.failed_hash_count}</p>
            <p className="info-line">Integrity events: {exam.integrity_event_count} | Cases: {exam.case_count}</p>
          </button>)}
          {!exams.length && <p>No exams available for audit yet.</p>}
        </div>
      </div>
    </div> : <div className="task-page auditor-detail-page">
      <div className="task-intro auditor-detail-header">
        <div>
          <p className="eyebrow">Exam Audit Report</p>
          <h3>{selectedExam.title}</h3>
          <p>{selectedExam.course_code}</p>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={closeExamView}>Back To Exams</button>
          <button type="button" className="secondary-button" onClick={() => openExam(selectedExamId)}>Refresh Report</button>
        </div>
      </div>

      <div className="task-card">
        <div className="auditor-summary-grid">
          <div className="summary-tile"><span>Start Time</span><strong>{formatDateTime(selectedExam.start_at)}</strong></div>
          <div className="summary-tile"><span>End Time</span><strong>{formatDateTime(selectedExam.end_at)}</strong></div>
          <div className="summary-tile"><span>Published At</span><strong>{formatDateTime(selectedExam.published_at)}</strong></div>
          <div className="summary-tile"><span>Integrity Threshold</span><strong>{selectedExam.integrity_threshold}</strong></div>
          <div className="summary-tile"><span>Students Tracked</span><strong>{summary.totalStudents}</strong></div>
          <div className="summary-tile"><span>Open Cases</span><strong>{summary.openCases}</strong></div>
          <div className="summary-tile"><span>Hash Verified</span><strong>{summary.verifiedHashes}</strong></div>
          <div className="summary-tile"><span>Hash Issues</span><strong>{summary.failedHashes}</strong></div>
        </div>
      </div>

      <div className="task-card">
        <div className="task-card-header"><h3>Student Audit Table</h3><span className="info-line">Submission timing, hash verification, integrity state, and result summary</span></div>
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Started</th>
                <th>Submitted</th>
                <th>Hash Verification</th>
                <th>Integrity Score</th>
                <th>Case Status</th>
                <th>Decision</th>
                <th>Event Count</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => <tr key={`${student.student_id}:${student.attempt_no}`}>
                <td>
                  <strong>{student.student_name}</strong>
                  <div>{student.student_email}</div>
                </td>
                <td>{formatDateTime(student.started_at)}</td>
                <td>{formatDateTime(student.submitted_at || student.final_submitted_at)}</td>
                <td>{student.submission_id ? (student.submission_hash_verified ? "Verified" : "Needs review") : "Not submitted"}</td>
                <td>{student.integrity_score}</td>
                <td>{student.case_workflow_status || student.case_status || "Not opened"}</td>
                <td>{student.case_decision || "Pending"}</td>
                <td>{student.integrity_event_count}</td>
                <td>{student.result_status || "not_ready"}</td>
              </tr>)}
              {!students.length ? <tr><td colSpan="9">No student audit records are available for this exam yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="task-card">
        <div className="task-card-header"><h3>Stored Documents</h3><span className="info-line">S3-backed result reports and integrity evidence for this exam</span></div>
        {!storageConfigured ? <p className="info-line">S3 storage is not configured on the backend yet.</p> : <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Document Type</th>
                <th>Student</th>
                <th>File Name</th>
                <th>Uploaded By</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((item) => <tr key={item.id}>
                <td>{item.document_type}</td>
                <td>{item.student_name || "-"}</td>
                <td>{item.original_name || item.s3_key}</td>
                <td>{item.uploaded_by_name || "system"}</td>
                <td>{formatDateTime(item.created_at)}</td>
                <td><button type="button" className="secondary-button" onClick={() => openDocument(item.id)}>Open</button></td>
              </tr>)}
              {!documents.length ? <tr><td colSpan="6">No stored documents are linked to this exam yet.</td></tr> : null}
            </tbody>
          </table>
        </div>}
      </div>

      <div className="task-card">
        <div className="task-card-header"><h3>Exam Audit Logs Table</h3><span className="info-line">Exam start, submission activity, integrity reports, evaluation, and publishing trail</span></div>
        <div className="audit-table-wrap">
          <table className="audit-table audit-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor Role</th>
                <th>Entity</th>
                <th>IP Address</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => <tr key={item.id}>
                <td>{formatDateTime(item.occurred_at)}</td>
                <td>{formatActionLabel(item.action)}</td>
                <td>{item.actor_role || "system"}</td>
                <td>{item.entity_type}</td>
                <td>{item.ip_address || "-"}</td>
                <td>{formatDetails(item.details)}</td>
              </tr>)}
              {!logs.length ? <tr><td colSpan="6">No audit log entries found for this exam yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>}
  </section>;
}
