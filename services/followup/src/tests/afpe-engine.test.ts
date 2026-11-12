import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assess, cadence, escalation, patientReport, type Baseline } from '../afpe/engine.js';
import { baselineSchema, observationSchema } from '../afpe/types.js';
import { validSignature } from '../afpe/signature.js';
import { evaluateRedFlags, requiresUrgentReview } from '../engine/red-flags.js';
const baseline: Baseline = { symptom_severity: 2, medication_required: true, vitals: { temperature_c: 37 }, vital_bounds: { temperature_c: { min: 36, max: 38 } } };
const dose = (status: string) => ({ id: 'synthetic-dose', reportedStatus: status, scheduledAt: new Date('2026-11-12T08:00:00Z'), reportedAt: status === 'unreported' ? null : new Date('2026-11-12T08:05:00Z') });
test('weighted score uses adherence 40%, trajectory 40%, biometrics 20%', () => {
  const result = assess(baseline, { symptom_severity: 7, vitals: { temperature_c: 37 } }, [dose('taken'), dose('missed')], []);
  assert.equal(result.score, 60); assert.equal(result.band, 'yellow');
});
test('unconfirmed doses cannot become missed doses or a reassuring score', () => {
  const result = assess(baseline, { symptom_severity: 2, vitals: { temperature_c: 37 } }, [dose('unreported')], []);
  assert.equal(result.score, null); assert.deepEqual(result.missing, ['medication_adherence']);
});
test('missing vital values do not silently count as normal', () => {
  assert.equal(assess(baseline, { symptom_severity: 2 }, [dose('taken')], []).score, null);
});
test('clinician-confirmed absence of medication permits a complete score', () => {
  assert.equal(assess({ ...baseline, medication_required: false }, { symptom_severity: 2, vitals: { temperature_c: 37 } }, [], []).score, 100);
});
test('urgent red flags override even a perfect composite score', () => {
  const result = assess(baseline, { symptom_severity: 2, vitals: { temperature_c: 37 } }, [dose('taken')], ['red_flag:chest_pain']);
  assert.equal(result.score, 59); assert.equal(result.band, 'red');
});
test('red flags remain urgent when no composite score can be calculated', () => {
  assert.equal(assess(baseline, {}, [], ['red_flag:chest_pain']).band, 'red');
});
test('consecutive subacute declines require two drops strictly above ten points', () => {
  assert.equal(escalation('subacute', 65, [76, 88], []), 'consecutive_score_decline');
  assert.equal(escalation('subacute', 66, [76, 88], []), null);
  assert.equal(escalation('acute', 65, [76, 88], []), null);
});
test('category thresholds preserve exact boundaries', () => {
  assert.equal(escalation('acute', 60, [], []), null);
  assert.equal(escalation('acute', 59, [], []), 'score_below_60');
  assert.equal(escalation('chronic', 69, [], []), 'chronic_score_below_70');
  assert.equal(escalation('chronic', 70, [], []), null);
  assert.equal(escalation('acute', null, [], ['red_flag']), 'red_flag');
});
test('clinical category determines explicit cadence and bounded review period', () => {
  assert.deepEqual(cadence('acute'), { days: 1, duration: 14 });
  assert.deepEqual(cadence('subacute'), { days: 7, duration: 90 });
  assert.deepEqual(cadence('chronic'), { days: 30, duration: 365 });
});
test('structured, nested and bilingual free-text red flags trigger independently of configured criteria', () => {
  assert.deepEqual(evaluateRedFlags({ afpe: { vitals: { temperature_c: 39.1 }, side_effects: 'maumivu ya kifua' } }), ['red_flag:temperature_over_39_c', 'red_flag:chest_pain']);
  assert.deepEqual(evaluateRedFlags({ note: 'difficulty breathing' }), ['red_flag:difficulty_breathing']);
  assert.deepEqual(evaluateRedFlags({ temperature_c: 39 }), []);
  assert.deepEqual(evaluateRedFlags({ temperature_c: NaN }), []);
  assert.equal(requiresUrgentReview(['afpe:red']), true);
});
test('baseline and observations accept partial configured vital sets and reject inverted bounds', () => {
  assert.equal(baselineSchema.safeParse(baseline).success, true);
  assert.equal(baselineSchema.safeParse({ ...baseline, vital_bounds: {} }).success, false);
  assert.equal(baselineSchema.safeParse({ ...baseline, vital_bounds: { temperature_c: { min: 40, max: 37 } } }).success, false);
  assert.equal(observationSchema.safeParse({ symptom_severity: 1, vitals: {} }).success, true);
  assert.equal(observationSchema.safeParse({ symptom_severity: 11 }).success, false);
});
test('webhook signature rejects altered payload, wrong secret, stale timestamp and malformed signature', () => {
  const raw = Buffer.from('{"synthetic":true}'), timestamp = '1794470400', now = Number(timestamp) * 1000, secret = 'synthetic-secret-for-test-only';
  const signature = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest('hex');
  assert.equal(validSignature(secret, timestamp, signature, raw, now), true);
  assert.equal(validSignature(secret, timestamp, signature, Buffer.from('{}'), now), false);
  assert.equal(validSignature('wrong', timestamp, signature, raw, now), false);
  assert.equal(validSignature(secret, timestamp, signature, raw, now + 301000), false);
  assert.equal(validSignature(secret, timestamp, 'bad', raw, now), false);
});
test('patient feedback is available for every assessment band in English and Swahili', () => {
  for (const band of ['red', 'yellow', 'green', 'incomplete']) { assert.ok(patientReport(band).en); assert.ok(patientReport(band).sw); }
});

