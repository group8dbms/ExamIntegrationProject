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

function getEventShortLabel(type) {
  switch (type) {
    case "tab_switch":
      return "Tab switch";
    case "window_blur":
      return "Window blur";
    case "full_exit_screen":
      return "Exit screen";
    default:
      return formatEventLabel(type);
  }
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

function hasPendingReview(student) {
  return !student.caseId || !student.caseDecision || !student.caseClosedAt;
}

function getDecisionLabel(value) {
  return String(value || "pending")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ProctorPage({ session, onLogout, setMessage }) {
  const [activeView, setActiveView] = useState("monitor");
  const [liveExams, setLiveExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedExam, setSelectedExam] = useState(null);
  const [studentLogs, setStudentLogs] = useState([]);
  const [screenEvidenceByStudent, setScreenEvidenceByStudent] = useState({});
  const [webcamEvidenceByStudent, setWebcamEvidenceByStudent] = useState({});
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
      if (selectedExamId && !items.some((item) => item.id === selectedExamId)) {
        setSelectedExamId("");
        setSelectedExam(null);
        setStudentLogs([]);
        setPenaltyDrafts({});
        setDecisionDrafts({});
      }
      if (announce) {
        setMessage(items.length ? `Loaded ${items.length} exam(s) with suspicious activity review records.` : "No suspicious activity reviews found right now.");
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
      await Promise.all([
        loadScreenEvidence(examId, data.items || []),
        loadWebcamEvidence(examId, data.items || [])
      ]);

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

  async function loadScreenEvidence(examId, students) {
    try {
      const documents = await api(`/api/documents?examId=${examId}&documentType=screen_share_evidence`);
      const docsByStudent = new Map();

      for (const item of documents.items || []) {
        const key = String(item.student_id || "");
        if (!docsByStudent.has(key)) {
          docsByStudent.set(key, []);
        }
        docsByStudent.get(key).push(item);
      }

      const nextEvidence = {};
      for (const student of students) {
        const items = (docsByStudent.get(String(student.studentId)) || []).slice(0, 6);
        nextEvidence[student.studentId] = await Promise.all(items.map(async (item) => {
          try {
            const access = await api(`/api/documents/${item.id}/access-url`);
            return {
              id: item.id,
              createdAt: item.created_at,
              originalName: item.original_name,
              url: access.url
            };
          } catch {
            return null;
          }
        }));
        nextEvidence[student.studentId] = nextEvidence[student.studentId].filter(Boolean);
      }

      setScreenEvidenceByStudent(nextEvidence);
    } catch {
      setScreenEvidenceByStudent({});
    }
  }

  async function loadWebcamEvidence(examId, students) {
    try {
      const documents = await api(`/api/documents?examId=${examId}&documentType=webcam_evidence`);
      const docsByStudent = new Map();

      for (const item of documents.items || []) {
        const key = String(item.student_id || "");
        if (!docsByStudent.has(key)) {
          docsByStudent.set(key, []);
        }
        docsByStudent.get(key).push(item);
      }

      const nextEvidence = {};
      for (const student of students) {
        const items = (docsByStudent.get(String(student.studentId)) || []).slice(0, 6);
        nextEvidence[student.studentId] = await Promise.all(items.map(async (item) => {
          try {
            const access = await api(`/api/documents/${item.id}/access-url`);
            return {
              id: item.id,
              createdAt: item.created_at,
              originalName: item.original_name,
              url: access.url
            };
          } catch {
            return null;
          }
        }));
        nextEvidence[student.studentId] = nextEvidence[student.studentId].filter(Boolean);
      }

      setWebcamEvidenceByStudent(nextEvidence);
    } catch {
      setWebcamEvidenceByStudent({});
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

  function updateDecisionDraft(studentKey, updates) {
    setDecisionDrafts((current) => ({
      ...current,
      [studentKey]: {
        ...(current[studentKey] || createDecisionDraft(session?.id)),
        ...updates
      }
    }));
  }

  async function submitCaseReview(event, student) {
    event.preventDefault();
    try {
      const studentKey = `${student.studentId}:${student.attemptNo}`;
      const draft = decisionDrafts[studentKey] || createDecisionDraft(session?.id, student);
      if (!String(draft.decisionNotes || "").trim()) {
        setMessage("Enter the proctor reason before submitting the case.");
        return;
      }

      const penalties = (student.events || []).map((item) => {
        const penaltyDraft = penaltyDrafts[item.eventId] || { penaltyPoints: item.penaltyPoints ?? "" };
        const rawValue = penaltyDraft.penaltyPoints === "" ? (item.penaltyPoints ?? 0) : penaltyDraft.penaltyPoints;
        return {
          eventId: item.eventId,
          penaltyPoints: Number(rawValue)
        };
      });

      if (penalties.some((item) => Number.isNaN(item.penaltyPoints) || item.penaltyPoints < 0)) {
        setMessage("Penalty points must be valid non-negative numbers before submitting the case.");
        return;
      }

      const finalStatus = draft.status === "under_review" ? "resolved" : draft.status;
      const data = await api("/api/integrity/cases/submit-review", {
        method: "POST",
        body: JSON.stringify({
          examId: selectedExamId,
          studentId: student.studentId,
          attemptNo: student.attemptNo,
          penalties,
          status: finalStatus,
          decision: draft.decision,
          decisionNotes: draft.decisionNotes
        })
      });
      const storageNote = data.storageConfigured
        ? data.evidenceStored
          ? " Integrity evidence was uploaded automatically."
          : " Integrity evidence could not be uploaded."
        : " Secure storage is not configured, so no integrity evidence file was uploaded.";
      setMessage(`Proctor review submitted for this case.${storageNote}`);
      await Promise.all([loadExamLogs(selectedExamId, false), loadLiveExams(false)]);
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
                <p className="info-line">Flagged students: {exam.flagged_student_count} | Pending reviews: {exam.pending_review_count} | Suspicious events: {exam.suspicious_event_count}</p>
                <p className="info-line">Window: {formatDateTime(exam.start_at)} to {formatDateTime(exam.end_at)}</p>
                <p className="info-line">Last event: {formatDateTime(exam.last_event_at)}</p>
              </button>)}
              {!liveExams.length && <p>No exams have suspicious activity review records right now.</p>}
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
              {selectedExamId ? studentCards.map((student) => {
                const studentKey = student.key;
                const decisionDraft = decisionDrafts[studentKey] || createDecisionDraft(session?.id, student);
                const pendingReview = hasPendingReview(student);
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
                        <span className={pendingReview ? "status-badge waiting" : "status-badge ready"}>{pendingReview ? "Pending Review" : "Reviewed"}</span>
                      </div>
                    </div>

                    <div className="proctor-student-meta">
                      <span>Status: {formatCandidateStatus(student.candidateStatus)}</span>
                      <span>Events: {student.totalEvents}</span>
                      <span>Last seen: {formatDateTime(student.lastEventAt)}</span>
                      <span>Case: {getCaseDisplayStatus(student)}</span>
                      <span>Decision: {student.caseDecision || "Pending"}</span>
                      <span>Case ID: {student.caseId || "Not opened"}</span>
                    </div>

                    {screenEvidenceByStudent[student.studentId]?.length ? (
                      <div className="proctor-evidence-panel">
                        <div className="task-card-header">
                          <div>
                            <h3>Screen Evidence</h3>
                            <p className="info-line">Latest screenshots captured from the shared screen during this exam attempt.</p>
                          </div>
                        </div>
                        <div className="proctor-evidence-grid">
                          {screenEvidenceByStudent[student.studentId].map((item) => (
                            <a
                              key={item.id}
                              className="proctor-evidence-card"
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img src={item.url} alt={item.originalName || "Screen evidence"} />
                              <span>{formatDateTime(item.createdAt)}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {webcamEvidenceByStudent[student.studentId]?.length ? (
                      <div className="proctor-evidence-panel">
                        <div className="task-card-header">
                          <div>
                            <h3>Webcam Evidence</h3>
                            <p className="info-line">Latest webcam snapshots captured during this exam attempt.</p>
                          </div>
                        </div>
                        <div className="proctor-evidence-grid">
                          {webcamEvidenceByStudent[student.studentId].map((item) => (
                            <a
                              key={item.id}
                              className="proctor-evidence-card"
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img src={item.url} alt={item.originalName || "Webcam evidence"} />
                              <span>{formatDateTime(item.createdAt)}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {pendingReview ? (
                      <>
                        <div className="proctor-event-list">
                          {(student.events || []).map((event) => {
                            const draft = penaltyDrafts[event.eventId] || { penaltyPoints: event.penaltyPoints ?? "", note: event.penaltyNote || "" };
                            return (
                              <div key={event.eventId} className="proctor-event-row">
                                <div className="proctor-event-row-main">
                                  <div className="proctor-event-heading">
                                    <strong>{getEventShortLabel(event.eventType)}</strong>
                                    <span className="status-badge muted">{formatDateTime(event.eventTime)}</span>
                                  </div>
                                  <div className="proctor-event-meta">
                                    <span>Device: {event.deviceFingerprint || "-"}</span>
                                    <span>IP: {event.ipAddress || "-"}</span>
                                    <span>Assigned by: {event.assignedByName || "Not assigned yet"}</span>
                                  </div>
                                  <p className="info-line">Details: {formatDetails(event.details)}</p>
                                </div>
                                <div className="proctor-event-row-editor single-input">
                                  <label className="field compact-field">
                                    <span>Penalty Points</span>
                                    <input type="number" min="0" step="0.5" value={draft.penaltyPoints} onChange={(e) => setPenaltyDrafts({ ...penaltyDrafts, [event.eventId]: { ...draft, penaltyPoints: e.target.value } })} placeholder="0" />
                                  </label>
                                  <span className={event.penaltyPoints !== null ? "status-badge ready" : "status-badge muted"}>
                                    {event.penaltyPoints !== null ? `Current: ${event.penaltyPoints}` : "Current: 0"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <form className="proctor-decision-form" onSubmit={(event) => submitCaseReview(event, student)}>
                          <div className="task-card-header">
                            <div>
                              <h3>Submit Proctor Review</h3>
                              <p className="info-line">Assign all penalty points, write the reason once, and submit the full case review in one action.</p>
                            </div>
                          </div>
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
                              <span>Reason</span>
                              <textarea rows="4" value={decisionDraft.decisionNotes} onChange={(e) => updateDecisionDraft(studentKey, { decisionNotes: e.target.value })} placeholder="Write the full reason for this case decision" />
                            </label>
                          </div>
                          <div className="form-actions">
                            <button className="primary-button" type="submit">Submit Full Case Review</button>
                          </div>
                        </form>
                      </>
                    ) : (
                      <>
                        <div className="task-card-header">
                          <div>
                            <h3>Submitted Review</h3>
                            <p className="info-line">This case is already closed and is shown below in read-only audit style.</p>
                          </div>
                        </div>
                        <div className="audit-table-wrap">
                          <table className="audit-table proctor-case-table">
                            <thead>
                              <tr>
                                <th>Event</th>
                                <th>Time</th>
                                <th>Penalty</th>
                                <th>Device</th>
                                <th>IP</th>
                                <th>Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(student.events || []).map((event) => (
                                <tr key={event.eventId}>
                                  <td>{getEventShortLabel(event.eventType)}</td>
                                  <td>{formatDateTime(event.eventTime)}</td>
                                  <td>{event.penaltyPoints ?? 0}</td>
                                  <td>{event.deviceFingerprint || "-"}</td>
                                  <td>{event.ipAddress || "-"}</td>
                                  <td>{formatDetails(event.details)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="audit-table-wrap">
                          <table className="audit-table proctor-case-table">
                            <thead>
                              <tr>
                                <th>Case Status</th>
                                <th>Decision</th>
                                <th>Reason</th>
                                <th>Opened</th>
                                <th>Closed</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>{getCaseDisplayStatus(student)}</td>
                                <td>{getDecisionLabel(student.caseDecision)}</td>
                                <td>{student.caseDecisionNotes || "-"}</td>
                                <td>{formatDateTime(student.caseOpenedAt)}</td>
                                <td>{formatDateTime(student.caseClosedAt)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </article>
                );
              }) : <p>Select an exam to review pending student cases.</p>}
              {selectedExamId && !studentCards.length && <p>No suspicious logs recorded for this exam yet.</p>}
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
