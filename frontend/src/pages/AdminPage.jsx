import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

function Field({ label, error, children, wide = false, hint = null }) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
      {hint ? <em className="field-hint">{hint}</em> : null}
      {error ? <small>{error}</small> : null}
    </label>
  );
}

const starterQuestions = [
  {
    questionType: "mcq",
    prompt: "Which command is used to retrieve records from a table?",
    options: ["SELECT", "UPDATE", "GRANT", "MERGE"],
    correctAnswer: "SELECT",
    marks: 2
  },
  {
    questionType: "msq",
    prompt: "Select valid DBMS integrity concepts.",
    options: ["Entity integrity", "Referential integrity", "Cache invalidation", "Domain integrity"],
    correctAnswer: ["Entity integrity", "Referential integrity", "Domain integrity"],
    marks: 3
  }
];

function createBlankQuestion() {
  return {
    questionType: "mcq",
    prompt: "",
    options: ["", ""],
    correctAnswer: "",
    marks: "1"
  };
}

function normalizeQuestion(question) {
  return {
    questionType: question.questionType,
    prompt: question.prompt.trim(),
    options: question.options.map((option) => option.trim()).filter(Boolean),
    correctAnswer: question.questionType === "msq" ? [...question.correctAnswer] : question.correctAnswer,
    marks: Number(question.marks)
  };
}

function toDateTimeLocalInputValue(date = new Date()) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function formatPublishState(state) {
  switch (state) {
    case "ready_to_publish":
      return "Ready to publish";
    case "published":
      return "Published";
    case "waiting_for_evaluation":
      return "Waiting for evaluation";
    case "waiting_for_submissions":
      return "Waiting for submissions";
    case "waiting_for_proctor_decision":
      return "Waiting for proctor decision";
    default:
      return state || "Unknown";
  }
}