test('approved ICD rules distinguish clinical context and choose the highest-risk matching category', async () => {
  const { parseAfpeDiagnosisRules, resolveAfpeCategory } = await import('@a-health/config/afpe');
  const approved = { approved_by: 'Synthetic reviewer', approved_at: '2026-11-12T00:00:00Z' };
  const rules = parseAfpeDiagnosisRules(JSON.stringify([
    { ...approved, id: 'synthetic-stable', code_prefix: 'A00', context: 'stable', category: 'chronic' },
    { ...approved, id: 'synthetic-new', code_prefix: 'A00', context: 'new', category: 'subacute' },
    { ...approved, id: 'synthetic-risk', code_prefix: 'B00', context: 'new', category: 'acute' },
  ]));
  assert.equal(resolveAfpeCategory(['A00.1'], 'stable', 'auto', rules).category, 'chronic');
  assert.equal(resolveAfpeCategory(['A00'], 'new', 'auto', rules).category, 'subacute');
  assert.equal(resolveAfpeCategory(['A00', 'B00'], 'new', 'auto', rules).category, 'acute');
  assert.throws(() => resolveAfpeCategory(['C00'], 'new', 'auto', rules));
  assert.throws(() => parseAfpeDiagnosisRules(JSON.stringify([{ id: 'unapproved' }])));
  assert.equal(resolveAfpeCategory(['C00'], undefined, 'subacute', []).category, 'subacute');
});

test('adaptive short-interval check-ins cannot masquerade as consecutive weekly declines', async () => {
  const { weeklyHistory } = await import('../afpe/engine.js');
  const now = new Date('2026-11-22T00:00:00Z');
  assert.deepEqual(weeklyHistory([
    { score: 70, createdAt: new Date('2026-11-20T00:00:00Z') },
    { score: 76, createdAt: new Date('2026-11-15T00:00:00Z') },
    { score: 80, createdAt: new Date('2026-11-12T00:00:00Z') },
    { score: 88, createdAt: new Date('2026-11-08T00:00:00Z') },
  ], now), [76, 88]);
});

test('the existing mobile due query is a supported API input', async () => {
  const { listCheckInsQuery } = await import('../types/followup.types.js');
  assert.equal(listCheckInsQuery.parse({ status: 'due' }).status, 'due');
});

test('category durations enforce the specified acute and subacute windows', async () => {
  const { afpeDuration } = await import('@a-health/config/afpe');
  assert.equal(afpeDuration('acute', 7), 7);
  assert.equal(afpeDuration('subacute', 90), 90);
  assert.throws(() => afpeDuration('acute', 15));
  assert.throws(() => afpeDuration('subacute', 14));
});
