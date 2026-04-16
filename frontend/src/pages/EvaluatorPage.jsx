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
  const [markForm, setMarkForm] = useState({ awardedMarks: "", feedback: "", overrideComment: "" });
  const [recheckRequests, setRecheckRequests] = useState([]);
  const [selectedRecheckId, setSelectedRecheckId] = useState("");
  const [reviewForm, setReviewForm] = useState({ status: "accepted", decisionNotes: "", adjustedMarks: "" });

  useEffect(() => {
    void loadWorkspace();
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

  const selectedRecheck = useMemo(
    () => recheckRequests.find((item) => item.id === selectedRecheckId) || null,
    [recheckRequests, selectedRecheckId]
  );

  const evaluationStats = useMemo(() => ({
    total: submissions.length,
    marked: submissions.filter((item) => item.awardedMarks !== null && item.awardedMarks !== undefined).length,
    pending: submissions.filter((item) => item.awardedMarks === null || item.awardedMarks === undefined).length
  }), [submissions]);

  useEffect(() => {
    if (selectedSubmission) {
      setMarkForm({
        awardedMarks: selectedSubmission.awardedMarks ?? selectedSubmission.autoAwardedMarks ?? "",
        feedback: selectedSubmission.feedback ?? "",
        overrideComment: selectedSubmission.overrideComment ?? ""
      });
    }
  }, [selectedSubmission]);

  useEffect(() => {
    if (selectedRecheck) {
      setReviewForm({
        status: selectedRecheck.status === "requested" ? "accepted" : selectedRecheck.status,
        decisionNotes: selectedRecheck.decisionNotes ?? "",
        adjustedMarks: selectedRecheck.adjustedMarks ?? ""
      });
    }
  }, [selectedRecheck]);

  async function loadWorkspace() {
    await Promise.all([loadExams(), loadRecheckRequests()]);
  }

  async function loadExams() {
    try {
      const data = await api("/api/exams");
      setExams(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadRecheckRequests() {
    try {
      const data = await api("/api/rechecks/requests");
      const items = data.items || [];
      setRecheckRequests(items);
      setSelectedRecheckId((current) => {
        if (!items.length) return "";
        return items.some((item) => item.id === current) ? current : items[0].id;
      });
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
          awardedMarks: firstItem.awardedMarks ?? firstItem.autoAwardedMarks ?? "",
          feedback: firstItem.feedback ?? "",
          overrideComment: firstItem.overrideComment ?? ""
        });
      } else {
        setMarkForm({ awardedMarks: "", feedback: "", overrideComment: "" });
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
          overrideComment: markForm.overrideComment,
          rubricBreakdown: {}
        })
      });

      const currentSubmissionId = selectedSubmission.submissionId;
      setMessage(`Saved marks for ${selectedSubmission.studentName}. Continue with the next student in the same exam.`);
      await loadWorkspace();
      const data = await api(`/api/exams/${selectedExam.id}/evaluation-submissions`);
      setSelectedExam(data.exam);
      setSubmissions(data.items || []);

      const refreshedCurrent = (data.items || []).find((item) => item.submissionId === currentSubmissionId);
      const nextPending = (data.items || []).find((item) => item.awardedMarks === null || item.awardedMarks === undefined);
      const nextTarget = nextPending || refreshedCurrent || data.items?.[0];
      setSelectedSubmissionId(nextTarget?.submissionId || "");
      setMarkForm({
        awardedMarks: nextTarget?.awardedMarks ?? nextTarget?.autoAwardedMarks ?? "",
        feedback: nextTarget?.feedback ?? "",
        overrideComment: nextTarget?.overrideComment ?? ""
      });
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function reviewRecheck(event) {
    event.preventDefault();
    if (!selectedRecheck) {
      setMessage("Choose a re-check request first.");
      return;
    }

    try {
      await api(`/api/rechecks/requests/${selectedRecheck.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          reviewedBy: session.id,
          actorRole: "evaluator",
          status: reviewForm.status,
          decisionNotes: reviewForm.decisionNotes,
          adjustedMarks: reviewForm.status === "adjusted" ? Number(reviewForm.adjustedMarks) : null
        })
      });

      setMessage(`Re-check request updated for ${selectedRecheck.studentName}.`);
      await loadWorkspace();
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
                <span>
                  <strong>Auto marks:</strong> {answer.autoAwardedMarks}/{answer.maxMarks}
                  {answer.autoScored ? (answer.autoMatched ? " | Exact match" : " | No exact match") : " | Manual review"}
                </span>
              </div>)}
            </div>

            <form className="single-column" onSubmit={saveEvaluation}>
              <div className="question-preview-card recheck-summary-card">
                <span><strong>Auto total:</strong> {selectedSubmission.autoAwardedMarks}/{selectedSubmission.totalMarks}</span>
                <span><strong>Saved total:</strong> {selectedSubmission.awardedMarks ?? selectedSubmission.autoAwardedMarks}/{selectedSubmission.totalMarks}</span>
                <button type="button" className="secondary-button" onClick={() => setMarkForm((current) => ({ ...current, awardedMarks: selectedSubmission.autoAwardedMarks, overrideComment: "" }))}>
                  Use Auto Total
                </button>
              </div>
              <label className="field"><span>Awarded Marks</span><input type="number" min="0" max={selectedSubmission.totalMarks} step="0.5" value={markForm.awardedMarks} onChange={(event) => setMarkForm({ ...markForm, awardedMarks: event.target.value })} required /></label>
              {Number(markForm.awardedMarks) !== Number(selectedSubmission.autoAwardedMarks) ? (
                <label className="field">
                  <span>Override Comment</span>
                  <textarea rows="3" value={markForm.overrideComment} onChange={(event) => setMarkForm({ ...markForm, overrideComment: event.target.value })} placeholder="Explain why the final total differs from the auto-calculated MCQ/MSQ score." required />
                </label>
              ) : null}
              <label className="field"><span>Evaluator Feedback</span><textarea rows="5" value={markForm.feedback} onChange={(event) => setMarkForm({ ...markForm, feedback: event.target.value })} placeholder="Add evaluator remarks" /></label>
              <div className="form-actions"><button className="primary-button" type="submit">Save Marks</button></div>
            </form>
          </> : <p>Select a student from the list to review answers and save marks.</p>}
        </div>
      </div>}

      <div className="task-page task-layout-split">
        <div className="task-card">
          <div className="task-card-header">
            <div>
              <h3>Re-check Requests</h3>
              <p className="info-line">Students can request review after published results.</p>
            </div>
            <button type="button" className="secondary-button" onClick={loadRecheckRequests}>Refresh</button>
          </div>
          <div className="list-box">
            {recheckRequests.map((item) => <button key={item.id} type="button" className={selectedRecheckId === item.id ? "publish-card ready" : "publish-card muted"} onClick={() => setSelectedRecheckId(item.id)}>
              <div className="publish-card-top">
                <div>
                  <strong>{item.studentName}</strong>
                  <p>{item.examTitle} | {item.courseCode}</p>
                </div>
                <span className={item.status === "requested" ? "status-badge waiting" : item.status === "adjusted" ? "status-badge ready" : "status-badge published"}>{item.status}</span>
              </div>
              <p className="info-line">Current marks: {item.awardedMarks}/{item.totalMarks} | Percentage: {item.percentage}%</p>
              <p className="info-line">Reason: {item.reason}</p>
            </button>)}
            {!recheckRequests.length && <p>No re-check requests have been submitted yet.</p>}
          </div>
        </div>

        <div className="task-card">
          {selectedRecheck ? <>
            <div className="task-card-header">
              <div>
                <h3>{selectedRecheck.studentName}</h3>
                <p className="info-line">{selectedRecheck.studentEmail}</p>
                <p className="info-line">{selectedRecheck.examTitle} | Current marks: {selectedRecheck.awardedMarks}/{selectedRecheck.totalMarks}</p>
              </div>
            </div>

            <div className="question-preview-card recheck-summary-card">
              <span><strong>Reason:</strong> {selectedRecheck.reason}</span>
              <span><strong>Integrity score:</strong> {selectedRecheck.integrityScore}</span>
              <span><strong>Case status:</strong> {selectedRecheck.caseStatus}</span>
              <span><strong>Hash verified:</strong> {selectedRecheck.submissionHashVerified ? "Yes" : "No"}</span>
            </div>

            <form className="single-column" onSubmit={reviewRecheck}>
              <label className="field">
                <span>Decision</span>
                <select value={reviewForm.status} onChange={(event) => setReviewForm({ ...reviewForm, status: event.target.value })}>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="adjusted">Adjusted Marks</option>
                </select>
              </label>

              {reviewForm.status === "adjusted" ? (
                <label className="field">
                  <span>Adjusted Marks</span>
                  <input type="number" min="0" max={selectedRecheck.totalMarks} step="0.5" value={reviewForm.adjustedMarks} onChange={(event) => setReviewForm({ ...reviewForm, adjustedMarks: event.target.value })} required />
                </label>
              ) : null}

              <label className="field">
                <span>Decision Notes</span>
                <textarea rows="5" value={reviewForm.decisionNotes} onChange={(event) => setReviewForm({ ...reviewForm, decisionNotes: event.target.value })} placeholder="Explain the review outcome." />
              </label>

              <div className="form-actions">
                <button className="primary-button" type="submit">Save Re-check Decision</button>
              </div>
            </form>
          </> : <p>Select a re-check request to review it.</p>}
        </div>
      </div>
    </div>
  </section>;
}
