import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

const ACTIVE_ATTEMPT_KEY = "exam-integrity-active-attempt";
const EVIDENCE_CAPTURE_INTERVAL_MS = 15000;

function getInheritedLaunchMedia(examId) {
  try {
    const directMedia = window.__examInheritedMedia;
    if (directMedia && (!window.__examInheritedExamId || String(window.__examInheritedExamId) === String(examId))) {
      return directMedia;
    }
    const openerStore = window.opener?.__examLaunchMediaStore;
    return openerStore?.[examId] || null;
  } catch {
    return null;
  }
}

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

function getWebcamErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Webcam permission was denied. Re-enable camera access to continue the exam.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No webcam was detected. Connect a camera and retry to continue the exam.";
    case "NotReadableError":
    case "TrackStartError":
      return "The webcam is busy in another application. Close the other app and retry.";
    default:
      return "Webcam access is required to continue this exam.";
  }
}

export default function StudentExamWindow({ session, examId, onExit, setMessage }) {
  const [examPaper, setExamPaper] = useState(null);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [integrityInfo, setIntegrityInfo] = useState({ tabSwitches: 0, copyAttempts: 0, pasteAttempts: 0, ipAddress: null, integrityScore: 0, caseStatus: "clear", submissionHashVerified: false });
  const [webcamStatus, setWebcamStatus] = useState("checking");
  const [webcamError, setWebcamError] = useState("");
  const [screenShareStatus, setScreenShareStatus] = useState("checking");
  const [screenShareError, setScreenShareError] = useState("");
  const [localWarning, setLocalWarning] = useState("");
  const [warningVersion, setWarningVersion] = useState(0);
  const [manualAutosaveNotice, setManualAutosaveNotice] = useState("");
  const [manualAutosaveVersion, setManualAutosaveVersion] = useState(0);
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
  const isClosingRef = useRef(false);
  const sessionTokenRef = useRef("");
  const webcamVideoRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const webcamHealthRef = useRef(null);
  const webcamBlockReasonRef = useRef("");
  const webcamEvidenceIntervalRef = useRef(null);
  const webcamEvidenceEnabledRef = useRef(true);
  const webcamEvidenceUploadingRef = useRef(false);
  const screenShareVideoRef = useRef(null);
  const screenShareStreamRef = useRef(null);
  const screenShareHealthRef = useRef(null);
  const screenShareBlockReasonRef = useRef("");
  const screenEvidenceIntervalRef = useRef(null);
  const screenEvidenceEnabledRef = useRef(true);
  const screenEvidenceUploadingRef = useRef(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("exam-integrity-session") || "null");
      sessionTokenRef.current = stored?.token || "";
    } catch {
      sessionTokenRef.current = "";
    }
  }, []);

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
    if (webcamHealthRef.current) window.clearInterval(webcamHealthRef.current);
    if (webcamEvidenceIntervalRef.current) window.clearInterval(webcamEvidenceIntervalRef.current);
    if (screenShareHealthRef.current) window.clearInterval(screenShareHealthRef.current);
    if (screenEvidenceIntervalRef.current) window.clearInterval(screenEvidenceIntervalRef.current);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("blur", handleWindowBlur);
    window.removeEventListener("copy", handleCopyAttempt);
    window.removeEventListener("paste", handlePasteAttempt);
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("pagehide", handlePageHide);
    stopWebcamStream();
    stopScreenShareStream();
  }

  function stopWebcamStream() {
    if (webcamHealthRef.current) {
      window.clearInterval(webcamHealthRef.current);
      webcamHealthRef.current = null;
    }
    if (webcamEvidenceIntervalRef.current) {
      window.clearInterval(webcamEvidenceIntervalRef.current);
      webcamEvidenceIntervalRef.current = null;
    }

    const stream = webcamStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      webcamStreamRef.current = null;
    }

    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }
  }

  async function uploadWebcamEvidence(reason = "interval") {
    const activeExamPaper = examPaperRef.current;
    const token = sessionTokenRef.current;
    const video = webcamVideoRef.current;
    if (!activeExamPaper || !token || !webcamEvidenceEnabledRef.current || webcamEvidenceUploadingRef.current) {
      return;
    }
    if (!video || webcamStatus !== "active" || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const targetWidth = Math.min(video.videoWidth, 960);
    const scale = targetWidth / video.videoWidth;
    const targetHeight = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.translate(targetWidth, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    webcamEvidenceUploadingRef.current = true;

    try {
      const blob = await new Promise((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/jpeg", 0.72);
      });

      if (!blob) {
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const formData = new FormData();
      formData.append("file", blob, `webcam-${reason}-${timestamp}.jpg`);
      formData.append("examId", activeExamPaper.exam.id);
      formData.append("studentId", session.id);
      formData.append("documentType", "webcam_evidence");
      formData.append("actorRole", "student");

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? await response.json()
          : await response.text();
        const message = payload?.message || payload || "Evidence upload failed.";

        if (response.status === 400 && /not configured/i.test(String(message))) {
          webcamEvidenceEnabledRef.current = false;
          return;
        }

        throw new Error(String(message));
      }
    } catch (error) {
      console.warn("Failed to upload webcam evidence", error);
    } finally {
      webcamEvidenceUploadingRef.current = false;
    }
  }

  async function markWebcamBlocked(reason, message, details = {}) {
    stopWebcamStream();
    setWebcamStatus("blocked");
    setWebcamError(message);
    showLocalWarning(message);

    if (webcamBlockReasonRef.current === reason) {
      return;
    }
    webcamBlockReasonRef.current = reason;

    await logIntegrityEvent("webcam_block", {
      reason,
      message,
      ...details
    }, 4.5);
  }

  async function startWebcamMonitoring() {
    setWebcamStatus("checking");
    setWebcamError("");

    try {
      stopWebcamStream();
      const inherited = getInheritedLaunchMedia(examId);
      const stream = inherited?.webcamStream || await navigator.mediaDevices?.getUserMedia?.({
        video: {
          facingMode: "user"
        },
        audio: false
      });
      const [track] = stream.getVideoTracks();
      if (!track) {
        throw new Error("No video track available.");
      }

      webcamStreamRef.current = stream;
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
        await webcamVideoRef.current.play().catch(() => null);
      }

      track.onended = () => {
        void markWebcamBlocked("stream_ended", "Webcam feed stopped during the exam. Reconnect the camera to continue.", {
          label: track.label || "unknown_camera"
        });
      };

      webcamHealthRef.current = window.setInterval(() => {
        const activeTrack = webcamStreamRef.current?.getVideoTracks()?.[0];
        if (!activeTrack || activeTrack.readyState !== "live") {
          void markWebcamBlocked("stream_inactive", "Webcam feed became unavailable during the exam. Retry camera access to continue.");
        }
      }, 5000);
      webcamEvidenceEnabledRef.current = true;
      if (webcamEvidenceIntervalRef.current) {
        window.clearInterval(webcamEvidenceIntervalRef.current);
      }
      webcamEvidenceIntervalRef.current = window.setInterval(() => {
        void uploadWebcamEvidence("interval");
      }, EVIDENCE_CAPTURE_INTERVAL_MS);
      window.setTimeout(() => {
        void uploadWebcamEvidence("initial");
      }, EVIDENCE_CAPTURE_INTERVAL_MS);

      webcamBlockReasonRef.current = "";
      setWebcamStatus("active");
      setWebcamError("");
      return true;
    } catch (error) {
      if (!navigator.mediaDevices?.getUserMedia && !getInheritedLaunchMedia(examId)?.webcamStream) {
        await markWebcamBlocked("unsupported_browser", "This browser does not support webcam access. Switch to a supported browser to continue.");
        return false;
      }
      await markWebcamBlocked(error?.name || "webcam_unavailable", getWebcamErrorMessage(error));
      return false;
    }
  }

  function stopScreenShareStream() {
    if (screenShareHealthRef.current) {
      window.clearInterval(screenShareHealthRef.current);
      screenShareHealthRef.current = null;
    }
    if (screenEvidenceIntervalRef.current) {
      window.clearInterval(screenEvidenceIntervalRef.current);
      screenEvidenceIntervalRef.current = null;
    }

    const stream = screenShareStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenShareStreamRef.current = null;
    }

    if (screenShareVideoRef.current) {
      screenShareVideoRef.current.srcObject = null;
    }
  }

  async function uploadScreenShareEvidence(reason = "interval") {
    const activeExamPaper = examPaperRef.current;
    const token = sessionTokenRef.current;
    const video = screenShareVideoRef.current;
    if (!activeExamPaper || !token || !screenEvidenceEnabledRef.current || screenEvidenceUploadingRef.current) {
      return;
    }
    if (!video || screenShareStatus !== "active" || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const targetWidth = Math.min(video.videoWidth, 1280);
    const scale = targetWidth / video.videoWidth;
    const targetHeight = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    screenEvidenceUploadingRef.current = true;

    try {
      const blob = await new Promise((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/jpeg", 0.72);
      });

      if (!blob) {
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const formData = new FormData();
      formData.append("file", blob, `screen-share-${reason}-${timestamp}.jpg`);
      formData.append("examId", activeExamPaper.exam.id);
      formData.append("studentId", session.id);
      formData.append("documentType", "screen_share_evidence");
      formData.append("actorRole", "student");

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? await response.json()
          : await response.text();
        const message = payload?.message || payload || "Evidence upload failed.";

        if (response.status === 400 && /not configured/i.test(String(message))) {
          screenEvidenceEnabledRef.current = false;
          return;
        }

        throw new Error(String(message));
      }
    } catch (error) {
      console.warn("Failed to upload screen-share evidence", error);
    } finally {
      screenEvidenceUploadingRef.current = false;
    }
  }

  async function markScreenShareBlocked(reason, message, details = {}) {
    stopScreenShareStream();
    setScreenShareStatus("blocked");
    setScreenShareError(message);
    showLocalWarning(message);

    if (screenShareBlockReasonRef.current === reason) {
      return;
    }
    screenShareBlockReasonRef.current = reason;

    await logIntegrityEvent("screen_share_block", {
      reason,
      message,
      ...details
    }, 5);
  }

  async function startScreenShareMonitoring() {
    setScreenShareStatus("checking");
    setScreenShareError("");

    try {
      stopScreenShareStream();
      const inherited = getInheritedLaunchMedia(examId);
      const stream = inherited?.screenShareStream || await navigator.mediaDevices?.getDisplayMedia?.({
        video: {
          frameRate: { ideal: 10, max: 15 }
        },
        audio: false
      });
      const [track] = stream.getVideoTracks();
      if (!track) {
        throw new Error("No screen share track available.");
      }

      screenShareStreamRef.current = stream;
      if (screenShareVideoRef.current) {
        screenShareVideoRef.current.srcObject = stream;
        await screenShareVideoRef.current.play().catch(() => null);
      }

      track.onended = () => {
        void markScreenShareBlocked("share_stopped", "Screen sharing stopped during the exam. Start sharing again to continue.", {
          label: track.label || "shared_screen"
        });
      };

      screenShareHealthRef.current = window.setInterval(() => {
        const activeTrack = screenShareStreamRef.current?.getVideoTracks()?.[0];
        if (!activeTrack || activeTrack.readyState !== "live") {
          void markScreenShareBlocked("share_inactive", "Screen sharing became unavailable during the exam. Restart sharing to continue.");
        }
      }, 5000);
      screenEvidenceEnabledRef.current = true;
      if (screenEvidenceIntervalRef.current) {
        window.clearInterval(screenEvidenceIntervalRef.current);
      }
      screenEvidenceIntervalRef.current = window.setInterval(() => {
        void uploadScreenShareEvidence("interval");
      }, EVIDENCE_CAPTURE_INTERVAL_MS);
      window.setTimeout(() => {
        void uploadScreenShareEvidence("initial");
      }, EVIDENCE_CAPTURE_INTERVAL_MS);

      screenShareBlockReasonRef.current = "";
      setScreenShareStatus("active");
      setScreenShareError("");
      return true;
    } catch (error) {
      if (!navigator.mediaDevices?.getDisplayMedia && !getInheritedLaunchMedia(examId)?.screenShareStream) {
        await markScreenShareBlocked("unsupported_browser", "This browser does not support screen sharing. Switch to a supported browser to continue.");
        return false;
      }
      const isPermissionIssue = ["NotAllowedError", "PermissionDeniedError"].includes(error?.name || "");
      await markScreenShareBlocked(
        error?.name || "screen_share_unavailable",
        isPermissionIssue
          ? "Screen sharing was cancelled or denied. Start sharing your screen to continue the exam."
          : "Screen sharing is required to continue this exam."
      );
      return false;
    }
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

      void startWebcamMonitoring();
      void startScreenShareMonitoring();

      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("copy", handleCopyAttempt);
      window.addEventListener("paste", handlePasteAttempt);
      window.addEventListener("beforeunload", handleBeforeUnload);
      window.addEventListener("pagehide", handlePageHide);

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

  function handleBeforeUnload(event) {
    if (submittedRef.current) return;

    event.preventDefault();
    event.returnValue = "Closing the exam window will permanently close this attempt.";
    void autosaveAnswers(answersRef.current);
  }

  function handlePageHide() {
    if (!submittedRef.current) {
      closeAttemptInBackground(isClosingRef.current ? "manual_close" : "window_closed");
    }
  }

  function showManualAutosaveNotice(message) {
    setManualAutosaveNotice(message);
    setManualAutosaveVersion((current) => current + 1);
    window.setTimeout(() => {
      setManualAutosaveNotice((current) => (current === message ? "" : current));
    }, 2500);
  }

  function closeAttemptInBackground(reason) {
    const activeExamPaper = examPaperRef.current;
    const token = sessionTokenRef.current;
    if (!activeExamPaper || !token || submittedRef.current) return;

    const payload = JSON.stringify({
      examId: activeExamPaper.exam.id,
      attemptNo: activeExamPaper.exam.attempt_no,
      currentAnswers: answersRef.current,
      reason
    });

    try {
      fetch("/api/submissions/close-attempt", {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: payload
      }).catch(() => null);
    } catch {
      // Ignore close-attempt transport errors during unload.
    }
  }

  async function autosaveAnswers(currentAnswers = answers, { manual = false } = {}) {
    const activeExamPaper = examPaperRef.current;
    if (!activeExamPaper || submittedRef.current) return;
    try {
      const response = await api("/api/submissions/autosave", {
        method: "POST",
        body: JSON.stringify({
          examId: activeExamPaper.exam.id,
          studentId: session.id,
          attemptNo: activeExamPaper.exam.attempt_no,
          actorUserId: session.id,
          currentAnswers
        })
      });
      if (manual) {
        showManualAutosaveNotice(`Autosave successful. Version ${response.autosave_version} saved.`);
      }
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
    if (webcamStatus !== "active" || screenShareStatus !== "active") {
      setMessage("Reconnect the webcam and screen share before submitting the exam.");
      return;
    }
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

  async function handleCloseExam() {
    const activeExamPaper = examPaperRef.current;
    if (!activeExamPaper || submittedRef.current) return;

    const confirmed = window.confirm("Do you really want to close this exam window? This will permanently close the attempt and you will not be allowed to restart it.");
    if (!confirmed) return;

    submittedRef.current = true;
    isClosingRef.current = true;
    cleanupRuntime();

    try {
      await api("/api/submissions/close-attempt", {
        method: "POST",
        body: JSON.stringify({
          examId: activeExamPaper.exam.id,
          attemptNo: activeExamPaper.exam.attempt_no,
          currentAnswers: answersRef.current,
          reason: "manual_close"
        })
      });
      localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
      setMessage("Exam window closed. This attempt has been permanently marked as closed.");
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "student-exam-closed", examId: activeExamPaper.exam.id }, window.location.origin);
      }
      window.setTimeout(() => onExit?.(), 500);
    } catch (error) {
      submittedRef.current = false;
      isClosingRef.current = false;
      setMessage(error.message);
    }
  }

  const examMeta = examPaper?.exam;
  const summaryText = useMemo(() => `${integrityInfo.tabSwitches} tab switches | ${integrityInfo.copyAttempts} copy attempts | ${integrityInfo.pasteAttempts} paste attempts`, [integrityInfo]);
  const webcamBlocked = webcamStatus !== "active";
  const screenShareBlocked = screenShareStatus !== "active";
  const examInteractionBlocked = webcamBlocked || screenShareBlocked;

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
          <button type="button" className="ghost-button" onClick={() => void handleCloseExam()}>Close Exam</button>
        </div>
      </div>

      {localWarning ? <>
        <div key={`banner-${warningVersion}`} className="local-warning-banner"><strong>Live Warning</strong><span>{localWarning}</span></div>
        <div key={`toast-${warningVersion}`} className="local-warning-toast" role="alert" aria-live="assertive">
          <strong>Warning recorded</strong>
          <span>{localWarning}</span>
        </div>
      </> : null}

      {manualAutosaveNotice ? (
        <div key={`autosave-${manualAutosaveVersion}`} className="local-success-toast" role="status" aria-live="polite">
          <strong>Autosave complete</strong>
          <span>{manualAutosaveNotice}</span>
        </div>
      ) : null}

      <div className="exam-window-grid">
        <div className="task-card exam-guidance-card">
          <h3>Exam Rules</h3>
          <p className="info-line">Do not switch tabs, copy, or paste. Integrity events are recorded in real time and reviewed later by the proctor.</p>
          <p className="info-line">Current IP: {integrityInfo.ipAddress || "Checking..."}</p>
          <p className="info-line">Submission hash verified: {integrityInfo.submissionHashVerified ? "Yes" : "Pending final verification"}</p>
          <div className={`webcam-panel webcam-panel-${webcamStatus}`}>
            <div className="webcam-panel-header">
              <strong>Webcam Status</strong>
              <span>{webcamStatus === "active" ? "Active" : webcamStatus === "checking" ? "Checking..." : "Blocked"}</span>
            </div>
            <div className="webcam-preview-frame">
              <video ref={webcamVideoRef} className="webcam-preview" autoPlay muted playsInline />
              {webcamStatus !== "active" ? <div className="webcam-preview-overlay">{webcamStatus === "checking" ? "Connecting camera..." : "Camera access required"}</div> : null}
            </div>
            <p className="info-line">{webcamError || "Keep your camera active throughout the exam. If the feed stops, exam actions are blocked until it is restored."}</p>
            <button type="button" className="secondary-button" onClick={() => void startWebcamMonitoring()}>
              {webcamStatus === "active" ? "Refresh Webcam" : "Retry Webcam"}
            </button>
          </div>
          <div className={`webcam-panel webcam-panel-${screenShareStatus}`}>
            <div className="webcam-panel-header">
              <strong>Screen Share</strong>
              <span>{screenShareStatus === "active" ? "Active" : screenShareStatus === "checking" ? "Checking..." : "Blocked"}</span>
            </div>
            <div className="webcam-preview-frame">
              <video ref={screenShareVideoRef} className="screen-share-preview" autoPlay muted playsInline />
              {screenShareStatus !== "active" ? <div className="webcam-preview-overlay">{screenShareStatus === "checking" ? "Waiting for screen share..." : "Screen sharing required"}</div> : null}
            </div>
            <p className="info-line">{screenShareError || "Share your screen throughout the exam. If sharing stops, answering and submission are paused until it is restored."}</p>
            <button type="button" className="secondary-button" onClick={() => void startScreenShareMonitoring()}>
              {screenShareStatus === "active" ? "Refresh Screen Share" : "Start Screen Share"}
            </button>
          </div>
          <button type="button" className="secondary-button" onClick={() => autosaveAnswers(undefined, { manual: true })}>Save Progress</button>
        </div>

        <form className="task-card single-column" onSubmit={(event) => { event.preventDefault(); void submitExam(false); }}>
          {examInteractionBlocked ? (
            <div className="webcam-blocker" role="alert" aria-live="assertive">
              <strong>Exam interactions are paused</strong>
              <span>{webcamError || screenShareError || "Webcam and screen sharing are required to continue answering and submit the exam."}</span>
            </div>
          ) : null}
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
                        disabled={examInteractionBlocked}
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
            <button className="primary-button" type="submit" disabled={examInteractionBlocked}>Submit Exam</button>
            <button type="button" className="ghost-button" onClick={() => autosaveAnswers(undefined, { manual: true })}>Autosave Now</button>
          </div>
        </form>
      </div>
    </section>
  );
}
