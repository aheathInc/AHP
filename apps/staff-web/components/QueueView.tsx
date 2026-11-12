'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, idem, type DeclineReason, type Page, type QueueEntry, type Urgency } from '@/lib/api';
import { actionableQueue, filterQueue } from '@/lib/queue-workflow';
import { Button, Empty, Loading, Notice, inputClass } from './ui';
import { QueueCard } from './QueueCard';

const REFRESH_MS = 15000;
export function QueueView() {
  const router = useRouter();
  const [scope, setScope] = useState<'offered' | 'mine'>('offered');
  const [urgency, setUrgency] = useState<Urgency | ''>('');
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<'priority' | 'oldest'>('priority');
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  const contextKey = `${scope}:${urgency}`;
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0), mounted = useRef(false), requesting = useRef(false), action = useRef(false), expanded = useRef(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor?: string) => {
    if (requesting.current || action.current) return;
    const version = generation.current, controller = new AbortController();
    request.current = controller; requesting.current = true; setRefreshing(true);
    try {
      const res = await api.get<Page<QueueEntry>>('/queue', { params: { scope, limit: 50, ...(urgency ? { urgency_level: urgency } : {}), ...(cursor ? { cursor } : {}) }, signal: controller.signal });
      if (!mounted.current || version !== generation.current) return;
      if (!Array.isArray(res.data.data) || typeof res.data.meta?.has_more !== 'boolean') throw new Error('Invalid queue response');
      if (res.data.meta?.has_more && !res.data.meta.next_cursor) throw new Error('Missing queue cursor');
      if (cursor && res.data.meta?.next_cursor === cursor) throw new Error('Repeated queue cursor');
      setEntries(previous => cursor ? Array.from(new Map([...previous, ...res.data.data].map(e => [e.consultation.id, e])).values()) : res.data.data);
      setLoadedContext(`${scope}:${urgency}`);
      setNext(res.data.meta.has_more ? res.data.meta.next_cursor ?? null : null); setLastUpdated(Date.now()); setError(null);
      expanded.current = Boolean(cursor);
    } catch (e) {
      if (mounted.current && version === generation.current && !controller.signal.aborted) setError(errorMessage(e, 'Queue refresh failed. The last loaded records may be out of date. Retry before accepting or declining a case.'));
    } finally {
      if (version === generation.current && mounted.current) { requesting.current = false; setRefreshing(false); setLoading(false); }
    }
  }, [scope, urgency]);

  useEffect(() => {
    mounted.current = true; generation.current++; requesting.current = false; expanded.current = false;
    setEntries([]); setLoadedContext(null); setNext(null); setLastUpdated(null); setError(null); setLoading(true); setSearch('');
    void load();
    const timer = setInterval(() => { if (!expanded.current && document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); clearInterval(timer); };
  }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  async function mutate(id: string, reason?: DeclineReason) {
    if (action.current || requesting.current || error || refreshing || loadedContext !== contextKey) return;
    action.current = true; setBusyId(id);
    const version = ++generation.current;
    request.current?.abort(); requesting.current = false;
    try {
      await api.post(`/consultations/${id}/${reason ? 'decline' : 'accept'}`, reason ? { reason } : {}, idem());
      if (!mounted.current || version !== generation.current) return;
      setEntries(rows => rows.filter(e => e.consultation.id !== id));
      if (!reason) router.push(`/doctor/case/${id}`);
    } catch (e) {
      if (mounted.current && version === generation.current) setError(errorMessage(e, 'The action was not confirmed. Refresh the queue before retrying.'));
    } finally { action.current = false; if (mounted.current && version === generation.current) setBusyId(null); }
  }
  const waiting = loading || (loadedContext !== contextKey && !error);
  const active = loadedContext === contextKey ? actionableQueue(entries, scope, now) : [];
  const visible = filterQueue(active, search, order);
  const disabled = Boolean(busyId) || refreshing;
  return <div>
    <section className="ahp-stat-grid" aria-label="Loaded queue summary">
      {[{ label: scope === 'offered' ? 'Available offers' : 'My active cases', value: active.length }, { label: 'Urgent requests', value: active.filter(e => e.consultation.urgency_level === 'urgent').length }, { label: 'Emergency requests', value: active.filter(e => e.consultation.urgency_level === 'emergency').length }, { label: 'SLA overdue', value: active.filter(e => Date.parse(e.consultation.sla_deadline_at) <= now).length }].map(stat => <div key={stat.label} className="ahp-stat"><span className="ahp-stat-label">{stat.label}</span><strong className="ahp-stat-value">{waiting || error ? '—' : stat.value}</strong><span className="ahp-stat-note">Loaded records, not a hospital total</span></div>)}
    </section>
    <section className="ahp-card p-0 ahp-queue-body">
      <div className="ahp-toolbar"><h2>Consultation queue</h2><Button variant="quiet" onClick={() => void load()} disabled={disabled}>{refreshing ? 'Refreshing…' : 'Refresh queue'}</Button></div>
      <div className="flex flex-wrap gap-2 border-b border-line p-3" aria-label="Queue scope">
        {(['offered', 'mine'] as const).map(s => <button key={s} disabled={Boolean(busyId)} aria-pressed={scope === s} onClick={() => setScope(s)} className={`min-h-11 rounded-md px-4 ${scope === s ? 'bg-petrol text-white' : 'text-ink-soft'}`}>{s === 'offered' ? 'Offered to me' : 'My active cases'}</button>)}
      </div>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <label className="min-w-0 flex-1">Search loaded records<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Request ID, symptoms, facility…" className={inputClass}/></label>
        <label>Urgency<select value={urgency} disabled={Boolean(busyId)} onChange={e => setUrgency(e.target.value as Urgency | '')} className={inputClass}><option value="">All urgency levels</option><option value="emergency">Emergency</option><option value="urgent">Urgent</option><option value="routine">Routine</option></select></label>
        <label>Order loaded records<select value={order} onChange={e => setOrder(e.target.value as typeof order)} className={inputClass}><option value="priority">Urgency, then SLA deadline</option><option value="oldest">Oldest request first</option></select></label>
      </div>
      <p className="px-4 pb-3 text-sm text-ink-soft" role="status">{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()} · ${visible.length} shown of ${active.length} loaded actionable records.` : waiting ? 'Loading queue…' : 'No successful refresh yet.'} {expanded.current ? 'Automatic refresh is paused on additional pages. Refresh queue returns to the first page.' : 'Checks for updates every 15 seconds while this tab is visible.'}</p>
      {busyId && <p role="status" className="px-4 pb-3 text-sm">Confirming the selected case action…</p>}
      {error && <div className="px-4 pb-3"><Notice>{error}</Notice></div>}
      {waiting ? <Loading/> : visible.length === 0 ? <Empty>{error ? 'Queue data is unavailable. Use Refresh queue to retry.' : search ? 'No loaded records match your search. Clear the search or load more records.' : scope === 'offered' ? 'No actionable offers match the selected urgency.' : 'No active cases match the selected urgency.'}</Empty> : <ul className="grid gap-3 p-4 lg:grid-cols-2">{visible.map(e => <li key={e.consultation.id}><QueueCard entry={e} scope={scope} now={now} busy={disabled || Boolean(error)} onAccept={id => void mutate(id)} onDecline={(id, reason) => void mutate(id, reason)}/></li>)}</ul>}
      {next && <div className="p-4"><Button variant="quiet" disabled={disabled || Boolean(error)} onClick={() => void load(next)}>Load more records</Button></div>}
    </section>
  </div>;
}
