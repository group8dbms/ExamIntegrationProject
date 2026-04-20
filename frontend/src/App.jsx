import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { api, clearStoredSession, getStoredSession, setStoredSession } from "./lib/api";
import AdminPage from "./pages/AdminPage";
import StudentPage from "./pages/StudentPage";
import StudentExamWindow from "./pages/StudentExamWindow";
import ProctorPage from "./pages/ProctorPage";
import EvaluatorPage from "./pages/EvaluatorPage";
import AuditorPage from "./pages/AuditorPage";

function Field({ label, error, children, hint = null }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <em className="field-hint">{hint}</em> : null}
      {error ? <small>{error}</small> : null}
    </label>
  );
}

const roleTitles = {
  admin: "Admin Control Room",
  student: "Student Exam Desk",
  proctor: "Proctor Monitoring Desk",
  evaluator: "Evaluator Workspace",
  auditor: "Auditor Review Desk"
};

export default function App() {
  const [message, setMessage] = useState("Choose staff or student access to continue.");
  const [status, setStatus] = useState({ api: "checking", database: "checking", detail: "Verifying backend and Neon connectivity..." });
  const [currentRole, setCurrentRole] = useState(null);
  const [session, setSession] = useState(null);
  const [errors, setErrors] = useState({});
  const [staffLogin, setStaffLogin] = useState({ email: "", password: "", role: "admin" });
  const [studentAccess, setStudentAccess] = useState({ fullName: "", email: "", password: "" });
  const [studentMode, setStudentMode] = useState("login");
  const [studentPanelMessage, setStudentPanelMessage] = useState("Enter your email and password. New students will be guided into registration automatically.");

  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const examMode = urlParams.get("mode") === "exam";
  const examId = urlParams.get("examId");

  useEffect(() => {
    api("/health")
      .then((data) => setStatus({ api: "online", database: data.database || "unknown", detail: data.message || `Database ${data.database}` }))
      .catch((error) => setStatus({ api: "offline", database: "unreachable", detail: error.message }));
  }, []);

  useEffect(() => {
    const storedSession = getStoredSession();
    if (storedSession?.user) {
      setSession(storedSession.user);
      setCurrentRole(storedSession.user.role);
    }
  }, []);

  useEffect(() => {
    if (examMode) {
      const storedSession = getStoredSession();
      if (storedSession?.user) {
        setSession(storedSession.user);
        setCurrentRole(storedSession.user.role);
        setMessage(`Exam window opened for ${storedSession.user.fullName}.`);
      } else {
        setMessage("Student session could not be restored for the exam window.");
      }
    }
  }, [examMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get("verified");
    const role = params.get("role");
    const email = params.get("email");

    if (role === "student" && verified === "success") {
      setMessage(`Email verified successfully for ${email || "student"}. You can now log in.`);
      setStudentPanelMessage("Email verified. Continue with your email and password to enter the student dashboard.");
      setStudentMode("login");
      if (email) setStudentAccess((current) => ({ ...current, email }));
      window.history.replaceState({}, "", "/");
    }

    if (role === "student" && verified === "invalid") {
      setMessage("The verification link is invalid or expired. Try student access again to resend the email.");
      setStudentPanelMessage("Verification link invalid or expired. Enter email and password again to resend verification.");
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    function handleStudentExamSubmitted(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "student-exam-submitted") {
        setMessage("Exam submission received. Student dashboard refreshed.");
      }
      if (event.data?.type === "student-exam-closed") {
        setMessage("Exam window closed. The attempt has been locked and cannot be restarted.");
      }
    }

    window.addEventListener("message", handleStudentExamSubmitted);
    return () => window.removeEventListener("message", handleStudentExamSubmitted);
  }, []);

  const tone = useMemo(() => {
    if (status.api === "online" && status.database === "connected") return "success";
    if (status.api === "offline") return "danger";
    return "warning";
  }, [status]);

  async function loginStaff(event) {
    event.preventDefault();
    const next = {};
    if (!staffLogin.email.trim()) next.staffEmail = "Staff email is required.";
    if (!staffLogin.password.trim()) next.staffPassword = "Password is required.";
    if (!staffLogin.role.trim()) next.staffRole = "Choose a role.";
    setErrors((current) => ({ ...current, ...next }));
    if (Object.keys(next).length) return;

    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(staffLogin) });
      setStoredSession({ user: data.user, token: data.token });
      setSession(data.user);
      setCurrentRole(data.user.role);
      setMessage(`Welcome back, ${data.user.fullName}.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleStudentAccess(event) {
    event.preventDefault();
    const next = {};
    if (!studentAccess.email.trim()) next.studentEmail = "Student email is required.";
    if (!studentAccess.password.trim()) next.studentPassword = "Password is required.";
    if (studentMode === "register" && !studentAccess.fullName.trim()) next.studentFullName = "Full name is required for first-time registration.";
    setErrors((current) => ({ ...current, ...next }));
    if (Object.keys(next).length) return;

    try {
      const data = await api("/api/auth/student-access", { method: "POST", body: JSON.stringify(studentAccess) });
      if (data.mode === "login") {
        setStoredSession({ user: data.user, token: data.token });
        setSession(data.user);
        setCurrentRole("student");
        setMessage(`Welcome, ${data.user.fullName}.`);
        return;
      }
      setStudentPanelMessage(data.message);
      setMessage(data.message);
    } catch (error) {
      if (error.data?.mode === "register") {
        setStudentMode("register");
        setStudentPanelMessage("This email is new. Add full name once and continue again to create the account and send verification mail.");
        setMessage(error.message);
        setErrors((current) => ({ ...current, studentFullName: "Full name is required for new student registration." }));
        return;
      }
      setStudentPanelMessage(error.message);
      setMessage(error.message);
    }
  }

  function handleLogout() {
    setSession(null);
    setCurrentRole(null);
    clearStoredSession();
    setMessage("You have been logged out.");
  }

  if (examMode) {
    return (
      <div className="admin-app-shell">
        {session && examId ? (
          <StudentExamWindow session={session} examId={examId} onExit={() => window.close()} setMessage={setMessage} />
        ) : (
          <section className="workspace-shell exam-window-shell">
            <div className="task-card">
              <h2>Student session unavailable</h2>
              <p className="info-line">Log in again from the main window before starting the exam.</p>
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="admin-app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Exam Integrity System</p>
          <h1>{currentRole ? roleTitles[currentRole] : "Access Portal"}</h1>
          <p className="lede">
            {currentRole ? "You are inside a dedicated role workspace." : "Staff login and student access are kept together here, then each role moves to its own separate workspace."}
          </p>
        </div>
        <div className={`status-card compact ${tone}`}>
          <span className="status-label">System Status</span>
          <strong>API {status.api} / DB {status.database}</strong>
          <p>{status.detail}</p>
        </div>
      </header>

      <main className="admin-main">
        {!currentRole && (
          <section className="portal-shell">
            <div className="portal-card">
              <div className="portal-card-header">
                <p className="eyebrow">Staff Access</p>
                <h2>Admin / Proctor / Evaluator / Auditor</h2>
              </div>
              <form className="single-column" onSubmit={loginStaff}>
                <Field label="Role" error={errors.staffRole}>
                  <select value={staffLogin.role} onChange={(event) => setStaffLogin({ ...staffLogin, role: event.target.value })}>
                    <option value="admin">Admin</option>
                    <option value="proctor">Proctor</option>
                    <option value="evaluator">Evaluator</option>
                    <option value="auditor">Auditor</option>
                  </select>
                </Field>
                <Field label="Staff Email" error={errors.staffEmail}>
                  <input type="email" value={staffLogin.email} onChange={(event) => setStaffLogin({ ...staffLogin, email: event.target.value })} placeholder="staff@college.edu" />
                </Field>
                <Field label="Password" error={errors.staffPassword}>
                  <input type="password" value={staffLogin.password} onChange={(event) => setStaffLogin({ ...staffLogin, password: event.target.value })} placeholder="StrongPass9" />
                </Field>
                <div className="form-actions">
                  <button className="primary-button" type="submit">Enter Staff Workspace</button>
                </div>
              </form>
            </div>

            <div className="portal-card student-card">
              <div className="portal-card-header">
                <p className="eyebrow">Student Access</p>
                <h2>{studentMode === "register" ? "Complete Registration" : "Register or Login"}</h2>
              </div>
              <form className="portal-stack" onSubmit={handleStudentAccess}>
                <Field label="Student Email" error={errors.studentEmail}>
                  <input type="email" value={studentAccess.email} onChange={(event) => setStudentAccess({ ...studentAccess, email: event.target.value })} placeholder="student@college.edu" />
                </Field>
                <Field label="Password" error={errors.studentPassword}>
                  <input type="password" value={studentAccess.password} onChange={(event) => setStudentAccess({ ...studentAccess, password: event.target.value })} placeholder="StudentPass9" />
                </Field>
                {studentMode === "register" && (
                  <Field label="Full Name" error={errors.studentFullName} hint="Required only for first-time registration.">
                    <input value={studentAccess.fullName} onChange={(event) => setStudentAccess({ ...studentAccess, fullName: event.target.value })} placeholder="Ananya Rao" />
                  </Field>
                )}
                <div className="form-actions">
                  <button className="primary-button" type="submit">Continue as Student</button>
                </div>
                <div className="student-inline-message">
                  <span className="status-label">Student Flow</span>
                  <p>{studentPanelMessage}</p>
                </div>
              </form>
            </div>
          </section>
        )}

        {currentRole === "admin" && session && <AdminPage session={session} onLogout={handleLogout} setMessage={setMessage} />}
        {currentRole === "student" && session && <StudentPage session={session} onLogout={handleLogout} setMessage={setMessage} />}
        {currentRole === "proctor" && session && <ProctorPage session={session} onLogout={handleLogout} setMessage={setMessage} />}
        {currentRole === "evaluator" && session && <EvaluatorPage session={session} onLogout={handleLogout} setMessage={setMessage} />}
        {currentRole === "auditor" && session && <AuditorPage session={session} onLogout={handleLogout} setMessage={setMessage} />}
      </main>

      <footer className="message-bar">
        <span className="status-label">Live Feedback</span>
        <p>{message}</p>
      </footer>
    </div>
  );
}
