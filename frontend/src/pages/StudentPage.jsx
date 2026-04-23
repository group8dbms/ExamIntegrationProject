import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

function buildDeviceFingerprint() {
  return [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    `${window.screen.width}x${window.screen.height}`
  ].join("|");
}

function getWebcamErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Webcam permission was denied. Allow camera access before starting the exam.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No webcam was detected on this device. Connect a camera before starting the exam.";
    case "NotReadableError":
    case "TrackStartError":
      return "The webcam is currently unavailable. Close other apps using the camera and try again.";
    default:
      return "Webcam access is required before the exam can start.";
  }
}

function formatDateTime(value) {
  return new Date(value).toLocaleString();
}

function formatCaseStatus(caseStatus) {
  switch (caseStatus) {
    case "confirmed_cheating":
      return "Confirmed cheating";
    case "cleared":
      return "Cleared";
    case "resolved":
      return "Case closed";
    case "under_review":
      return "Under review";
    case "open":
      return "Open";
    case "not_opened":
    case "clear":
    case null:
    case undefined:
    case "":
      return "No case";
    default:
      return String(caseStatus).replace(/_/g, " ");
  }
}

function getResultBadge(item) {
  if (item.caseStatus === "confirmed_cheating") {
    return { label: "Disqualified", className: "status-badge disqualified" };
  }
  if (item.resultOutcome?.toLowerCase().includes("withheld")) {
    return { label: "Withheld", className: "status-badge waiting" };
  }
  if (item.resultOutcome?.toLowerCase().includes("failed")) {
    return { label: "Failed", className: "status-badge waiting" };
  }
  if (item.recheckRequest && ["requested", "accepted"].includes(item.recheckRequest.status)) {
    return { label: `Re-check ${item.recheckRequest.status}`, className: "status-badge waiting" };
  }
  return { label: item.recheckRequest ? `Re-check ${item.recheckRequest.status}` : "Published", className: "status-badge published" };
}

