import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

function formatEventLabel(type) {
  return String(type || "unknown")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDetails(details) {
  if (!details || typeof details !== "object") return "No extra details";
  const entries = Object.entries(details);
  if (!entries.length) return "No extra details";
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" | ");
}

function getCaseDisplayStatus(student) {
  if (!student?.caseId) return "Not opened";
  if (student.caseClosedAt || ["resolved", "cleared", "confirmed_cheating"].includes(student.caseWorkflowStatus)) {
    return "Closed";
  }
  return student.caseWorkflowStatus || student.caseStatus || "Open";
}

function createDecisionDraft(sessionId, student = null) {
  return {
    status: student?.caseWorkflowStatus || "resolved",
    decision: student?.caseDecision || "manual_review",
    decisionNotes: student?.caseDecisionNotes || "",
    actionBy: sessionId,
    resolvedBy: sessionId
  };
}

export default function ProctorPage({ session, onLogout, setMessage }) {
  const [liveExams, setLiveExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedExam, setSelectedExam] = useState(null);
  const [studentLogs, setStudentLogs] = useState([]);
  const [selectedStudentKey, setSelectedStudentKey] = useState("");
  const [penaltyDrafts, setPenaltyDrafts] = useState({});
  const [decisionDraft, setDecisionDraft] = useState(createDecisionDraft(session?.id));

  useEffect(() => {
    void loadLiveExams();
  }, [session?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadLiveExams(false);
      if (selectedExamId) {
        void loadExamLogs(selectedExamId, false);
      }
    }, 10000);

    return () => window.clearInterval(timer);
  }, [selectedExamId]);

  const selectedStudent = useMemo(
    () => studentLogs.find((item) => `${item.studentId}:${item.attemptNo}` === selectedStudentKey) || null,
    [selectedStudentKey, studentLogs]
  );

  useEffect(() => {
    setDecisionDraft(createDecisionDraft(session?.id, selectedStudent));
  }, [selectedStudent, session?.id]);

  async function loadLiveExams(announce = true) {
    try {
      const data = await api("/api/integrity/live-exams");
      const items = data.items || [];
      setLiveExams(items);
      if (!selectedExamId && items.length) {
        setSelectedExamId(items[0].id);
        await loadExamLogs(items[0].id, false);
      }
      if (announce) {
        setMessage(items.length ? `Loaded ${items.length} exam(s) with suspicious activity logs.` : "No suspicious activity logs found right now.");
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadExamLogs(examId, announce = true) {
    try {
      const data = await api(`/api/integrity/exams/${examId}/live-logs`);
      setSelectedExamId(examId);
      setSelectedExam(data.exam || null);
      setStudentLogs(data.items || []);
      const nextSelected = selectedStudentKey && (data.items || []).some((item) => `${item.studentId}:${item.attemptNo}` === selectedStudentKey)
        ? selectedStudentKey
        : data.items?.[0]
          ? `${data.items[0].studentId}:${data.items[0].attemptNo}`
          : "";
      setSelectedStudentKey(nextSelected);

      const nextDrafts = {};
      for (const student of data.items || []) {
        for (const event of student.events || []) {
          nextDrafts[event.eventId] = {
            penaltyPoints: event.penaltyPoints ?? "",
            note: event.penaltyNote || ""
          };
        }
      }
      setPenaltyDrafts(nextDrafts);

      if (announce) {
        setMessage(`Loaded suspicious logs for ${data.exam?.title || "the selected exam"}.`);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function assignPenalty(eventId) {
    const draft = penaltyDrafts[eventId] || { penaltyPoints: "", note: "" };
    const numericPenalty = Number(draft.penaltyPoints);
    if (draft.penaltyPoints === "" || Number.isNaN(numericPenalty) || numericPenalty < 0) {
      setMessage("Enter a valid non-negative penalty before saving.");
      return;
    }

    try {
      await api(`/api/integrity/events/${eventId}/penalty`, {
        method: "POST",
        body: JSON.stringify({
          penaltyPoints: numericPenalty,
          note: draft.note,
          assignedBy: session.id,
          actorRole: "proctor"
        })
      });
      setMessage("Penalty saved for the selected suspicious activity.");
      await loadExamLogs(selectedExamId, false);
      await loadLiveExams(false);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openCaseForStudent() {
    if (!selectedStudent || !selectedExamId) {
      setMessage("Choose a flagged student first.");
      return;
    }

    try {
      const data = await api("/api/integrity/cases/open", {
        method: "POST",
        body: JSON.stringify({
          examId: selectedExamId,
          studentId: selectedStudent.studentId,
          attemptNo: selectedStudent.attemptNo,
          openedBy: session.id,
          actorRole: "proctor",
          summary: `Case opened by proctor for ${selectedStudent.studentName} after reviewing suspicious activity logs.`
        })
      });
      setMessage(data.reused ? "Existing open case loaded for this student." : "New integrity case opened for this student.");
      await loadExamLogs(selectedExamId, false);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveCaseDecision(event) {
    event.preventDefault();
    if (!selectedStudent?.caseId) {
      setMessage("Open a case for this student first.");
      return;
    }

    try {
      const finalStatus = decisionDraft.status === "under_review" ? "resolved" : decisionDraft.status;
      await api(`/api/integrity/cases/${selectedStudent.caseId}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ ...decisionDraft, status: finalStatus, actorRole: "proctor" })
      });
      setMessage("Proctor decision saved for this case.");
      await loadExamLogs(selectedExamId, false);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return <section className="workspace-shell">
    <div className="workspace-header">
      <div>
        <p className="eyebrow">Proctor Workspace</p>
        <h2>{session.fullName}</h2>
        <p className="info-line">{session.email}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onLogout}>Logout</button>
    </div>

    <div className="task-page">
      <div className="task-intro">
        <p className="eyebrow">Live Monitoring</p>
        <h3>Review Suspicious Activity Logs, Assign Penalties, and Close Case Decisions</h3>
        <p>Only students with suspicious activity appear here. Events stay stored after the exam, and the proctor can both assign penalties and record the case decision needed before admin publishes results.</p>
      </div>

      <div className="publish-grid">
        <div className="task-card">
          <div className="task-card-header"><h3>Exams With Suspicious Activity</h3><button type="button" className="secondary-button" onClick={() => loadLiveExams()}>Refresh</button></div>
          <div className="list-box">
            {liveExams.map((exam) => <button key={exam.id} type="button" className={selectedExamId === exam.id ? "publish-card ready" : "publish-card muted"} onClick={() => loadExamLogs(exam.id)}>
              <div className="publish-card-top">
                <div>
                  <strong>{exam.title}</strong>
                  <p>{exam.course_code}</p>
                </div>
                <span className="status-badge waiting">Logs</span>
              </div>
              <p className="info-line">Flagged students: {exam.flagged_student_count} | Suspicious events: {exam.suspicious_event_count}</p>
              <p className="info-line">Window: {formatDateTime(exam.start_at)} to {formatDateTime(exam.end_at)}</p>
              <p className="info-line">Last event: {formatDateTime(exam.last_event_at)}</p>
            </button>)}
            {!liveExams.length && <p>No exams have suspicious activity logs right now.</p>}
          </div>
        </div>

        <div className="task-card">
          <div className="task-card-header">
            <div>
              <h3>Flagged Students</h3>
              <span className="info-line">{selectedExam ? `${selectedExam.title} | ${selectedExam.course_code}` : "Choose an exam to inspect"}</span>
            </div>
          </div>
          <div className="list-box">
            {studentLogs.map((student) => <button key={`${student.studentId}:${student.attemptNo}`} type="button" className={selectedStudentKey === `${student.studentId}:${student.attemptNo}` ? "publish-card ready" : "publish-card muted"} onClick={() => setSelectedStudentKey(`${student.studentId}:${student.attemptNo}`)}>
              <div className="publish-card-top">
                <div>
                  <strong>{student.studentName}</strong>
                  <p>{student.studentEmail}</p>
                </div>
                <span className={student.integrityScore > 0 ? "status-badge waiting" : "status-badge muted"}>Penalty total: {student.integrityScore}</span>
              </div>
              <p className="info-line">Events: {student.totalEvents} | Last seen: {formatDateTime(student.lastEventAt)}</p>
              <p className="info-line">Case: {getCaseDisplayStatus(student)} | Decision: {student.caseDecision || "Pending"}</p>
            </button>)}
            {!studentLogs.length && <p>No suspicious logs recorded for this exam yet.</p>}
          </div>
        </div>
      </div>

      <div className="task-page task-layout-split">
        <div className="task-card">
          {selectedStudent ? <>
            <div className="task-card-header">
              <div>
                <h3>{selectedStudent.studentName}</h3>
                <p className="info-line">{selectedStudent.studentEmail}</p>
                <p className="info-line">Manual penalty total: {selectedStudent.integrityScore} | Events logged: {selectedStudent.totalEvents}</p>
                <p className="info-line">Latest case: {selectedStudent.caseId || "Not opened"} | Status: {getCaseDisplayStatus(selectedStudent)} | Decision: {selectedStudent.caseDecision || "Pending"}</p>
              </div>
              <span className="status-badge waiting">Attempt {selectedStudent.attemptNo}</span>
            </div>

            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={openCaseForStudent}>{selectedStudent.caseId && !selectedStudent.caseClosedAt ? "Open Existing Case" : "Open Case"}</button>
            </div>

            <div className="question-list">
              {selectedStudent.events.map((event) => {
                const draft = penaltyDrafts[event.eventId] || { penaltyPoints: "", note: "" };
                return <div key={event.eventId} className="question-preview-card">
                  <div className="publish-card-top">
                    <div>
                      <strong>{formatEventLabel(event.eventType)}</strong>
                      <p className="info-line">{formatDateTime(event.eventTime)}</p>
                    </div>
                    <span className={event.penaltyPoints !== null ? "status-badge ready" : "status-badge muted"}>{event.penaltyPoints !== null ? `Penalty: ${event.penaltyPoints}` : "No penalty assigned"}</span>
                  </div>
                  <span><strong>IP:</strong> {event.ipAddress || "-"}</span>
                  <span><strong>Device:</strong> {event.deviceFingerprint || "-"}</span>
                  <span><strong>Details:</strong> {formatDetails(event.details)}</span>
                  <span><strong>Assigned by:</strong> {event.assignedByName || "Not assigned yet"}</span>
                  <div className="task-page task-layout-split compact-split">
                    <label className="field">
                      <span>Penalty Points</span>
                      <input type="number" min="0" step="0.5" value={draft.penaltyPoints} onChange={(e) => setPenaltyDrafts({ ...penaltyDrafts, [event.eventId]: { ...draft, penaltyPoints: e.target.value } })} placeholder="0" />
                    </label>
                    <label className="field">
                      <span>Proctor Note</span>
                      <input value={draft.note} onChange={(e) => setPenaltyDrafts({ ...penaltyDrafts, [event.eventId]: { ...draft, note: e.target.value } })} placeholder="Explain the penalty decision" />
                    </label>
                  </div>
                  <div className="form-actions">
                    <button type="button" className="primary-button" onClick={() => assignPenalty(event.eventId)}>Save Penalty</button>
                  </div>
                </div>;
              })}
            </div>
          </> : <p>Select an exam and a flagged student to review suspicious activity logs.</p>}
        </div>

        <div className="task-card">
          {selectedStudent ? <form className="single-column" onSubmit={saveCaseDecision}>
            <div className="task-card-header">
              <div>
                <h3>Proctor Decision</h3>
                <p className="info-line">A case decision is required before admin can publish results for exams with opened cases.</p>
              </div>
            </div>

            <p className="info-line">Case ID: {selectedStudent.caseId || "Open a case first"}</p>
            <p className="info-line">Opened at: {formatDateTime(selectedStudent.caseOpenedAt)} | Closed at: {formatDateTime(selectedStudent.caseClosedAt)} | Display status: {getCaseDisplayStatus(selectedStudent)}</p>
            <label className="field"><span>Status</span><select value={decisionDraft.status} onChange={(e) => setDecisionDraft({ ...decisionDraft, status: e.target.value })}><option value="under_review">Under Review</option><option value="cleared">Cleared</option><option value="confirmed_cheating">Confirmed Cheating</option><option value="resolved">Resolved</option></select></label>
            <label className="field"><span>Decision</span><select value={decisionDraft.decision} onChange={(e) => setDecisionDraft({ ...decisionDraft, decision: e.target.value })}><option value="manual_review">Manual Review</option><option value="warning">Warning</option><option value="no_issue">No Issue</option><option value="invalidate_exam">Invalidate Exam</option></select></label>
            <label className="field"><span>Decision Notes</span><textarea rows="6" value={decisionDraft.decisionNotes} onChange={(e) => setDecisionDraft({ ...decisionDraft, decisionNotes: e.target.value })} placeholder="Summarize the proctor decision for this case" /></label>
            <div className="form-actions"><button className="primary-button" type="submit" disabled={!selectedStudent.caseId}>Save Proctor Decision</button></div>
          </form> : <p>Select a flagged student to open a case and record the proctor decision.</p>}
        </div>
      </div>
    </div>
  </section>;
}
