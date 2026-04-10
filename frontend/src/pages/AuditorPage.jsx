import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function AuditorPage({ session, onLogout, setMessage }) {
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [logs, setLogs] = useState([]);
  const [decision, setDecision] = useState({ caseId: "", status: "under_review", decision: "manual_review", decisionNotes: "", actionBy: session.id, resolvedBy: session.id });

  useEffect(() => {
    void loadCases();
    void loadLogs();
  }, [session?.id]);

  async function loadCases() {
    try {
      const data = await api("/api/integrity/cases");
      setCases(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadLogs() {
    try {
      const data = await api("/api/audit/logs?limit=20");
      setLogs(data.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openCase(caseId) {
    try {
      const data = await api(`/api/integrity/cases/${caseId}`);
      setSelected(data);
      setDecision((current) => ({ ...current, caseId, actionBy: session.id, resolvedBy: session.id }));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveDecision(event) {
    event.preventDefault();
    if (!decision.caseId) return setMessage("Choose a case first.");
    try {
      await api(`/api/integrity/cases/${decision.caseId}/decision`, { method: "PATCH", body: JSON.stringify({ ...decision, actorRole: "auditor" }) });
      setMessage("Integrity case decision saved.");
      loadCases();
      loadLogs();
      openCase(decision.caseId);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return <section className="workspace-shell">
    <div className="workspace-header">
      <div>
        <p className="eyebrow">Auditor Workspace</p>
        <h2>{session.fullName}</h2>
        <p className="info-line">{session.email}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onLogout}>Logout</button>
    </div>

    <div className="task-page task-layout-split">
      <div className="task-card">
        <div className="task-card-header"><h3>Integrity Cases</h3><button type="button" className="secondary-button" onClick={loadCases}>Refresh</button></div>
        <div className="list-box">{cases.map((item) => <button key={item.id} className="list-item action-card" type="button" onClick={() => openCase(item.id)}><strong>{item.student_name}</strong><span>{item.exam_title}</span><span>Integrity score: {item.current_score}</span><span>Case status: {item.status}</span><span>Evidence items: {item.evidence_count}</span></button>)}{!cases.length && <p>No cases yet.</p>}</div>
      </div>

      <form className="task-card single-column" onSubmit={saveDecision}>
        <div className="task-card-header"><h3>Decision Workflow</h3></div>
        <label className="field"><span>Case ID</span><input value={decision.caseId} onChange={(e) => setDecision({ ...decision, caseId: e.target.value })} /></label>
        <label className="field"><span>Status</span><select value={decision.status} onChange={(e) => setDecision({ ...decision, status: e.target.value })}><option value="under_review">Under Review</option><option value="cleared">Cleared</option><option value="confirmed_cheating">Confirmed Cheating</option><option value="resolved">Resolved</option></select></label>
        <label className="field"><span>Decision</span><select value={decision.decision} onChange={(e) => setDecision({ ...decision, decision: e.target.value })}><option value="manual_review">Manual Review</option><option value="warning">Warning</option><option value="no_issue">No Issue</option><option value="invalidate_exam">Invalidate Exam</option></select></label>
        <label className="field"><span>Decision Notes</span><textarea rows="5" value={decision.decisionNotes} onChange={(e) => setDecision({ ...decision, decisionNotes: e.target.value })} /></label>
        <div className="form-actions"><button className="primary-button" type="submit">Save Decision</button></div>
      </form>
    </div>

    <div className="task-page task-layout-split">
      <div className="task-card">
        <div className="task-card-header"><h3>Audit Logs</h3><button type="button" className="secondary-button" onClick={loadLogs}>Refresh</button></div>
        <div className="list-box">{logs.map((item) => <div key={item.id} className="list-item"><strong>{item.action}</strong><span>{item.entity_type}</span><span>{item.actor_role || "system"}</span><span>{new Date(item.occurred_at).toLocaleString()}</span></div>)}{!logs.length && <p>No logs found.</p>}</div>
      </div>

      {selected ? <div className="task-card">
        <div className="task-card-header"><h3>Case Details</h3></div>
        <p className="info-line">{selected.case.student_name} | {selected.case.exam_title}</p>
        <p className="info-line">Integrity score: {selected.case.current_score} | Case status: {selected.case.status}</p>
        <div className="panel-grid">
          <div>
            <h4>Evidence</h4>
            <div className="list-box">{selected.evidence.map((item) => <div key={item.id} className="list-item"><strong>{item.evidence_type}</strong><span>{JSON.stringify(item.payload)}</span></div>)}</div>
          </div>
          <div>
            <h4>Actions</h4>
            <div className="list-box">{selected.actions.map((item) => <div key={item.id} className="list-item"><strong>{item.action_type}</strong><span>{item.note}</span></div>)}</div>
          </div>
        </div>
      </div> : <div className="task-card"><p>Select a case to inspect its evidence and actions.</p></div>}
    </div>
  </section>;
}
