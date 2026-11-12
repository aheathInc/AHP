import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionableQueue, filterQueue } from '../../lib/queue-workflow.js';
import type { QueueEntry, Urgency } from '../../lib/api.js';
const now = Date.parse('2026-11-12T09:00:00Z');
function entry(id: string, urgency: Urgency, deadline: string, symptom = 'Synthetic symptom'): QueueEntry {
  return { consultation: { id, urgency_level: urgency, sla_deadline_at: deadline, created_at: '2026-11-12T08:00:00Z', symptom_text: symptom, care_thread_id: 'synthetic-thread', patient_profile_id: 'synthetic-profile', assigned_clinician_id: null, channel: 'app', modality: 'chat', consultation_mode: 'remote', facility_id: null, facility_name: null, consultation_fee_amount: null, consultation_fee_currency: 'TZS', consultation_fee_policy: null, status: 'offered' }, offered_at: '2026-11-12T08:59:00Z', offer: { state: 'offered', expires_at: '2026-11-12T09:05:00Z' } };
}
test('expired, missing, invalid and withdrawn offers cannot appear actionable', () => {
  const live = entry('live', 'urgent', '2026-11-12T09:01:00Z');
  const expired = { ...live, consultation: { ...live.consultation, id: 'expired' }, offer: { state: 'offered', expires_at: new Date(now).toISOString() } };
  const withdrawn = { ...live, offer: { state: 'declined', expires_at: live.offer!.expires_at } };
  const invalid = { ...live, offer: { state: 'offered', expires_at: 'invalid' } };
  assert.deepEqual(actionableQueue([live, expired, withdrawn, invalid, { ...live, offer: undefined }], 'offered', now), [live]);
  assert.equal(actionableQueue([{ ...live, offer: undefined }], 'mine', now).length, 1);
});
test('clinical priority precedes routine SLA and equal-priority cases use nearest deadline', () => {
  const routine = entry('routine', 'routine', '2026-11-12T08:00:00Z');
  const urgent = entry('urgent', 'urgent', '2026-11-12T09:01:00Z');
  const emergency = entry('emergency', 'emergency', '2026-11-12T09:02:00Z');
  const earlier = entry('earlier-emergency', 'emergency', '2026-11-12T09:00:00Z');
  const rows = [routine, urgent, emergency, earlier];
  assert.deepEqual(filterQueue(rows, '', 'priority').map(e => e.consultation.id), ['earlier-emergency', 'emergency', 'urgent', 'routine']);
  assert.equal(rows[0], routine);
});
test('search uses only loaded authorized fields and ordering remains deterministic', () => {
  const a = entry('request-a', 'routine', '2026-11-12T09:00:00Z', 'Synthetic HEADACHE');
  const b = entry('request-b', 'routine', '2026-11-12T09:00:00Z', 'Synthetic cough');
  assert.deepEqual(filterQueue([b, a], ' headache ', 'priority'), [a]);
  assert.deepEqual(filterQueue([b, a], 'request-', 'oldest').map(e => e.consultation.id), ['request-a', 'request-b']);
  const older = { ...b, consultation: { ...b.consultation, created_at: '2026-11-12T07:00:00Z' } };
  assert.deepEqual(filterQueue([a, older], 'request-', 'oldest').map(e => e.consultation.id), ['request-b', 'request-a']);
  assert.deepEqual(filterQueue([a], 'unavailable patient name', 'priority'), []);
});