function computeStartState(item) {
  const now = Date.now();
  const startAt = new Date(item.start_at).getTime();
  const endAt = new Date(item.end_at).getTime();

  if (item.candidate_status === "not_appeared") {
    return { label: "Not appeared", disabled: true, tone: "danger" };
  }
  if (item.candidate_status === "submitted") {
    return { label: "Submitted", disabled: true, tone: "muted" };
  }
  if (item.candidate_status === "closed") {
    return { label: "Attempt closed", disabled: true, tone: "danger" };
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
  const [publishedResults, setPublishedResults] = useState([]);
  const [recheckDrafts, setRecheckDrafts] = useState({});
  const [startingExamId, setStartingExamId] = useState("");
  const popupWatchersRef = useRef(new Map());

  useEffect(() => {
    void loadWorkspace();
  }, [session?.id]);

  useEffect(() => {
    function handleExamSubmitted(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "student-exam-submitted" || event.data?.type === "student-exam-closed") {
        const activeWatcher = popupWatchersRef.current.get(event.data?.examId);
        if (activeWatcher) {
          window.clearInterval(activeWatcher.intervalId);
          popupWatchersRef.current.delete(event.data.examId);
        }
        void loadWorkspace();
      }
    }

    window.addEventListener("message", handleExamSubmitted);
    return () => window.removeEventListener("message", handleExamSubmitted);
  }, [session?.id]);

  useEffect(() => () => {
    popupWatchersRef.current.forEach((watcher) => window.clearInterval(watcher.intervalId));
    popupWatchersRef.current.clear();
  }, []);

  async function loadWorkspace() {
    await Promise.all([loadAssigned(), loadPublishedResults()]);
  }

  async function loadAssigned() {
    try {
      const exams = await api(`/api/exams/assigned/${session.id}`);
      setAssigned(exams.items || []);
      setMessage(`Welcome ${session.fullName}. ${exams.items.length} exams assigned.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadPublishedResults() {
    try {
      const data = await api(`/api/rechecks/student/${session.id}/results`);
      setPublishedResults(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function closeAttemptFromParent(examId, attemptNo) {
    try {
      await api("/api/submissions/close-attempt", {
        method: "POST",
        body: JSON.stringify({
          examId,
          attemptNo,
          currentAnswers: {},
          reason: "window_closed"
        })
      });
      setMessage("Exam window was closed. This attempt is now locked and cannot be restarted.");
      await loadAssigned();
    } catch (error) {
      if (String(error.message || "").includes("already been submitted") || String(error.message || "").includes("already closed")) {
        await loadAssigned();
        return;
      }
      setMessage(error.message);
    }
  }

async function logWebcamStartBlock(item, message, reason) {
    try {
      await api("/api/integrity/events", {
        method: "POST",
        body: JSON.stringify({
          examId: item.id,
          studentId: session.id,
          attemptNo: item.attempt_no,
          eventType: "webcam_block",
          weight: 4.5,
          deviceFingerprint: buildDeviceFingerprint(),
          createdBy: session.id,
          actorRole: "student",
          details: {
            stage: "pre_exam_start",
            reason,
            message
          }
        })
      });
    } catch {
      // Avoid blocking exam launch flow when webcam logging fails.
    }
  }

  async function logScreenShareStartBlock(item, message, reason) {
    try {
      await api("/api/integrity/events", {
        method: "POST",
        body: JSON.stringify({
          examId: item.id,
          studentId: session.id,
          attemptNo: item.attempt_no,
          eventType: "screen_share_block",
          weight: 5,
          deviceFingerprint: buildDeviceFingerprint(),
          createdBy: session.id,
          actorRole: "student",
          details: {
            stage: "pre_exam_start",
            reason,
            message
          }
        })
      });
    } catch {
      // Avoid blocking exam launch flow when screen-share logging fails.
    }
  }

  async function ensureWebcamAccessBeforeStart(item) {
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "This browser does not support webcam access. Use a supported browser before starting the exam.";
      await logWebcamStartBlock(item, message, "unsupported_browser");
      setMessage(message);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user"
        },
        audio: false
      });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      const message = getWebcamErrorMessage(error);
      await logWebcamStartBlock(item, message, error?.name || "webcam_unavailable");
      setMessage(message);
      return false;
    }
  }

  async function ensureScreenShareAccessBeforeStart(item) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const message = "This browser does not support screen sharing. Use a supported browser before starting the exam.";
      await logScreenShareStartBlock(item, message, "unsupported_browser");
      setMessage(message);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 10, max: 15 }
        },
        audio: false
      });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      const message = ["NotAllowedError", "PermissionDeniedError"].includes(error?.name || "")
        ? "Screen sharing was denied or cancelled. Start the exam again and allow sharing."
        : "Screen sharing could not be started. Try again before launching the exam.";
      await logScreenShareStartBlock(item, message, error?.name || "screen_share_unavailable");
      setMessage(message);
      return false;
    }
  }

  async function startExam(item) {
    const examId = item.id;
    setStartingExamId(examId);
    const url = new URL(window.location.href);
    url.search = "";
    const popup = window.open(url.toString(), `exam-window-${examId}`, "popup=yes,width=1440,height=920,resizable=yes,scrollbars=yes");
    if (!popup) {
      setMessage("Popup blocked. Allow popups for this site to start the exam window.");
      setStartingExamId("");
      return;
    }

    setMessage("Checking webcam and screen-sharing permissions before launching the exam window...");
    const webcamReady = await ensureWebcamAccessBeforeStart(item);
    if (!webcamReady) {
      popup.close();
      setStartingExamId("");
      return;
    }

    const screenShareReady = await ensureScreenShareAccessBeforeStart(item);
    if (!screenShareReady) {
      popup.close();
      setStartingExamId("");
      return;
    }

    url.search = `mode=exam&examId=${encodeURIComponent(examId)}`;
    popup.location.href = url.toString();

    const previousWatcher = popupWatchersRef.current.get(examId);
    if (previousWatcher) {
      window.clearInterval(previousWatcher.intervalId);
    }

    const intervalId = window.setInterval(() => {
      if (!popup.closed) return;

      window.clearInterval(intervalId);
      popupWatchersRef.current.delete(examId);
      void closeAttemptFromParent(examId, item.attempt_no);
    }, 1000);

    popupWatchersRef.current.set(examId, { popup, intervalId });
    popup.focus();
    setMessage("Exam window opened. Countdown and integrity monitoring start inside that window.");
    setStartingExamId("");
  }

  async function openResultReport(documentId) {
    try {
      const data = await api(`/api/documents/${documentId}/access-url`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function requestRecheck(resultId) {
    const reason = String(recheckDrafts[resultId] || "").trim();
    if (!reason) {
      setMessage("Enter a reason before requesting re-check.");
      return;
    }

    try {
      await api("/api/rechecks/requests", {
        method: "POST",
        body: JSON.stringify({
          resultId,
          studentId: session.id,
          actorUserId: session.id,
          reason
        })
      });
      setRecheckDrafts((current) => ({ ...current, [resultId]: "" }));
      setMessage("Re-check request submitted successfully.");
      await loadPublishedResults();
    } catch (error) {
      setMessage(error.message);
    }
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
              disabled={state.disabled || startingExamId === item.id}
              onClick={() => void startExam(item)}
            >
              {startingExamId === item.id ? "Checking webcam..." : state.label}
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

  const publishedResultCards = useMemo(
    () => publishedResults.map((item) => {
      const badge = getResultBadge(item);
      return (
        <div className="student-result-card" key={item.id}>
          <div className="task-card-header">
            <div>
              <strong>{item.examTitle}</strong>
              <p className="info-line">{item.courseCode}</p>
            </div>
            <span className={badge.className}>
              {badge.label}
            </span>
          </div>

          <div className="student-result-meta">
            <span>Marks: {item.awardedMarks}/{item.totalMarks}</span>
            <span>Percentage: {item.percentage}%</span>
            <span>Integrity score: {item.integrityScore}</span>
            <span>Case status: {formatCaseStatus(item.caseStatus)}</span>
            <span>Hash verified: {item.submissionHashVerified ? "Yes" : "No"}</span>
            <span>Outcome: {item.resultOutcome}</span>
          </div>

          {item.studentNotice ? <p className="info-line">{item.studentNotice}</p> : null}

          <div className="student-result-actions">
            {item.resultReportDocumentId ? (
              <button type="button" className="secondary-button" onClick={() => openResultReport(item.resultReportDocumentId)}>
                Open Result Report
              </button>
            ) : null}
          </div>

          {item.recheckRequest ? (
            <div className="student-recheck-status">
              <strong>Latest Re-check Request</strong>
              <p className="info-line">Status: {item.recheckRequest.status}</p>
              <p className="info-line">Reason: {item.recheckRequest.reason}</p>
              {item.recheckRequest.reviewedByName ? <p className="info-line">Reviewed by: {item.recheckRequest.reviewedByName}</p> : null}
              {item.recheckRequest.adjustedMarks !== null ? <p className="info-line">Adjusted marks: {item.recheckRequest.adjustedMarks}</p> : null}
              {item.recheckRequest.decisionNotes ? <p className="info-line">Decision notes: {item.recheckRequest.decisionNotes}</p> : null}
            </div>
          ) : (
            <div className="student-recheck-form">
              <label className="field">
                <span>Reason for re-check</span>
                <textarea
                  rows="3"
                  value={recheckDrafts[item.id] || ""}
                  onChange={(event) => setRecheckDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                  placeholder="Explain why you want this result to be reviewed."
                />
              </label>
              <div className="form-actions">
                <button type="button" className="primary-button" onClick={() => requestRecheck(item.id)}>
                  Request Re-check
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }),
    [publishedResults, recheckDrafts]
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
            <button type="button" className="secondary-button" onClick={loadWorkspace}>Refresh</button>
          </div>
          <div className="list-box">{assignedCards}{!assigned.length && <p>No assigned exams yet.</p>}</div>
        </div>

        <div className="task-card">
          <div className="task-card-header">
            <div>
              <h3>Published Results</h3>
              <p className="info-line">Open result reports and request re-check when needed.</p>
            </div>
            <button type="button" className="secondary-button" onClick={loadPublishedResults}>Refresh Results</button>
          </div>
          <div className="list-box">{publishedResultCards}{!publishedResults.length && <p>No published results yet.</p>}</div>
        </div>
      </div>

      <div className="task-intro">
        <p className="eyebrow">Exam Desk</p>
        <h3>Start only when the exam window opens</h3>
        <p>The start button stays gray until the configured start time is reached. When it turns green, click it to open a dedicated exam window with countdown, autosave, and integrity monitoring.</p>
      </div>
    </section>;
}
