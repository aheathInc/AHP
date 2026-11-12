'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage, idem } from '@/lib/api';

type Assessment = { id: string; check_in_id: string; score: number | null; band: string; created_at: string;
  components: { adherence: number | null }; missing: string[];
  sources?: { dose_reports?: { id: string; scheduled_at: string; reported_at: string | null; status: string }[] }; clinical_summary: { section: string; text: string; source: { check_in_id: string; received_at: string } }[] };
type Report = { plan: null | { category: string; interval_days: number; rule_version: string }; assessments: Assessment[];
  alerts: { id: string; reason: string; created_at: string }[] };
const vitalOptions = { temperature_c: 'Temperature °C', systolic: 'Systolic BP mmHg', diastolic: 'Diastolic BP mmHg', glucose_mmol_l: 'Glucose mmol/L', spo2: 'Oxygen saturation %' };
interface AfpeClient { get<T>(path: string): Promise<{ data: T }>; post<T>(path: string, body: unknown, options?: { headers: Record<string, string> }): Promise<{ data: T }> }
export function AfpePanel({ cycleId, client = api }: { cycleId: string; client?: AfpeClient }) {
  const [report, setReport] = useState<Report | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [ranges, setRanges] = useState([{ key: 'temperature_c', min: '', max: '', reading: '' }]);
  useEffect(() => { let live = true; setReport(null); setError('');
    void client.get<Report>(`/care-continuity/cycles/${cycleId}/afpe`).then(r => { if (live) setReport(r.data); }).catch(e => { if (live) setError(errorMessage(e, 'AFPE report unavailable.')); });
    return () => { live = false; };
  }, [cycleId, client]);
  async function activate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
    try {
      if (new Set(ranges.map(r => r.key)).size !== ranges.length) throw new Error('Choose each vital measure once.');
      await client.post(`/care-continuity/cycles/${cycleId}/afpe`, {
        category: form.get('category'), diagnosis_context: form.get('diagnosis-context'), diagnosis_codes: String(form.get('codes')).split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
        baseline: { symptom_severity: Number(form.get('severity')), medication_required: form.get('medications') === 'yes',
          vitals: Object.fromEntries(ranges.map(r => [r.key, Number(r.reading)])), vital_bounds: Object.fromEntries(ranges.map(r => [r.key, { min: Number(r.min), max: Number(r.max) }])) }, consent_confirmed: true,
      }, idem());
      setReport((await client.get<Report>(`/care-continuity/cycles/${cycleId}/afpe`)).data);
    } catch (e) { setError(errorMessage(e, 'AFPE configuration was not saved.')); } finally { setBusy(false); }
  }
  const history = report?.assessments.slice().reverse() ?? [];
  const firstTime = history.length ? new Date(history[0]!.created_at).getTime() : 0;
  const lastTime = history.length ? new Date(history[history.length - 1]!.created_at).getTime() : firstTime;
  const trendX = (a: Assessment) => 30 + (new Date(a.created_at).getTime() - firstTime) / Math.max(lastTime - firstTime, 1) * 540;
  return <section aria-label="Longitudinal follow-up" className="care-checkin">
    <h3>Longitudinal follow-up</h3>
    <p className="care-muted">AFPE research scoring policy v1. Clinical validation is required before using scores to guide care.</p>
    {error && <p role="alert">{error}</p>}
    {!report && !error && <p role="status">Loading longitudinal report…</p>}
    {report && !report.plan && <details><summary>Configure diagnosis-linked follow-up</summary><form onSubmit={activate} className="flex flex-col gap-3 mt-3">
      <label>Clinical category<select name="category" required className="care-input"><option value="auto">Use approved ICD-10 rules</option><option value="acute">Acute / high risk · daily for 14 days</option><option value="subacute">Subacute / titration · weekly for 90 days</option><option value="chronic">Chronic / maintenance · every 30 days, ongoing</option></select></label>
      <label>Clinical context<select name="diagnosis-context" required defaultValue=""><option value="" disabled>Choose clinical context</option><option value="new">New diagnosis</option><option value="stable">Stable</option><option value="uncontrolled">Uncontrolled</option><option value="high_risk">High risk</option><option value="postoperative">Postoperative</option><option value="treatment_initiation">Treatment initiation</option></select></label>
      <label>ICD-10 codes from the signed consultation<input name="codes" required placeholder="I10" className="care-input"/></label>
      <label>Discharge symptom severity (0–10)<input name="severity" type="number" required min="0" max="10" step="1" className="care-input"/></label>
      <label>Medication adherence applies<select name="medications" required className="care-input"><option value="yes">Prescribed medication</option><option value="no">No medication prescribed</option></select></label>
      <p>Set the patient’s acceptable vital ranges using clinical judgment.</p>
      {ranges.map((r, i) => <div key={i} className="flex flex-wrap gap-2"><label>Measure<select value={r.key} onChange={e => setRanges(rows => rows.map((row, n) => n === i ? { ...row, key: e.target.value } : row))}>{Object.entries(vitalOptions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Discharge reading<input required type="number" step="any" value={r.reading} onChange={e => setRanges(rows => rows.map((row, n) => n === i ? { ...row, reading: e.target.value } : row))}/></label><label>Minimum<input required type="number" step="any" value={r.min} onChange={e => setRanges(rows => rows.map((row, n) => n === i ? { ...row, min: e.target.value } : row))}/></label><label>Maximum<input required type="number" step="any" value={r.max} onChange={e => setRanges(rows => rows.map((row, n) => n === i ? { ...row, max: e.target.value } : row))}/></label></div>)}
      {ranges.length < 5 && <button className="care-button care-secondary" type="button" onClick={() => setRanges(r => [...r, { key: Object.keys(vitalOptions).find(key => !r.some(row => row.key === key))!, min: '', max: '', reading: '' }])}>Add vital measure</button>}
      <label><input type="checkbox" required/> Patient consent and the discharge baseline have been confirmed.</label>
      <button className="care-button" disabled={busy}>{busy ? 'Saving…' : 'Activate follow-up'}</button>
    </form></details>}
    {report?.plan && <>
      <p>{report.plan.category} · every {report.plan.interval_days} day(s) · {report.plan.rule_version}</p>
      {report.alerts.map(alert => <div key={alert.id} className="care-alert care-alert-warn"><strong>{alert.reason.replaceAll('_', ' ')}</strong><button className="care-button care-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await client.post(`/care-continuity/afpe/alerts/${alert.id}/acknowledge`, {}, idem()); setReport((await client.get<Report>(`/care-continuity/cycles/${cycleId}/afpe`)).data); } catch (e) { setError(errorMessage(e, 'Acknowledgement failed.')); } finally { setBusy(false); } }}>Acknowledge</button></div>)}
      {!report.assessments.length && <p>No scored check-ins yet. The next scheduled check-in collects the baseline measures.</p>}
      {report.assessments.length > 0 && <>
        <svg role="img" aria-label="Prognosis score trend; exact values follow in the table" viewBox="0 0 600 150" style={{ width: '100%', maxHeight: 180 }}>
          <line x1="20" y1="130" x2="580" y2="130" stroke="currentColor"/><text x="0" y="20" fill="currentColor">100</text><text x="0" y="145" fill="currentColor">0</text>
          {history.map((a, i, rows) => a.score === null ? null : <g key={a.id}><rect x={trendX(a) - 4} y={130 - (a.components.adherence ?? 0)} width={8} height={a.components.adherence ?? 0} fill="currentColor" opacity=".15"/><circle cx={trendX(a)} cy={130 - a.score} r="4" fill="currentColor"/>{i > 0 && rows[i - 1]!.score !== null && <line x1={trendX(rows[i - 1]!)} y1={130 - rows[i - 1]!.score!} x2={trendX(a)} y2={130 - a.score} stroke="currentColor"/>}</g>)}
        </svg>
        <table className="care-table"><caption>Patient-reported trends · bars show adherence; points show score</caption><thead><tr><th>Date</th><th>Score</th><th>Adherence</th><th>Status</th></tr></thead><tbody>{report.assessments.map(a => <tr key={a.id}><td>{new Date(a.created_at).toLocaleDateString()}</td><td>{a.score ?? 'Incomplete'}</td><td>{a.components.adherence === null ? 'Unknown' : `${a.components.adherence}%`}</td><td>{a.band}</td></tr>)}</tbody></table>
        <details id="afpe-dose-evidence"><summary>Medication report evidence for the latest assessment</summary><table className="care-table"><thead><tr><th>Scheduled</th><th>Patient report</th><th>Reported at</th></tr></thead><tbody>{report.assessments[0]!.sources?.dose_reports?.map(d => <tr key={d.id}><td>{new Date(d.scheduled_at).toLocaleString()}</td><td>{d.status}</td><td>{d.reported_at ? new Date(d.reported_at).toLocaleString() : 'Not confirmed'}</td></tr>)}</tbody></table></details>
        <h4>Latest clinical digest</h4><ul>{report.assessments[0]!.clinical_summary.map((b, i) => <li key={i}><strong>{b.section}</strong> {b.text} <a href={`#checkin-${b.source.check_in_id}`}>Patient response · {new Date(b.source.received_at).toLocaleString()}</a>{b.section === 'O' && <> · <a href="#afpe-dose-evidence">Medication report evidence</a></>}</li>)}</ul>
      </>}
    </>}
  </section>;
}
export function AfpeLiveAlerts({ onOpen }: { onOpen: (cycleId: string) => void }) {
  const [alerts, setAlerts] = useState<{ id: string; cycle_id: string; reason: string }[]>([]), [connected, setConnected] = useState(false);
  useEffect(() => { const events = new EventSource('/bff/care-continuity/afpe/events');
    events.addEventListener('afpe-alert', e => { try { setAlerts(JSON.parse((e as MessageEvent).data)); setConnected(true); } catch { setConnected(false); } });
    events.onerror = () => setConnected(false); return () => events.close();
  }, []);
  return <section aria-label="Live follow-up alerts" className="care-panel" style={{ padding: 16, marginBottom: 16 }}><h2>Follow-up alerts</h2><p className="care-muted">{connected ? 'Live dashboard connection' : 'Connecting to live alerts… Refresh the worklist if this persists.'}</p><div aria-live="polite">{alerts.map(a => <button key={a.id} className="care-button care-secondary" onClick={() => onOpen(a.cycle_id)}>{a.reason.replaceAll('_', ' ')} · open patient</button>)}{connected && !alerts.length && <span>No unacknowledged alerts.</span>}</div></section>;
}
