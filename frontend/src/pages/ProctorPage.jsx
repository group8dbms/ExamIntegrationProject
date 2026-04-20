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

function formatCandidateStatus(status) {
  switch (status) {
    case "in_progress":
      return "Assigned";
    case "attempted":
      return "Attempted";
    case "closed":
      return "Attempt closed";
    case "submitted":
      return "Submitted";
    case "graded":
      return "Evaluated";
    case "not_appeared":
      return "Not appeared";
    default:
      return status || "Unknown";
  }
}

export default function ProctorPage({ session, onLogout, setMessage }) {
  const [activeView, setActiveView] = useState("monitor");
  const [liveExams, setLiveExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedExam, setSelectedExam] = useState(null);
  const [studentLogs, setStudentLogs] = useState([]);
  const [penaltyDrafts, setPenaltyDrafts] = useState({});
  const [decisionDrafts, setDecisionDrafts] = useState({});
  const [reassignRequests, setReassignRequests] = useState([]);

  useEffect(() => {
    void loadLiveExams();
    void loadPendingReassignRequests(false);
  }, [session?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadLiveExams(false);
      void loadPendingReassignRequests(false);
      if (selectedExamId) {
        void loadExamLogs(selectedExamId, false);
      }
    }, 10000);

    return () => window.clearInterval(timer);
  }, [selectedExamId]);

  const studentCards = useMemo(
    () => studentLogs.map((student) => ({
      ...student,
      key: `${student.studentId}:${student.attemptNo}`
    })),
    [studentLogs]
  );

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

      const nextDrafts = {};
      const nextDecisionDrafts = {};
      for (const student of data.items || []) {
        const studentKey = `${student.studentId}:${student.attemptNo}`;
        nextDecisionDrafts[studentKey] = createDecisionDraft(session?.id, student);
        for (const event of student.events || []) {
          nextDrafts[event.eventId] = {
            penaltyPoints: event.penaltyPoints ?? "",
            note: event.penaltyNote || ""
          };
        }
      }
      setPenaltyDrafts(nextDrafts);
      setDecisionDrafts(nextDecisionDrafts);

      if (announce) {
        setMessage(`Loaded suspicious logs for ${data.exam?.title || "the selected exam"}.`);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadPendingReassignRequests(announce = true) {
    try {
      const data = await api("/api/exams/reassign-requests/pending");
      const items = data.items || [];
      setReassignRequests(items);
      if (announce) {
        setMessage(items.length ? `Loaded ${items.length} pending reassign request(s) for proctor approval.` : "No pending reassign requests right now.");
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function approveReassignRequest(requestId) {
    try {
      const data = await api(`/api/exams/reassign-requests/${requestId}/approve`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage(data.message);
      await Promise.all([loadPendingReassignRequests(false), loadLiveExams(false)]);
      if (selectedExamId) {
        await loadExamLogs(selectedExamId, false);
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

  async function openCase(student) {
    if (!selectedExamId) {
      setMessage("Choose an exam first.");
      return;
    }

    try {
      const data = await api("/api/integrity/cases/open", {
        method: "POST",
        body: JSON.stringify({
          examId: selectedExamId,
          studentId: student.studentId,
          attemptNo: student.attemptNo,
          openedBy: session.id,
          actorRole: "proctor",
          summary: `Case opened by proctor for ${student.studentName} after reviewing suspicious activity logs.`
        })
      });
      setMessage(data.reused ? "Existing open case loaded for this student." : "New integrity case opened for this student.");
      await loadExamLogs(selectedExamId, false);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function updateDecisionDraft(studentKey, updates) {
    setDecisionDrafts((current) => ({
      ...current,
      [studentKey]: {
        ...(current[studentKey] || createDecisionDraft(session?.id)),
        ...updates
      }
    }));
  }

  async function saveCaseDecision(event, student) {
    event.preventDefault();
    if (!student?.caseId) {
      setMessage("Open a case for this student first.");
      return;
    }

    try {
      const draft = decisionDrafts[`${student.studentId}:${student.attemptNo}`] || createDecisionDraft(session?.id, student);
      const finalStatus = draft.status === "under_review" ? "resolved" : draft.status;
      const data = await api(`/api/integrity/cases/${student.caseId}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ ...draft, status: finalStatus, actorRole: "proctor" })
      });
      const storageNote = data.storageConfigured
        ? data.evidenceStored
          ? " Integrity evidence was uploaded automatically."
          : " Integrity evidence could not be uploaded."
        : " Secure storage is not configured, so no integrity evidence file was uploaded.";
      setMessage(`Proctor decision saved for this case.${storageNote}`);
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

    <div className="view-switcher">
      <button type="button" className={activeView === "monitor" ? "view-pill active" : "view-pill"} onClick={() => setActiveView("monitor")}>1. Live Monitoring</button>
      <button type="button" className={activeView === "reassign" ? "view-pill active" : "view-pill"} onClick={() => setActiveView("reassign")}>2. Reassign Approvals</button>
    </div>

    {activeView === "monitor" && (
      <div className="task-page">
        <div className="task-intro">
          <p className="eyebrow">Live Monitoring</p>
          <h3>Review Suspicious Activity Logs, Assign Penalties, and Close Case Decisions</h3>
          <p>Only students with suspicious activity appear here. Events stay stored after the exam, and the proctor can both assign penalties and record the case decision needed before admin publishes results. Saving the decision also generates the integrity evidence report used by auditors.</p>
        </div>

        <div className="publish-grid proctor-monitor-grid">
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
                <h3>Flagged Student Review</h3>
                <span className="info-line">{selectedExam ? `${selectedExam.title} | ${selectedExam.course_code}` : "Choose an exam to inspect"}</span>
              </div>
            </div>
            <div className="proctor-student-board">
              {studentCards.map((student) => {
                const studentKey = student.key;
                const decisionDraft = decisionDrafts[studentKey] || createDecisionDraft(session?.id, student);
                return (
                  <article key={studentKey} className="proctor-student-card">
                    <div className="proctor-student-card-header">
                      <div>
                        <strong>{student.studentName}</strong>
                        <p>{student.studentEmail}</p>
                      </div>
                      <div className="proctor-header-badges">
                        <span className="status-badge waiting">Attempt {student.attemptNo}</span>
                        <span className={student.integrityScore > 0 ? "status-badge waiting" : "status-badge muted"}>Penalty total: {student.integrityScore}</span>
                      </div>
                    </div>

                    <div className="proctor-student-meta">
                      <span>Status: {formatCandidateStatus(student.status)}</span>
                      <span>Events: {student.totalEvents}</span>
                      <span>Last seen: {formatDateTime(student.lastEventAt)}</span>
                      <span>Case: {getCaseDisplayStatus(student)}</span>
                      <span>Decision: {student.caseDecision || "Pending"}</span>
                      <span>Case ID: {student.caseId || "Not opened"}</span>
                    </div>

                    <div className="form-actions">
                      <button type="button" className="secondary-button" onClick={() => openCase(student)}>
                        {student.caseId && !student.caseClosedAt ? "Open Existing Case" : "Open Case"}
                      </button>
                    </div>

                    <div className="proctor-event-table">
                      <div className="proctor-event-table-head">
                        <span>Event</span>
                        <span>Time</span>
                        <span>Device / IP</span>
                        <span>Details</span>
                        <span>Penalty</span>
                        <span>Actions</span>
                      </div>
                      {(student.events || []).map((event) => {
                        const draft = penaltyDrafts[event.eventId] || { penaltyPoints: "", note: "" };
                        return (
                          <div key={event.eventId} className="proctor-event-row">
                            <div className="proctor-event-cell">
                              <strong>{formatEventLabel(event.eventType)}</strong>
                              <small>Assigned by: {event.assignedByName || "Not assigned yet"}</small>
                            </div>
                            <div className="proctor-event-cell">
                              <span>{formatDateTime(event.eventTime)}</span>
                            </div>
                            <div className="proctor-event-cell">
                              <span>Device: {event.deviceFingerprint || "-"}</span>
                              <small>IP: {event.ipAddress || "-"}</small>
                            </div>
                            <div className="proctor-event-cell">
                              <span>{formatDetails(event.details)}</span>
                            </div>
                            <div className="proctor-event-cell">
                              <label className="field compact-field">
                                <span>Points</span>
                                <input type="number" min="0" step="0.5" value={draft.penaltyPoints} onChange={(e) => setPenaltyDrafts({ ...penaltyDrafts, [event.eventId]: { ...draft, penaltyPoints: e.target.value } })} placeholder="0" />
                              </label>
                              <label className="field compact-field">
                                <span>Note</span>
                                <input value={draft.note} onChange={(e) => setPenaltyDrafts({ ...penaltyDrafts, [event.eventId]: { ...draft, note: e.target.value } })} placeholder="Penalty note" />
                              </label>
                            </div>
                            <div className="proctor-event-cell proctor-event-actions">
                              <span className={event.penaltyPoints !== null ? "status-badge ready" : "status-badge muted"}>
                                {event.penaltyPoints !== null ? `Saved: ${event.penaltyPoints}` : "Not saved"}
                              </span>
                              <button type="button" className="primary-button" onClick={() => assignPenalty(event.eventId)}>Save</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <form className="proctor-decision-form" onSubmit={(event) => saveCaseDecision(event, student)}>
                      <div className="task-card-header">
                        <div>
                          <h3>Proctor Decision</h3>
                          <p className="info-line">Save the review outcome here so publishing is not blocked for this student.</p>
                        </div>
                      </div>
                      <p className="info-line">Opened at: {formatDateTime(student.caseOpenedAt)} | Closed at: {formatDateTime(student.caseClosedAt)} | Display status: {getCaseDisplayStatus(student)}</p>
                      <div className="panel-grid proctor-decision-grid">
                        <label className="field">
                          <span>Status</span>
                          <select value={decisionDraft.status} onChange={(e) => updateDecisionDraft(studentKey, { status: e.target.value })}>
                            <option value="under_review">Under Review</option>
                            <option value="cleared">Cleared</option>
                            <option value="confirmed_cheating">Confirmed Cheating</option>
                            <option value="resolved">Resolved</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Decision</span>
                          <select value={decisionDraft.decision} onChange={(e) => updateDecisionDraft(studentKey, { decision: e.target.value })}>
                            <option value="manual_review">Manual Review</option>
                            <option value="warning">Warning</option>
                            <option value="no_issue">No Issue</option>
                            <option value="invalidate_exam">Invalidate Exam</option>
                          </select>
                        </label>
                        <label className="field wide">
                          <span>Decision Notes</span>
                          <textarea rows="4" value={decisionDraft.decisionNotes} onChange={(e) => updateDecisionDraft(studentKey, { decisionNotes: e.target.value })} placeholder="Summarize the proctor decision for this case" />
                        </label>
                      </div>
                      <div className="form-actions">
                        <button className="primary-button" type="submit" disabled={!student.caseId}>Save Proctor Decision</button>
                      </div>
                    </form>
                  </article>
                );
              })}
              {!studentCards.length && <p>No suspicious logs recorded for this exam yet.</p>}
            </div>
          </div>
        </div>
      </div>
    )}

    {activeView === "reassign" && (
      <div className="task-page">
        <div className="task-intro">
          <p className="eyebrow">Approval Queue</p>
          <h3>Approve Student Reassign Requests</h3>
          <p>When admin asks to reopen a student attempt, approval here will reset that attempt and allow the same exam to be started again.</p>
        </div>

        <div className="task-card">
          <div className="task-card-header">
            <div>
              <h3>Pending Requests</h3>
              <span className="info-line">{reassignRequests.length} request(s) waiting for proctor approval</span>
            </div>
            <button type="button" className="secondary-button" onClick={() => loadPendingReassignRequests()}>Refresh</button>
          </div>

          {reassignRequests.length ? (
            <div className="reassign-candidate-list">
              {reassignRequests.map((request) => (
                <div key={request.id} className="reassign-candidate-card">
                  <div className="publish-card-top">
                    <div>
                      <strong>{request.studentName}</strong>
                      <p>{request.studentEmail}</p>
                    </div>
                    <span className={request.candidateStatus === "closed" ? "status-badge disqualified" : request.candidateStatus === "attempted" ? "status-badge waiting" : "status-badge muted"}>
                      {formatCandidateStatus(request.candidateStatus)}
                    </span>
                  </div>

                  <div className="reassign-meta-grid">
                    <span>Exam: {request.examTitle}</span>
                    <span>Course: {request.courseCode}</span>
                    <span>Attempt: {request.attemptNo}</span>
                    <span>Requested By: {request.requestedByName}</span>
                    <span>Started: {request.startedAt ? formatDateTime(request.startedAt) : "-"}</span>
                    <span>Submitted: {request.submittedAt ? formatDateTime(request.submittedAt) : "-"}</span>
                  </div>

                  {request.adminNote ? <p className="info-line">Admin note: {request.adminNote}</p> : null}

                  <div className="form-actions">
                    <button type="button" className="primary-button" onClick={() => approveReassignRequest(request.id)}>Approve Reassign</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="info-line">No reassign approvals are pending right now.</p>
          )}
        </div>
      </div>
    )}
  </section>;
}
