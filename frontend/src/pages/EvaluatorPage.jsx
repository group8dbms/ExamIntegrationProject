import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

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
    default:
      return state || "Unknown";
  }
}

function formatAnswer(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "No answer";
  if (value === null || value === undefined || value === "") return "No answer";
  return String(value);
}

export default function EvaluatorPage({ session, onLogout, setMessage }) {
  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [markForm, setMarkForm] = useState({ awardedMarks: "", feedback: "" });

  useEffect(() => {
    void loadExams();
  }, [session?.id]);

  const buckets = useMemo(() => ({
    actionable: exams.filter((item) => item.submitted_count > 0 && item.publish_state !== "published"),
    waiting: exams.filter((item) => item.submitted_count === 0),
    done: exams.filter((item) => item.publish_state === "published")
  }), [exams]);

  const selectedSubmission = useMemo(
    () => submissions.find((item) => item.submissionId === selectedSubmissionId) || null,
    [selectedSubmissionId, submissions]
  );

  const evaluationStats = useMemo(() => ({
    total: submissions.length,
    marked: submissions.filter((item) => item.awardedMarks !== null && item.awardedMarks !== undefined).length,
    pending: submissions.filter((item) => item.awardedMarks === null || item.awardedMarks === undefined).length
  }), [submissions]);

  useEffect(() => {
    if (selectedSubmission) {
      setMarkForm({
        awardedMarks: selectedSubmission.awardedMarks ?? "",
        feedback: selectedSubmission.feedback ?? ""
      });
    }
  }, [selectedSubmission]);

  async function loadExams() {
    try {
      const data = await api("/api/exams");
      setExams(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openEvaluationDesk(exam) {
    try {
      const data = await api(`/api/exams/${exam.id}/evaluation-submissions`);
      setSelectedExam(data.exam);
      setSubmissions(data.items || []);
      const firstPending = (data.items || []).find((item) => item.awardedMarks === null || item.awardedMarks === undefined);
      const firstItem = firstPending || data.items?.[0];
      setSelectedSubmissionId(firstItem?.submissionId || "");
      if (firstItem) {
        setMarkForm({
          awardedMarks: firstItem.awardedMarks ?? "",
          feedback: firstItem.feedback ?? ""
        });
      } else {
        setMarkForm({ awardedMarks: "", feedback: "" });
      }
      setMessage(`Loaded ${data.items.length} submitted script(s) for ${exam.title}. Choose a student to begin evaluation.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveEvaluation(event) {
    event.preventDefault();
    if (!selectedExam || !selectedSubmission) {
      setMessage("Choose an exam and a submitted script first.");
      return;
    }

    try {
      await api(`/api/exams/${selectedExam.id}/evaluations/${selectedSubmission.submissionId}`, {
        method: "POST",
        body: JSON.stringify({
          evaluatorId: session.id,
          awardedMarks: Number(markForm.awardedMarks),
          feedback: markForm.feedback,
          rubricBreakdown: {}
        })
      });

      const currentSubmissionId = selectedSubmission.submissionId;
      setMessage(`Saved marks for ${selectedSubmission.studentName}. Continue with the next student in the same exam.`);
      await loadExams();
      const data = await api(`/api/exams/${selectedExam.id}/evaluation-submissions`);
      setSelectedExam(data.exam);
      setSubmissions(data.items || []);

      const refreshedCurrent = (data.items || []).find((item) => item.submissionId === currentSubmissionId);
      const nextPending = (data.items || []).find((item) => item.awardedMarks === null || item.awardedMarks === undefined);
      const nextTarget = nextPending || refreshedCurrent || data.items?.[0];
      setSelectedSubmissionId(nextTarget?.submissionId || "");
      setMarkForm({
        awardedMarks: nextTarget?.awardedMarks ?? "",
        feedback: nextTarget?.feedback ?? ""
      });
    } catch (error) {
      setMessage(error.message);
    }
  }

  return <section className="workspace-shell">
    <div className="workspace-header">
      <div>
        <p className="eyebrow">Evaluator Workspace</p>
        <h2>{session.fullName}</h2>
        <p className="info-line">{session.email}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onLogout}>Logout</button>
    </div>

    <div className="task-page">
      <div className="task-intro">
        <p className="eyebrow">Evaluation View</p>
        <h3>Open a Subject Test, Then Evaluate Students One by One</h3>
        <p>The evaluator first sees exam groups with submitted scripts. Opening a subject test reveals the student list for that exam, and each student can then be reviewed and marked individually.</p>
      </div>

      <div className="publish-grid">
        <div className="task-card">
          <div className="task-card-header"><h3>Submitted Subject Tests</h3><button type="button" className="secondary-button" onClick={loadExams}>Refresh</button></div>
          <div className="list-box">
            {buckets.actionable.map((item) => <div key={item.id} className="publish-card waiting">
              <div className="publish-card-top">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.course_code}</p>
                </div>
                <span className={item.publish_state === "ready_to_publish" ? "status-badge ready" : "status-badge waiting"}>{formatPublishState(item.publish_state)}</span>
              </div>
              <p className="info-line">Assigned: {item.candidate_count} | Submitted: {item.submitted_count} | Evaluated: {item.evaluated_count}</p>
              <button type="button" className="primary-button" onClick={() => openEvaluationDesk(item)}>View Student List</button>
            </div>)}
            {!buckets.actionable.length && <p>No subject tests with submitted scripts are available right now.</p>}
          </div>
        </div>

        <div className="task-card">
          <div className="task-card-header"><h3>Other Exams</h3><span className="info-line">Submission and publication status</span></div>
          <div className="list-box">
            {buckets.waiting.map((item) => <div key={item.id} className="publish-card muted">
              <div className="publish-card-top">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.course_code}</p>
                </div>
                <span className="status-badge muted">{formatPublishState(item.publish_state)}</span>
              </div>
              <p className="info-line">Assigned: {item.candidate_count} | No submitted answer scripts yet.</p>
            </div>)}
            {buckets.done.map((item) => <div key={item.id} className="publish-card published">
              <div className="publish-card-top">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.course_code}</p>
                </div>
                <span className="status-badge published">Published</span>
              </div>
              <p className="info-line">Assigned: {item.candidate_count} | Evaluated: {item.evaluated_count} | Published: {item.published_count}</p>
            </div>)}
            {!buckets.waiting.length && !buckets.done.length && <p>No additional exams found.</p>}
          </div>
        </div>
      </div>

      {selectedExam && <div className="task-page task-layout-split">
        <div className="task-card">
          <div className="task-card-header">
            <div>
              <h3>Student List</h3>
              <span className="info-line">{selectedExam.title} | {selectedExam.course_code}</span>
            </div>
            <span className="info-line">Submitted: {evaluationStats.total} | Marked: {evaluationStats.marked} | Pending: {evaluationStats.pending}</span>
          </div>
          <div className="list-box">
            {submissions.map((item) => <button key={item.submissionId} type="button" className={selectedSubmissionId === item.submissionId ? "publish-card ready" : "publish-card muted"} onClick={() => setSelectedSubmissionId(item.submissionId)}>
              <div className="publish-card-top">
                <div>
                  <strong>{item.studentName}</strong>
                  <p>{item.studentEmail}</p>
                </div>
                <span className={item.awardedMarks !== null && item.awardedMarks !== undefined ? "status-badge ready" : "status-badge waiting"}>{item.awardedMarks !== null && item.awardedMarks !== undefined ? "Evaluated" : "Pending"}</span>
              </div>
              <p className="info-line">Integrity score: {item.integrityScore} | Case: {item.caseStatus} | Hash verified: {item.submissionHashVerified ? "Yes" : "No"}</p>
            </button>)}
            {!submissions.length && <p>No submitted scripts found for this exam.</p>}
          </div>
        </div>

        <div className="task-card">
          {selectedSubmission ? <>
            <div className="task-card-header">
              <div>
                <h3>{selectedSubmission.studentName}</h3>
                <p className="info-line">Reviewing one submitted script at a time</p>
                <p className="info-line">Integrity score: {selectedSubmission.integrityScore} | Case status: {selectedSubmission.caseStatus} | Submission hash verified: {selectedSubmission.submissionHashVerified ? "Yes" : "No"}</p>
              </div>
            </div>

            <div className="question-list">
              {selectedSubmission.answers.map((answer) => <div key={answer.questionId} className="question-preview-card">
                <strong>Q{answer.sequenceNo}. {answer.prompt}</strong>
                <span className="info-line">{answer.questionType.toUpperCase()} | Max marks: {answer.maxMarks}</span>
                <span><strong>Student answer:</strong> {formatAnswer(answer.studentAnswer)}</span>
                <span><strong>Expected answer:</strong> {formatAnswer(answer.correctAnswer)}</span>
              </div>)}
            </div>

            <form className="single-column" onSubmit={saveEvaluation}>
              <label className="field"><span>Awarded Marks</span><input type="number" min="0" max={selectedSubmission.totalMarks} step="0.5" value={markForm.awardedMarks} onChange={(event) => setMarkForm({ ...markForm, awardedMarks: event.target.value })} required /></label>
              <label className="field"><span>Evaluator Feedback</span><textarea rows="5" value={markForm.feedback} onChange={(event) => setMarkForm({ ...markForm, feedback: event.target.value })} placeholder="Add evaluator remarks" /></label>
              <div className="form-actions"><button className="primary-button" type="submit">Save Marks</button></div>
            </form>
          </> : <p>Select a student from the list to review answers and save marks.</p>}
        </div>
      </div>}
    </div>
  </section>;
}
