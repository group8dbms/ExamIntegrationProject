import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

const ACTIVE_ATTEMPT_KEY = "exam-integrity-active-attempt";

function buildDeviceFingerprint() {
  return [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    `${window.screen.width}x${window.screen.height}`
  ].join("|");
}

async function fetchPublicIp() {
  const response = await fetch("https://api.ipify.org?format=json");
  if (!response.ok) throw new Error("Unable to detect public IP.");
  const data = await response.json();
  return data.ip || null;
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const hours = String(Math.floor(safe / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export default function StudentExamWindow({ session, examId, onExit, setMessage }) {
  const [examPaper, setExamPaper] = useState(null);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [integrityInfo, setIntegrityInfo] = useState({ tabSwitches: 0, copyAttempts: 0, pasteAttempts: 0, ipAddress: null, integrityScore: 0, caseStatus: "clear", submissionHashVerified: false });
  const [localWarning, setLocalWarning] = useState("");
  const [warningVersion, setWarningVersion] = useState(0);
  const examPaperRef = useRef(null);
  const answersRef = useRef({});
  const autosaveRef = useRef(null);
  const timerRef = useRef(null);
  const ipPollRef = useRef(null);
  const submittedRef = useRef(false);
  const deviceFingerprintRef = useRef(buildDeviceFingerprint());
  const ipAddressRef = useRef(null);
  const tabSwitchCountRef = useRef(0);
  const copyCountRef = useRef(0);
  const pasteCountRef = useRef(0);

  useEffect(() => {
    void loadExamWindow();
    return () => {
      cleanupRuntime();
      localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
    };
  }, [examId]);

  useEffect(() => {
    examPaperRef.current = examPaper;
  }, [examPaper]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  function cleanupRuntime() {
    if (autosaveRef.current) window.clearInterval(autosaveRef.current);
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (ipPollRef.current) window.clearInterval(ipPollRef.current);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("blur", handleWindowBlur);
    window.removeEventListener("copy", handleCopyAttempt);
    window.removeEventListener("paste", handlePasteAttempt);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  }

  async function loadExamWindow() {
    try {
      const data = await api(`/api/exams/${examId}/paper?studentId=${session.id}`);
      setExamPaper(data);
      examPaperRef.current = data;
      const seed = {};
      data.questions.forEach((question) => {
        seed[question.id] = question.question_type === "msq" ? [] : "";
      });
      setAnswers(seed);
      answersRef.current = seed;

      const activeAttempt = localStorage.getItem(ACTIVE_ATTEMPT_KEY);
      if (activeAttempt && activeAttempt !== `${data.exam.id}:${session.id}:${data.exam.attempt_no}`) {
        await logIntegrityEvent("multiple_login", { note: "Another exam attempt window was already active." }, 4);
      }
      localStorage.setItem(ACTIVE_ATTEMPT_KEY, `${data.exam.id}:${session.id}:${data.exam.attempt_no}`);

      const now = Date.now();
      const effectiveEnd = new Date(data.exam.effective_end_at || data.exam.end_at).getTime();
      setTimeLeft(Math.max(0, Math.floor((effectiveEnd - now) / 1000)));

      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("copy", handleCopyAttempt);
      window.addEventListener("paste", handlePasteAttempt);
      window.addEventListener("beforeunload", handleBeforeUnload);

      timerRef.current = window.setInterval(() => {
        setTimeLeft((current) => {
          if (current <= 1) {
            window.clearInterval(timerRef.current);
            void submitExam(true);
            return 0;
          }
          return current - 1;
        });
      }, 1000);

      autosaveRef.current = window.setInterval(() => {
        void autosaveAnswers(answersRef.current);
      }, 15000);

      await captureInitialEnvironment();
      ipPollRef.current = window.setInterval(() => {
        void checkIpChange();
      }, 45000);

      setMessage(`Exam window started for ${data.exam.title}.`);
    } catch (error) {
      setMessage(error.message);
    }
  }


  function showLocalWarning(message) {
    setLocalWarning(message);
    setWarningVersion((current) => current + 1);
    if (document.visibilityState === "visible") {
      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }, 25);
    }
  }

  async function captureInitialEnvironment() {
    try {
      const ip = await fetchPublicIp();
      ipAddressRef.current = ip;
      setIntegrityInfo((current) => ({ ...current, ipAddress: ip }));
    } catch {
      setIntegrityInfo((current) => ({ ...current, ipAddress: "Unavailable" }));
    }
  }

  async function checkIpChange() {
    try {
      const latestIp = await fetchPublicIp();
      if (ipAddressRef.current && latestIp && ipAddressRef.current !== latestIp) {
        showLocalWarning("Warning: IP change detected and logged.");
        await logIntegrityEvent("ip_change", { previousIp: ipAddressRef.current, newIp: latestIp }, 5, latestIp);
      }
      ipAddressRef.current = latestIp;
      setIntegrityInfo((current) => ({ ...current, ipAddress: latestIp }));
    } catch {
      // Ignore transient IP lookup failures.
    }
  }

  async function logIntegrityEvent(eventType, details = {}, weight = null, ipOverride = null) {
    const activeExamPaper = examPaperRef.current;
    if (!activeExamPaper) return;
    try {
      const data = await api("/api/integrity/events", {
        method: "POST",
        body: JSON.stringify({
          examId: activeExamPaper.exam.id,
          studentId: session.id,
          attemptNo: activeExamPaper.exam.attempt_no,
          eventType,
          weight,
          ipAddress: ipOverride || ipAddressRef.current,
          deviceFingerprint: deviceFingerprintRef.current,
          details,
          createdBy: session.id,
          actorRole: "student"
        })
      });
      if (data?.candidateSummary) {
        setIntegrityInfo((current) => ({
          ...current,
          integrityScore: data.candidateSummary.integrity_score ?? current.integrityScore,
          caseStatus: data.candidateSummary.case_status ?? current.caseStatus,
          submissionHashVerified: data.candidateSummary.submission_hash_verified ?? current.submissionHashVerified
        }));
      }
      return data;
    } catch (error) {
      console.warn("Failed to log integrity event", eventType, error);
      return null;
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      tabSwitchCountRef.current += 1;
      setIntegrityInfo((current) => ({ ...current, tabSwitches: tabSwitchCountRef.current }));
      showLocalWarning(`Warning: tab switch detected (${tabSwitchCountRef.current}). This has been recorded.`);
      void logIntegrityEvent("tab_switch", { count: tabSwitchCountRef.current, source: "visibilitychange" }, 2);
    }
  }

  function handleWindowBlur() {
    if (!document.hidden) {
      tabSwitchCountRef.current += 1;
      setIntegrityInfo((current) => ({ ...current, tabSwitches: tabSwitchCountRef.current }));
      showLocalWarning(`Warning: tab switch detected (${tabSwitchCountRef.current}). This has been recorded.`);
      void logIntegrityEvent("fullscreen_exit", { count: tabSwitchCountRef.current, source: "window_blur" }, 1);
    }
  }

  function handleCopyAttempt() {
    copyCountRef.current += 1;
    setIntegrityInfo((current) => ({ ...current, copyAttempts: copyCountRef.current }));
    showLocalWarning("Warning: copy attempt detected and logged.");
    void logIntegrityEvent("copy_attempt", { count: copyCountRef.current }, 2);
  }

  function handlePasteAttempt() {
    pasteCountRef.current += 1;
    setIntegrityInfo((current) => ({ ...current, pasteAttempts: pasteCountRef.current }));
    showLocalWarning("Warning: paste attempt detected and logged.");
    void logIntegrityEvent("paste_attempt", { count: pasteCountRef.current }, 2);
  }

  function handleBeforeUnload() {
    if (!submittedRef.current) {
      void autosaveAnswers(answersRef.current);
    }
  }

  async function autosaveAnswers(currentAnswers = answers) {
    const activeExamPaper = examPaperRef.current;
    if (!activeExamPaper || submittedRef.current) return;
    try {
      await api("/api/submissions/autosave", {
        method: "POST",
        body: JSON.stringify({
          examId: activeExamPaper.exam.id,
          studentId: session.id,
          attemptNo: activeExamPaper.exam.attempt_no,
          actorUserId: session.id,
          currentAnswers
        })
      });
    } catch {
      // Avoid interrupting the exam flow for autosave retries.
    }
  }

  function updateAnswer(question, option) {
    setAnswers((current) => {
      if (question.question_type === "msq") {
        const selected = current[question.id] || [];
        const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option];
        return { ...current, [question.id]: next };
      }
      return { ...current, [question.id]: option };
    });
  }

  async function submitExam(autoSubmit = false) {
    const activeExamPaper = examPaperRef.current;
    if (!activeExamPaper || submittedRef.current) return;
    submittedRef.current = true;
    cleanupRuntime();
    try {
      await api("/api/submissions/finalize", {
        method: "POST",
        body: JSON.stringify({
          examId: activeExamPaper.exam.id,
          studentId: session.id,
          attemptNo: activeExamPaper.exam.attempt_no,
          actorUserId: session.id,
          finalAnswers: answersRef.current
        })
      });
      localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
      setMessage(autoSubmit ? "Time is over. Exam auto-submitted successfully." : "Exam submitted successfully.");
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "student-exam-submitted", examId: activeExamPaper.exam.id }, window.location.origin);
      }
      window.setTimeout(() => onExit?.(), 1200);
    } catch (error) {
      submittedRef.current = false;
      setMessage(error.message);
    }
  }

  const examMeta = examPaper?.exam;
  const summaryText = useMemo(() => `${integrityInfo.tabSwitches} tab switches | ${integrityInfo.copyAttempts} copy attempts | ${integrityInfo.pasteAttempts} paste attempts`, [integrityInfo]);

  if (!examPaper) {
    return <section className="workspace-shell exam-window-shell"><div className="task-card"><h2>Loading exam window...</h2></div></section>;
  }

  return (
    <section className="workspace-shell exam-window-shell">
      <div className="workspace-header exam-window-header">
        <div>
          <p className="eyebrow">Student Exam Window</p>
          <h2>{examMeta.title}</h2>
          <p className="info-line">{examMeta.course_code} | Attempt {examMeta.attempt_no}</p>
        </div>
        <div className="exam-timer-card">
          <span className="status-label">Time Remaining</span>
          <strong>{formatDuration(timeLeft)}</strong>
          <p>{summaryText}</p>
          <p>Integrity score: {integrityInfo.integrityScore} | Case status: {integrityInfo.caseStatus}</p>
        </div>
      </div>

      {localWarning ? <>
        <div key={`banner-${warningVersion}`} className="local-warning-banner"><strong>Live Warning</strong><span>{localWarning}</span></div>
        <div key={`toast-${warningVersion}`} className="local-warning-toast" role="alert" aria-live="assertive">
          <strong>Warning recorded</strong>
          <span>{localWarning}</span>
        </div>
      </> : null}

      <div className="exam-window-grid">
        <div className="task-card exam-guidance-card">
          <h3>Exam Rules</h3>
          <p className="info-line">Do not switch tabs, copy, or paste. Integrity events are recorded in real time and reviewed later by the proctor.</p>
          <p className="info-line">Current IP: {integrityInfo.ipAddress || "Checking..."}</p>
          <p className="info-line">Submission hash verified: {integrityInfo.submissionHashVerified ? "Yes" : "Pending final verification"}</p>
          <button type="button" className="secondary-button" onClick={() => autosaveAnswers()}>Save Progress</button>
        </div>

        <form className="task-card single-column" onSubmit={(event) => { event.preventDefault(); void submitExam(false); }}>
          <div className="question-list">
            {examPaper.questions.map((question) => (
              <div className="list-item question-sheet-card" key={question.id}>
                <strong>{question.sequence_no}. {question.prompt}</strong>
                <span>{question.question_type.toUpperCase()} | {question.marks} marks</span>
                <div className="list-box">
                  {question.options.map((option) => (
                    <label key={option} className="option-pill">
                      <input
                        type={question.question_type === "msq" ? "checkbox" : "radio"}
                        name={question.id}
                        checked={question.question_type === "msq" ? (answers[question.id] || []).includes(option) : answers[question.id] === option}
                        onChange={() => updateAnswer(question, option)}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit">Submit Exam</button>
            <button type="button" className="ghost-button" onClick={() => autosaveAnswers()}>Autosave Now</button>
          </div>
        </form>
      </div>
    </section>
  );
}
