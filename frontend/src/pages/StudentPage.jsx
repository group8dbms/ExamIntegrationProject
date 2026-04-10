import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

function formatDateTime(value) {
  return new Date(value).toLocaleString();
}

function computeStartState(item) {
  const now = Date.now();
  const startAt = new Date(item.start_at).getTime();
  const endAt = new Date(item.end_at).getTime();

  if (item.candidate_status === "submitted") {
    return { label: "Submitted", disabled: true, tone: "muted" };
  }
  if (now < startAt) {
    return { label: "Not available to start now", disabled: true, tone: "muted" };
  }
  if (now > endAt) {
    return { label: "Exam window closed", disabled: true, tone: "danger" };
  }
  return { label: "Start Exam", disabled: false, tone: "success" };
}

export default function StudentPage({ session, onLogout, setMessage }) {
  const [assigned, setAssigned] = useState([]);

  useEffect(() => {
    void loadAssigned();
  }, [session?.id]);

  useEffect(() => {
    function handleExamSubmitted(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "student-exam-submitted") {
        void loadAssigned();
      }
    }

    window.addEventListener("message", handleExamSubmitted);
    return () => window.removeEventListener("message", handleExamSubmitted);
  }, [session?.id]);

  async function loadAssigned() {
    try {
      const exams = await api(`/api/exams/assigned/${session.id}`);
      setAssigned(exams.items || []);
      setMessage(`Welcome ${session.fullName}. ${exams.items.length} exams assigned.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function startExam(examId) {
    const url = new URL(window.location.href);
    url.search = `mode=exam&examId=${encodeURIComponent(examId)}`;
    const popup = window.open(url.toString(), `exam-window-${examId}`, "popup=yes,width=1440,height=920,resizable=yes,scrollbars=yes");
    if (!popup) {
      setMessage("Popup blocked. Allow popups for this site to start the exam window.");
      return;
    }
    popup.focus();
    setMessage("Exam window opened. Countdown and integrity monitoring start inside that window.");
  }

  const assignedCards = useMemo(
    () => assigned.map((item) => {
      const state = computeStartState(item);
      return (
        <div className="student-exam-card" key={item.id}>
          <div className="task-card-header">
            <div>
              <strong>{item.title}</strong>
              <p className="info-line">{item.course_code}</p>
            </div>
            <button
              className={state.tone === "success" ? "start-button success" : state.tone === "danger" ? "start-button danger" : "start-button muted"}
              type="button"
              disabled={state.disabled}
              onClick={() => startExam(item.id)}
            >
              {state.label}
            </button>
          </div>
          <div className="student-exam-meta">
            <span>Starts: {formatDateTime(item.start_at)}</span>
            <span>Ends: {formatDateTime(item.end_at)}</span>
            <span>Status: {item.candidate_status}</span>
            <span>Integrity score: {item.integrity_score}</span>
            <span>Case status: {item.case_status}</span>
            <span>Submission hash verified: {item.submission_hash_verified ? "Yes" : "No"}</span>
          </div>
        </div>
      );
    }),
    [assigned]
  );

  return <section className="workspace-shell">
    <div className="workspace-header">
      <div>
        <p className="eyebrow">Student Workspace</p>
        <h2>{session.fullName}</h2>
        <p className="info-line">{session.email}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onLogout}>Logout</button>
    </div>

    <div className="task-page task-layout-split">
      <div className="task-card">
        <div className="task-card-header">
          <h3>Assigned Exams</h3>
          <button type="button" className="secondary-button" onClick={loadAssigned}>Refresh</button>
        </div>
        <div className="list-box">{assignedCards}{!assigned.length && <p>No assigned exams yet.</p>}</div>
      </div>

      <div className="task-intro">
        <p className="eyebrow">Exam Desk</p>
        <h3>Start only when the exam window opens</h3>
        <p>The start button stays gray until the configured start time is reached. When it turns green, click it to open a dedicated exam window with countdown, autosave, and integrity monitoring.</p>
      </div>
    </div>
  </section>;
}