export default function AdminPage({ session, onLogout, setMessage }) {
  const [activeView, setActiveView] = useState("faculty");
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [faculty, setFaculty] = useState({ fullName: "", email: "", password: "", role: "proctor" });
  const [quiz, setQuiz] = useState({
    title: "",
    courseCode: "",
    startAt: "",
    endAt: "",
    durationMinutes: "90",
    integrityThreshold: "10",
    studentIds: []
  });
  const [questions, setQuestions] = useState(starterQuestions);
  const [draftQuestion, setDraftQuestion] = useState(createBlankQuestion());
  const [publishExamId, setPublishExamId] = useState("");
  const [activeExamId, setActiveExamId] = useState("");
  const [assignedActiveStudents, setAssignedActiveStudents] = useState([]);
  const [errors, setErrors] = useState({});
  const [draftError, setDraftError] = useState("");

  useEffect(() => {
    void loadExams();
    void loadStudents();
  }, [session?.id]);

  useEffect(() => {
    if (!activeExamId) {
      setAssignedActiveStudents([]);
      return;
    }

    void loadAssignedActiveStudents(activeExamId);
  }, [activeExamId]);

  const minimumStartTime = useMemo(() => toDateTimeLocalInputValue(new Date()), []);

  async function loadExams() {
    try {
      const data = await api("/api/exams");
      setExams(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadStudents() {
    try {
      const data = await api("/api/auth/users?role=student");
      setStudents(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadAssignedActiveStudents(examId) {
    try {
      const data = await api(`/api/exams/${examId}/candidates`);
      setAssignedActiveStudents(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function validateFaculty() {
    const next = {};
    if (!faculty.fullName.trim()) next.facultyName = "Faculty name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(faculty.email.trim())) next.facultyEmail = "Enter a valid faculty email.";
    if (faculty.password.length < 8) next.facultyPassword = "Temporary password must be at least 8 characters.";
    setErrors(next);
    return next;
  }

  function validateQuiz() {
    const next = {};
    const now = new Date();
    const start = quiz.startAt ? new Date(quiz.startAt) : null;
    const end = quiz.endAt ? new Date(quiz.endAt) : null;

    if (!quiz.title.trim()) next.title = "Exam title is required.";
    if (!/^[A-Z0-9-]{4,12}$/.test(quiz.courseCode.trim())) next.courseCode = "Course code should look like DBMS101.";
    if (!quiz.startAt) {
      next.startAt = "Start time is required.";
    } else if (!(start > now)) {
      next.startAt = "Start time must be in the future.";
    }

    if (!quiz.endAt) {
      next.endAt = "End time is required.";
    } else if (start && !(end > start)) {
      next.endAt = "End time must be after start time.";
    }

    const duration = Number(quiz.durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 600) next.durationMinutes = "Duration must be 5-600 minutes.";

    if (start && end) {
      const minutesBetween = Math.floor((end.getTime() - start.getTime()) / 60000);
      if (minutesBetween < duration) {
        next.endAt = "End time must allow the full exam duration.";
      }
    }

    const threshold = Number(quiz.integrityThreshold);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) next.integrityThreshold = "Integrity threshold must be between 1 and 100.";
    if (!quiz.studentIds.length) next.studentIds = "Assign at least one student to this exam.";
    if (!questions.length) next.questions = "Add at least one question before creating the quiz.";
    setErrors(next);
    return next;
  }

  function validateDraftQuestion() {
    const trimmedPrompt = draftQuestion.prompt.trim();
    const trimmedOptions = draftQuestion.options.map((option) => option.trim()).filter(Boolean);
    const marks = Number(draftQuestion.marks);

    if (!trimmedPrompt) return "Type the question prompt before adding it.";
    if (trimmedOptions.length < 2) return "Add at least two non-empty options.";
    if (new Set(trimmedOptions.map((option) => option.toLowerCase())).size !== trimmedOptions.length) {
      return "Options must be unique for each question.";
    }
    if (!Number.isInteger(marks) || marks < 1 || marks > 20) return "Marks must be between 1 and 20.";

    if (draftQuestion.questionType === "mcq") {
      if (!trimmedOptions.includes(draftQuestion.correctAnswer)) return "Choose one correct answer for the MCQ.";
    } else {
      const selectedAnswers = draftQuestion.correctAnswer.filter((answer) => trimmedOptions.includes(answer));
      if (!selectedAnswers.length) return "Choose at least one correct answer for the MSQ.";
    }

    return "";
  }

  function resetDraftQuestion() {
    setDraftQuestion(createBlankQuestion());
    setDraftError("");
  }

  function updateDraftOption(index, value) {
    setDraftQuestion((current) => {
      const nextOptions = current.options.map((option, optionIndex) => (optionIndex === index ? value : option));
      let nextCorrect = current.correctAnswer;

      if (current.questionType === "mcq" && current.correctAnswer === current.options[index]) {
        nextCorrect = value;
      }

      if (current.questionType === "msq") {
        nextCorrect = current.correctAnswer.map((answer) => (answer === current.options[index] ? value : answer));
      }

      return {
        ...current,
        options: nextOptions,
        correctAnswer: nextCorrect
      };
    });
  }

  function addOption() {
    setDraftQuestion((current) => ({
      ...current,
      options: [...current.options, ""]
    }));
  }

  function removeOption(index) {
    setDraftQuestion((current) => {
      if (current.options.length <= 2) {
        return current;
      }

      const removedValue = current.options[index];
      const nextOptions = current.options.filter((_, optionIndex) => optionIndex !== index);
      let nextCorrect = current.correctAnswer;

      if (current.questionType === "mcq" && current.correctAnswer === removedValue) {
        nextCorrect = "";
      }

      if (current.questionType === "msq") {
        nextCorrect = current.correctAnswer.filter((answer) => answer !== removedValue);
      }

      return {
        ...current,
        options: nextOptions,
        correctAnswer: nextCorrect
      };
    });
  }

  function setDraftType(questionType) {
    setDraftQuestion((current) => ({
      ...current,
      questionType,
      correctAnswer: questionType === "msq" ? [] : ""
    }));
    setDraftError("");
  }

  function toggleMsqCorrect(option) {
    setDraftQuestion((current) => {
      const selected = new Set(current.correctAnswer);
      if (selected.has(option)) {
        selected.delete(option);
      } else {
        selected.add(option);
      }

      return {
        ...current,
        correctAnswer: Array.from(selected)
      };
    });
  }

  function addQuestionToList() {
    const message = validateDraftQuestion();
    if (message) {
      setDraftError(message);
      return;
    }

    const normalized = normalizeQuestion({
      ...draftQuestion,
      correctAnswer:
        draftQuestion.questionType === "msq"
          ? draftQuestion.correctAnswer.filter((answer) => draftQuestion.options.map((option) => option.trim()).includes(answer))
          : draftQuestion.correctAnswer
    });

    setQuestions((current) => [...current, normalized]);
    setErrors((current) => {
      const next = { ...current };
      delete next.questions;
      return next;
    });
    resetDraftQuestion();
  }

  function removeQuestion(index) {
    setQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index));
  }

  function toggleStudent(studentId) {
    setQuiz((current) => {
      const nextIds = current.studentIds.includes(studentId)
        ? current.studentIds.filter((id) => id !== studentId)
        : [...current.studentIds, studentId];

      return {
        ...current,
        studentIds: nextIds
      };
    });
    setErrors((current) => {
      const next = { ...current };
      delete next.studentIds;
      return next;
    });
  }

  function addManyStudents(studentIds) {
    if (!studentIds.length) return;
    setQuiz((current) => ({
      ...current,
      studentIds: Array.from(new Set([...current.studentIds, ...studentIds]))
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next.studentIds;
      return next;
    });
  }

  function removeManyStudents(studentIds) {
    if (!studentIds.length) return;
    setQuiz((current) => ({
      ...current,
      studentIds: current.studentIds.filter((id) => !studentIds.includes(id))
    }));
  }

  const verifiedStudents = useMemo(
    () => students.filter((student) => student.emailVerified && student.isActive),
    [students]
  );

  const selectedStudents = useMemo(
    () => verifiedStudents.filter((student) => quiz.studentIds.includes(student.id)),
    [verifiedStudents, quiz.studentIds]
  );

  const assignedActiveStudentIds = useMemo(() => new Set(assignedActiveStudents.map((student) => student.id)), [assignedActiveStudents]);

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    const source = activeView === "active"
      ? verifiedStudents.filter((student) => !assignedActiveStudentIds.has(student.id))
      : verifiedStudents;

    if (!query) return source;
    return source.filter(
      (student) =>
        student.fullName.toLowerCase().includes(query) ||
        student.email.toLowerCase().includes(query)
    );
  }, [activeView, assignedActiveStudentIds, studentSearch, verifiedStudents]);

  const filteredStudentIds = useMemo(() => filteredStudents.map((student) => student.id), [filteredStudents]);

  const publishBuckets = useMemo(() => ({
    ready: exams.filter((item) => item.publish_state === "ready_to_publish"),
    waiting: exams.filter((item) => item.publish_state === "waiting_for_evaluation" || item.publish_state === "waiting_for_submissions" || item.publish_state === "waiting_for_proctor_decision"),
    published: exams.filter((item) => item.publish_state === "published")
  }), [exams]);

  const activeExam = useMemo(() => exams.find((item) => item.id === activeExamId) || null, [activeExamId, exams]);

  async function handleFacultyAssign(event) {
    event.preventDefault();
    if (Object.keys(validateFaculty()).length) {
      setMessage("Please fix the faculty assignment fields.");
      return;
    }

    try {
      const data = await api("/api/auth/bootstrap-user", {
        method: "POST",
        body: JSON.stringify(faculty)
      });
      setMessage(`${data.user.role} access prepared for ${data.user.email}.`);
      setFaculty({ fullName: "", email: "", password: "", role: "proctor" });
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleQuizCreate(event) {
    event.preventDefault();
    if (Object.keys(validateQuiz()).length) {
      setMessage("Please fix the quiz setup fields.");
      return;
    }

    try {
      const payload = {
        title: quiz.title.trim(),
        description: "Created from admin quiz setup.",
        courseCode: quiz.courseCode.trim(),
        startAt: new Date(quiz.startAt).toISOString(),
        endAt: new Date(quiz.endAt).toISOString(),
        durationMinutes: Number(quiz.durationMinutes),
        integrityThreshold: Number(quiz.integrityThreshold),
        createdBy: session.id,
        actorRole: "admin",
        studentIds: quiz.studentIds,
        questions,
        rules: {
          penalty_per_suspicion_point: 0.2,
          webcamRequired: true
        }
      };

      const data = await api("/api/exams", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setMessage(`Quiz prepared successfully: ${data.title}`);
      await Promise.all([loadExams(), loadStudents()]);
      setQuiz({
        title: "",
        courseCode: "",
        startAt: "",
        endAt: "",
        durationMinutes: "90",
        integrityThreshold: "10",
        studentIds: []
      });
      setStudentSearch("");
      setQuestions(starterQuestions);
      resetDraftQuestion();
      setActiveView("publish");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleActiveQuizAssign() {
    if (!activeExamId) {
      setMessage("Choose an active quiz first.");
      return;
    }

    if (!quiz.studentIds.length) {
      setMessage("Select at least one student to assign.");
      return;
    }

    try {
      const data = await api(`/api/exams/${activeExamId}/candidates`, {
        method: "POST",
        body: JSON.stringify({ studentIds: quiz.studentIds, assignedBy: session.id })
      });
      setMessage(`Assigned ${data.items.length} student(s) to the selected quiz.`);
      setQuiz((current) => ({ ...current, studentIds: [] }));
      await Promise.all([loadExams(), loadAssignedActiveStudents(activeExamId)]);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleActiveQuizRemove(studentIds) {
    if (!activeExamId) {
      setMessage("Choose an active quiz first.");
      return;
    }

    if (!studentIds.length) {
      setMessage("Choose at least one assigned student to remove.");
      return;
    }

    try {
      const data = await api(`/api/exams/${activeExamId}/candidates/remove`, {
        method: "POST",
        body: JSON.stringify({ studentIds, removedBy: session.id })
      });
      setMessage(`Removed ${data.items.length} student(s) from the selected quiz.`);
      await Promise.all([loadExams(), loadAssignedActiveStudents(activeExamId)]);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handlePublish(event) {
    event.preventDefault();
    if (!publishExamId.trim()) {
      setMessage("Choose an exam before publishing results.");
      return;
    }

    try {
      const data = await api(`/api/exams/${publishExamId.trim()}/publish-results`, {
        method: "POST",
        body: JSON.stringify({ publishedBy: session.id })
      });
      const mailNote = data.mailConfigured
        ? ` Result emails sent: ${data.emailedCount}.`
        : " SMTP is not configured, so result emails were skipped.";
      const storageNote = data.storageConfigured
        ? ` Auto-uploaded ${data.storedReportsCount} result report(s) to secure storage.`
        : " Secure storage is not configured, so result reports were not uploaded.";
      const issueNote = data.emailIssues?.length ? ` ${data.emailIssues.length} email(s) failed.` : "";
      setMessage(`Published ${data.items.length} evaluated results.${mailNote}${storageNote}${issueNote}`);
      await loadExams();
    } catch (error) {
      setMessage(error.message);
    }
  }

  const currentExamSummary = useMemo(
    () =>
      exams.map((item) => (
        <button
          key={item.id}
          type="button"
          className="list-item action-card"
          onClick={() => {
            setPublishExamId(item.id);
            setActiveView("publish");
          }}
        >
          <strong>{item.title}</strong>
          <span>{item.course_code}</span>
          <span>
            {item.question_count} questions / {item.candidate_count} students
          </span>
          <span>{item.status}</span>
        </button>
      )),
    [exams]
  );

  return (
    <section className="workspace-shell">
      <div className="workspace-header">
        <div>
          <p className="eyebrow">Admin Workspace</p>
          <h2>{session.fullName}</h2>
          <p className="info-line">{session.email}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onLogout}>
          Logout
        </button>
      </div>

      <div className="view-switcher">
        <button type="button" className={activeView === "faculty" ? "view-pill active" : "view-pill"} onClick={() => setActiveView("faculty")}>1. Assign Faculty Roles</button>
        <button type="button" className={activeView === "quiz" ? "view-pill active" : "view-pill"} onClick={() => setActiveView("quiz")}>2. Prepare Quiz</button>
        <button type="button" className={activeView === "publish" ? "view-pill active" : "view-pill"} onClick={() => setActiveView("publish")}>3. Publish Results</button>
        <button type="button" className={activeView === "active" ? "view-pill active" : "view-pill"} onClick={() => setActiveView("active")}>4. Quizzes Active</button>
      </div>

      {activeView === "faculty" && (
        <div className="task-page">
          <div className="task-intro">
            <p className="eyebrow">Use Case One</p>
            <h3>Assign Proctor and Evaluator Access</h3>
            <p>Prepare role-based access for faculty mail ids. This page is only for granting admin-managed staff access.</p>
          </div>

          <form className="task-card single-column" onSubmit={handleFacultyAssign}>
            <Field label="Faculty Name" error={errors.facultyName}><input required value={faculty.fullName} onChange={(event) => setFaculty({ ...faculty, fullName: event.target.value })} placeholder="Dr. Meera Sharma" /></Field>
            <Field label="Faculty Email" error={errors.facultyEmail}><input required type="email" value={faculty.email} onChange={(event) => setFaculty({ ...faculty, email: event.target.value })} placeholder="faculty@college.edu" /></Field>
            <Field label="Temporary Password" error={errors.facultyPassword} hint="Share this securely with the faculty member."><input required type="password" minLength="8" value={faculty.password} onChange={(event) => setFaculty({ ...faculty, password: event.target.value })} placeholder="TempFaculty9" /></Field>
            <Field label="Assign Role"><select required value={faculty.role} onChange={(event) => setFaculty({ ...faculty, role: event.target.value })}><option value="proctor">Proctor</option><option value="evaluator">Evaluator</option></select></Field>
            <div className="form-actions"><button className="primary-button" type="submit">Save Faculty Access</button></div>
          </form>
        </div>
      )}

      {activeView === "quiz" && (
        <div className="task-page">
          <div className="task-intro">
            <p className="eyebrow">Use Case Two</p>
            <h3>Prepare Quiz</h3>
            <p>Configure exam timing, assign students from the registered list, and build each question through form fields instead of JSON.</p>
          </div>

          <form className="task-card" onSubmit={handleQuizCreate}>
            <Field label="Exam Title" error={errors.title}><input required value={quiz.title} onChange={(event) => setQuiz({ ...quiz, title: event.target.value })} placeholder="Database Systems Midterm" /></Field>
            <Field label="Course Code" error={errors.courseCode}><input required value={quiz.courseCode} onChange={(event) => setQuiz({ ...quiz, courseCode: event.target.value.toUpperCase() })} placeholder="DBMS101" /></Field>
            <Field label="Start Time" error={errors.startAt} hint="Exam cannot begin in the past."><input required type="datetime-local" min={minimumStartTime} value={quiz.startAt} onChange={(event) => setQuiz({ ...quiz, startAt: event.target.value })} /></Field>
            <Field label="End Time" error={errors.endAt} hint="End time must be after start time and cover the full duration."><input required type="datetime-local" min={quiz.startAt || minimumStartTime} value={quiz.endAt} onChange={(event) => setQuiz({ ...quiz, endAt: event.target.value })} /></Field>
            <Field label="Duration (minutes)" error={errors.durationMinutes}><input required type="number" min="5" max="600" value={quiz.durationMinutes} onChange={(event) => setQuiz({ ...quiz, durationMinutes: event.target.value })} /></Field>
            <Field label="Integrity Threshold" error={errors.integrityThreshold} hint="Create an investigation case when suspicion score exceeds this value."><input required type="number" min="1" max="100" value={quiz.integrityThreshold} onChange={(event) => setQuiz({ ...quiz, integrityThreshold: event.target.value })} /></Field>

            <div className="field wide">
              <span>Assign Students</span>
              <div className="student-assignment-panel">
                <div className="student-assignment-header">
                  <div>
                    <strong>Choose registered students</strong>
                    <p className="info-line">Only active, email-verified students can be assigned to an exam.</p>
                  </div>
                  <button type="button" className="secondary-button" onClick={loadStudents}>Refresh Students</button>
                </div>

                <div className="student-selection-grid">
                  <div className="student-selection-main">
                    <input
                      className="student-search-input"
                      value={studentSearch}
                      onChange={(event) => setStudentSearch(event.target.value)}
                      placeholder="Search students by name or email"
                    />

                    <div className="bulk-action-row">
                      <button type="button" className="secondary-button" onClick={() => addManyStudents(filteredStudentIds)} disabled={!filteredStudentIds.length}>Assign All Shown</button>
                      <button type="button" className="ghost-button" onClick={() => removeManyStudents(filteredStudentIds)} disabled={!filteredStudentIds.length}>Remove All Shown</button>
                    </div>

                    <div className="student-directory-list">
                      {filteredStudents.length ? (
                        filteredStudents.map((student) => {
                          const selected = quiz.studentIds.includes(student.id);
                          return (
                            <button
                              key={student.id}
                              type="button"
                              className={selected ? "student-directory-card active" : "student-directory-card"}
                              onClick={() => toggleStudent(student.id)}
                            >
                              <div>
                                <strong>{student.fullName}</strong>
                                <p>{student.email}</p>
                              </div>
                              <div className="student-directory-meta">
                                <span>{student.emailVerified ? "Verified" : "Pending verification"}</span>
                                <span>{student.isActive ? "Active" : "Inactive"}</span>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <p className="info-line">No students matched your search.</p>
                      )}
                    </div>
                  </div>

                  <aside className="selected-students-window">
                    <div className="selected-window-header">
                      <div>
                        <strong>Selected Students</strong>
                        <p className="info-line">{selectedStudents.length} assigned for this quiz</p>
                      </div>
                      <button type="button" className="ghost-button" onClick={() => removeManyStudents(quiz.studentIds)} disabled={!quiz.studentIds.length}>Clear All</button>
                    </div>

                    {selectedStudents.length ? (
                      <div className="selected-student-list">
                        {selectedStudents.map((student) => (
                          <button key={student.id} type="button" className="selected-student-pill" onClick={() => toggleStudent(student.id)}>
                            <span>{student.fullName}</span>
                            <small>{student.email}</small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="info-line">No students selected yet.</p>
                    )}
                  </aside>
                </div>

                {errors.studentIds ? <p className="inline-error">{errors.studentIds}</p> : null}
              </div>
            </div>

            <div className="field wide">
              <span>Question Builder</span>
              <div className="question-builder">
                <div className="question-builder-header">
                  <div>
                    <strong>Build one question at a time</strong>
                    <p className="info-line">Choose question type, enter options, then mark the correct answer before adding it.</p>
                  </div>
                  <button type="button" className="secondary-button" onClick={resetDraftQuestion}>Clear Draft</button>
                </div>

                <div className="question-editor-grid">
                  <Field label="Question Type">
                    <select value={draftQuestion.questionType} onChange={(event) => setDraftType(event.target.value)}>
                      <option value="mcq">MCQ</option>
                      <option value="msq">MSQ</option>
                    </select>
                  </Field>
                  <Field label="Marks"><input type="number" min="1" max="20" value={draftQuestion.marks} onChange={(event) => setDraftQuestion({ ...draftQuestion, marks: event.target.value })} /></Field>
                  <Field label="Question" wide><textarea rows="4" value={draftQuestion.prompt} onChange={(event) => setDraftQuestion({ ...draftQuestion, prompt: event.target.value })} placeholder="Type the question text here" /></Field>
                </div>

                <div className="options-section">
                  <div className="task-card-header">
                    <h4>Options</h4>
                    <button type="button" className="secondary-button" onClick={addOption}>+ Add Option</button>
                  </div>

                  <div className="option-builder-list">
                    {draftQuestion.options.map((option, index) => {
                      const trimmedOption = option.trim();
                      const isChecked = draftQuestion.questionType === "mcq"
                        ? draftQuestion.correctAnswer === trimmedOption && trimmedOption
                        : draftQuestion.correctAnswer.includes(trimmedOption) && trimmedOption;

                      return (
                        <div key={`option-${index}`} className="option-builder-row">
                          <span className="option-index">{String.fromCharCode(65 + index)}</span>
                          <input
                            className="option-text-input"
                            value={option}
                            onChange={(event) => updateDraftOption(index, event.target.value)}
                            placeholder={`Option ${index + 1}`}
                          />
                          <label className="correct-toggle">
                            <input
                              type={draftQuestion.questionType === "mcq" ? "radio" : "checkbox"}
                              name="correct-answer"
                              checked={Boolean(isChecked)}
                              disabled={!trimmedOption}
                              onChange={() => {
                                if (draftQuestion.questionType === "mcq") {
                                  setDraftQuestion({ ...draftQuestion, correctAnswer: trimmedOption });
                                } else {
                                  toggleMsqCorrect(trimmedOption);
                                }
                              }}
                            />
                            <span>{draftQuestion.questionType === "mcq" ? "Correct answer" : "Correct"}</span>
                          </label>
                          <button type="button" className="ghost-button" onClick={() => removeOption(index)} disabled={draftQuestion.options.length <= 2}>Remove</button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {draftError ? <p className="inline-error">{draftError}</p> : null}
                {errors.questions ? <p className="inline-error">{errors.questions}</p> : null}

                <div className="form-actions">
                  <button type="button" className="primary-button" onClick={addQuestionToList}>Add Question</button>
                </div>
              </div>
            </div>

            <div className="field wide">
              <span>Question Bank Preview</span>
              <div className="question-bank-preview">
                <div className="question-preview-header">
                  <strong>{questions.length} question(s) ready for this quiz</strong>
                  <span className="info-line">MCQ uses one correct answer. MSQ can have multiple correct answers.</span>
                </div>

                <div className="question-preview-list">
                  {questions.map((question, index) => {
                    const correctAnswers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];

                    return (
                      <article key={`${question.prompt}-${index}`} className="question-preview-card">
                        <div className="task-card-header">
                          <div>
                            <strong>Q{index + 1}. {question.prompt}</strong>
                            <p className="info-line">{question.questionType.toUpperCase()} | {question.marks} mark(s)</p>
                          </div>
                          <button type="button" className="ghost-button" onClick={() => removeQuestion(index)}>Delete</button>
                        </div>
                        <div className="preview-options">
                          {question.options.map((option) => (
                            <span key={`${question.prompt}-${option}`} className={correctAnswers.includes(option) ? "preview-option correct" : "preview-option"}>
                              {option}
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="form-actions"><button className="primary-button" type="submit">Create Quiz</button></div>
          </form>
        </div>
      )}

      {activeView === "active" && (
        <div className="task-page">
          <div className="task-intro">
            <p className="eyebrow">Use Case Four</p>
            <h3>Quizzes Active</h3>
            <p>Previously created quizzes stay available here so you can reopen them later and assign more students.</p>
          </div>

          <div className="publish-grid">
            <div className="task-card">
              <div className="task-card-header">
                <h3>Created Quizzes</h3>
                <button type="button" className="secondary-button" onClick={loadExams}>Refresh</button>
              </div>
              <div className="list-box">
                {exams.length ? exams.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={activeExamId === item.id ? "publish-card ready" : "publish-card muted"}
                    onClick={() => {
                      setActiveExamId(item.id);
                      setPublishExamId(item.id);
                    }}
                  >
                    <div className="publish-card-top">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.course_code}</p>
                      </div>
                      <span className={item.publish_state === "published" ? "status-badge published" : item.publish_state === "ready_to_publish" ? "status-badge ready" : item.publish_state === "waiting_for_evaluation" || item.publish_state === "waiting_for_proctor_decision" ? "status-badge waiting" : "status-badge muted"}>
                        {formatPublishState(item.publish_state)}
                      </span>
                    </div>
                    <p className="info-line">Assigned: {item.candidate_count} | Submitted: {item.submitted_count} | Evaluated: {item.evaluated_count}</p>
                  </button>
                )) : <p>No quizzes created yet.</p>}
              </div>
            </div>

            <div className="task-card">
              <div className="task-card-header">
                <h3>Assign More Students</h3>
                <span className="info-line">Select a quiz, then assign students</span>
              </div>

              {activeExam ? (
                <div className="active-quiz-panel">
                  <div className="active-quiz-summary">
                    <strong>{activeExam.title}</strong>
                    <p className="info-line">{activeExam.course_code} | {activeExam.question_count} questions | {activeExam.candidate_count} assigned</p>
                    <p className="info-line">Already assigned students are hidden from the selection list below.</p>
                  </div>

                  <div className="student-selection-main">
                    <input
                      className="student-search-input"
                      value={studentSearch}
                      onChange={(event) => setStudentSearch(event.target.value)}
                      placeholder="Search students by name or email"
                    />

                    <div className="bulk-action-row">
                      <button type="button" className="secondary-button" onClick={() => addManyStudents(filteredStudentIds)} disabled={!filteredStudentIds.length}>Select All Shown</button>
                      <button type="button" className="ghost-button" onClick={() => removeManyStudents(quiz.studentIds)} disabled={!quiz.studentIds.length}>Clear Selection</button>
                    </div>

                    <div className="student-selection-grid">
                      <div className="student-directory-list">
                        {filteredStudents.length ? filteredStudents.map((student) => {
                          const selected = quiz.studentIds.includes(student.id);
                          return (
                            <button
                              key={student.id}
                              type="button"
                              className={selected ? "student-directory-card active" : "student-directory-card"}
                              onClick={() => toggleStudent(student.id)}
                            >
                              <div>
                                <strong>{student.fullName}</strong>
                                <p>{student.email}</p>
                              </div>
                              <div className="student-directory-meta">
                                <span>{student.emailVerified ? "Verified" : "Pending verification"}</span>
                                <span>{student.isActive ? "Active" : "Inactive"}</span>
                              </div>
                            </button>
                          );
                        }) : <p className="info-line">No students matched your search.</p>}
                      </div>

                      <aside className="selected-students-window">
                        <div className="assigned-students-panel">
                          <div className="selected-window-header">
                            <div>
                              <strong>Already Assigned</strong>
                              <p className="info-line">{assignedActiveStudents.length} student(s) currently assigned</p>
                            </div>
                          </div>
                          {assignedActiveStudents.length ? (
                            <div className="selected-student-list assigned-list">
                              {assignedActiveStudents.map((student) => (
                                <div key={student.id} className="assigned-student-pill">
                                  <div>
                                    <span>{student.fullName}</span>
                                    <small>{student.email}</small>
                                  </div>
                                  <button type="button" className="ghost-button danger-button" onClick={() => handleActiveQuizRemove([student.id])}>Remove</button>
                                </div>
                              ))}
                            </div>
                          ) : <p className="info-line">No students are assigned to this quiz yet.</p>}
                        </div>

                        <div className="assigned-students-panel">
                          <div className="selected-window-header">
                            <div>
                              <strong>New Assignments</strong>
                              <p className="info-line">{quiz.studentIds.length} student(s) selected</p>
                            </div>
                          </div>
                          {quiz.studentIds.length ? (
                            <div className="selected-student-list">
                              {selectedStudents.map((student) => (
                                <button key={student.id} type="button" className="selected-student-pill" onClick={() => toggleStudent(student.id)}>
                                  <span>{student.fullName}</span>
                                  <small>{student.email}</small>
                                </button>
                              ))}
                            </div>
                          ) : <p className="info-line">Choose students to add to this quiz.</p>}
                        </div>
                      </aside>
                    </div>

                    <div className="form-actions">
                      <button type="button" className="primary-button" onClick={handleActiveQuizAssign}>Assign Selected Students</button>
                    </div>
                  </div>
                </div>
              ) : (
                <p>Select a quiz from the left to manage it.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeView === "publish" && (
        <div className="task-page">
          <div className="task-intro">
            <p className="eyebrow">Use Case Three</p>
            <h3>Publish Evaluated Results</h3>
            <p>Results stay grouped by exam. An exam becomes ready only after every assigned student has submitted, been evaluated, and any opened integrity case has a proctor decision. Publishing then emails the full group together and automatically stores each student result report for audit review.</p>
          </div>

          <form className="task-card single-column" onSubmit={handlePublish}>
            <Field label="Ready Exam ID"><input required value={publishExamId} onChange={(event) => setPublishExamId(event.target.value)} placeholder="Choose from ready-to-publish exams below" /></Field>
            <div className="form-actions"><button className="primary-button" type="submit">Publish Results</button></div>
          </form>

          <div className="publish-grid">
            <div className="task-card">
              <div className="task-card-header">
                <h3>Ready To Publish</h3>
                <button type="button" className="secondary-button" onClick={loadExams}>Refresh</button>
              </div>
              <div className="list-box">
                {publishBuckets.ready.length ? publishBuckets.ready.map((item) => (
                  <div key={item.id} className="publish-card ready">
                    <div className="publish-card-top">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.course_code}</p>
                      </div>
                      <span className="status-badge ready">{formatPublishState(item.publish_state)}</span>
                    </div>
                    <p className="info-line">Assigned: {item.candidate_count} | Submitted: {item.submitted_count} | Evaluated: {item.evaluated_count} | Open cases pending decision: {item.pending_case_decision_count} | Published: {item.published_count}</p>
                    <button type="button" className="primary-button" onClick={() => setPublishExamId(item.id)}>Select For Publish</button>
                  </div>
                )) : <p>No exams are ready yet.</p>}
              </div>
            </div>

            <div className="task-card">
              <div className="task-card-header">
                <h3>Waiting Queue</h3>
                <span className="info-line">Waiting on submissions, evaluation, or proctor decisions</span>
              </div>
              <div className="list-box">
                {publishBuckets.waiting.length ? publishBuckets.waiting.map((item) => (
                  <div key={item.id} className="publish-card waiting">
                    <div className="publish-card-top">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.course_code}</p>
                      </div>
                      <span className={item.publish_state === "waiting_for_submissions" ? "status-badge muted" : "status-badge waiting"}>{formatPublishState(item.publish_state)}</span>
                    </div>
                    <p className="info-line">Assigned: {item.candidate_count} | Submitted: {item.submitted_count} | Evaluated: {item.evaluated_count} | Open cases pending decision: {item.pending_case_decision_count}</p>
                  </div>
                )) : <p>No exams are waiting right now.</p>}
              </div>
            </div>
          </div>

          <div className="task-card">
            <div className="task-card-header">
              <h3>Already Published</h3>
              <span className="info-line">Published exams remain visible for audit</span>
            </div>
            <div className="list-box">
              {publishBuckets.published.length ? publishBuckets.published.map((item) => (
                <div key={item.id} className="publish-card published">
                  <div className="publish-card-top">
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.course_code}</p>
                    </div>
                    <span className="status-badge published">Published</span>
                  </div>
                  <p className="info-line">Assigned: {item.candidate_count} | Open cases: {item.opened_case_count} | Published results: {item.published_count}</p>
                </div>
              )) : <p>No published exams yet.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
