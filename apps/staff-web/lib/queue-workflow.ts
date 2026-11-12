import type { QueueEntry } from './api';
const priority = { emergency: 0, urgent: 1, routine: 2 };
export function actionableQueue(entries: QueueEntry[], scope: 'offered' | 'mine', now: number) {
  return entries.filter(e => scope === 'mine' || (e.offer?.state === 'offered' && Date.parse(e.offer.expires_at) > now));
}
export function filterQueue(entries: QueueEntry[], search: string, order: 'priority' | 'oldest') {
  const query = search.trim().toLowerCase();
  return entries.filter(e => [e.consultation.id, e.consultation.symptom_text, e.consultation.facility_name, e.consultation.modality].some(v => v?.toLowerCase().includes(query)))
    .sort((a, b) => (order === 'priority' ? priority[a.consultation.urgency_level] - priority[b.consultation.urgency_level] || Date.parse(a.consultation.sla_deadline_at) - Date.parse(b.consultation.sla_deadline_at) : Date.parse(a.consultation.created_at) - Date.parse(b.consultation.created_at)) || a.consultation.id.localeCompare(b.consultation.id));
}
