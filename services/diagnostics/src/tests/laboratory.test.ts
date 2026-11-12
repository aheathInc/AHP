import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import * as investigations from '../services/investigation.service.js';
import * as laboratory from '../services/laboratory.service.js';
import { fileResultSchema } from '../types/diagnostics.types.js';

const target = assertIsolatedLocalTestTarget();
before(() => verifyLocalTestIdentity(prisma, target));
after(() => prisma.$disconnect());
const meta = { ip: '127.0.0.1', requestId: 'lab-integration-test' };
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;
async function user(role: 'lab_technician' | 'clinician' | 'patient' | 'platform_admin') {
  return prisma.user.create({ data: { role, status: 'active', fullName: 'Synthetic laboratory test',
    phoneNumber: `+2557${randomInt(10000000, 99999999)}`, email: `${randomUUID()}@lab-test.local` } });
}
async function fixture() {
  const [admin, tech, doctor, patient] = await Promise.all([user('platform_admin'), user('lab_technician'), user('clinician'), user('patient')]);
  const facility = await prisma.facility.create({ data: { name: 'Synthetic test lab', type: 'laboratory' } });
  const clinician = await prisma.clinicianProfile.create({ data: { userId: doctor.id, licenseNumber: randomUUID(), specialty: 'general_practice', verificationStatus: 'verified' } });
  const profile = await prisma.patientProfile.create({ data: { userId: patient.id, fullName: 'Synthetic lab patient' } });
  const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id, primaryClinicianId: clinician.id } });
  const labCaller = { sub: tech.id, role: tech.role };
  const doctorCaller = { sub: doctor.id, role: doctor.role, cpid: clinician.id };
  const adminCaller = { sub: admin.id, role: admin.role };
  await laboratory.assignMembership(adminCaller, { email: tech.email!, facility_id: facility.id, is_active: true }, meta);
  const order = await investigations.createOrder(doctorCaller, { care_thread_id: thread.id, investigation_code: 'SYNTHETIC-LAB', investigation_type: 'laboratory', facility_id: facility.id, clinical_notes: 'Synthetic order note' }, meta);
  return { admin, tech, patient, facility, thread, order, labCaller, doctorCaller, adminCaller };
}

test('technician sees only laboratory orders directed to an active assigned facility', async () => {
  const f = await fixture();
  const other = await fixture();
  const visible = await investigations.listOrders(f.labCaller, { limit: 100 });
  assert.deepEqual(visible.data.map(row => (row as { id: string }).id), [f.order.id]);
  const detail = await investigations.getOrder(f.order.id, f.labCaller);
  assert.equal(detail.patient_name, 'Synthetic lab patient');
  assert.equal(detail.clinical_notes, 'Synthetic order note');
  await assert.rejects(investigations.getOrder(other.order.id, f.labCaller), code('NOT_RESOURCE_OWNER'));
  for (const input of [
    { investigation_type: 'laboratory' as const },
    { investigation_type: 'imaging' as const, facility_id: f.facility.id },
  ]) {
    const hidden = await investigations.createOrder(f.doctorCaller, { care_thread_id: f.thread.id, investigation_code: 'OUTSIDE-LAB', ...input }, meta);
    await assert.rejects(investigations.getOrder(hidden.id, f.labCaller), code('NOT_RESOURCE_OWNER'));
  }
  assert.equal((await investigations.listOrders(f.labCaller, { limit: 100 })).data.length, 1);
});

test('membership can only be administered by platform admin and revocation removes live access', async () => {
  const f = await fixture();
  const input = { email: f.tech.email!, facility_id: f.facility.id, is_active: false };
  await assert.rejects(laboratory.assignMembership(f.labCaller, input, meta), code('ROLE_NOT_PERMITTED'));
  await assert.rejects(laboratory.memberships(f.labCaller, f.facility.id), code('ROLE_NOT_PERMITTED'));
  await assert.rejects(laboratory.assignMembership(f.adminCaller, { ...input, email: f.patient.email!, is_active: true }, meta), code('NOT_FOUND'));
  const received = await investigations.collectSample(f.order.id, f.labCaller, f.order.version, meta);
  await laboratory.assignMembership(f.adminCaller, input, meta);
  assert.equal((await laboratory.laboratoryFacilities(f.labCaller)).data.length, 0);
  assert.equal((await investigations.listOrders(f.labCaller, { limit: 100 })).data.length, 0);
  await assert.rejects(investigations.getOrder(f.order.id, f.labCaller), code('NOT_RESOURCE_OWNER'));
  await assert.rejects(investigations.fileResult(f.order.id, f.labCaller, { base_version: received.version, values: [{ analyte: 'Synthetic', value: '5' }] }, meta), code('NOT_RESOURCE_OWNER'));
  assert.equal(await prisma.auditLog.count({ where: { action: 'laboratory.access_revoked', actorUserId: f.admin.id } }), 1);
});

test('inactive laboratory or technician removes access even with an existing membership', async () => {
  const f = await fixture();
  await prisma.facility.update({ where: { id: f.facility.id }, data: { isActive: false } });
  assert.equal((await investigations.listOrders(f.labCaller, { limit: 100 })).data.length, 0);
  await assert.rejects(investigations.collectSample(f.order.id, f.labCaller, f.order.version, meta), code('STATE_TRANSITION_INVALID'));
  await prisma.facility.update({ where: { id: f.facility.id }, data: { isActive: true } });
  await prisma.user.update({ where: { id: f.tech.id }, data: { status: 'suspended' } });
  await assert.rejects(investigations.getOrder(f.order.id, f.labCaller), code('NOT_RESOURCE_OWNER'));
});

test('receipt, concurrent result filing, patient visibility and clinician acknowledgement close the loop', async () => {
  const f = await fixture();
  const input = { values: [{ analyte: 'Synthetic analyte', value: '9', reference_low: 1, reference_high: 5, critical_high: 8 }] };
  await assert.rejects(investigations.fileResult(f.order.id, f.labCaller, { ...input, base_version: f.order.version }, meta), code('STATE_TRANSITION_INVALID'));
  const received = await investigations.collectSample(f.order.id, f.labCaller, f.order.version, meta);
  assert.equal(received.status, 'collected');
  await assert.rejects(investigations.collectSample(f.order.id, f.labCaller, f.order.version, meta), code('STATE_TRANSITION_INVALID'));
  await assert.rejects(investigations.fileResult(f.order.id, f.labCaller, { ...input, base_version: f.order.version }, meta), code('STATE_TRANSITION_INVALID'));
  const results = await Promise.allSettled([1, 2].map(() => investigations.fileResult(f.order.id, f.labCaller, { ...input, base_version: received.version }, meta)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(await prisma.investigationValue.count({ where: { orderId: f.order.id } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { entityId: f.order.id, action: 'investigation.critical_result_filed' } }), 1);
  const result = await investigations.getOrder(f.order.id, f.doctorCaller);
  assert.equal(result.is_critical, true);
  assert.equal(result.values[0]?.flag, 'critical_high');
  const patientView = await investigations.getOrder(f.order.id, { sub: f.patient.id, role: 'patient' });
  assert.equal(patientView.values.length, 1);
  assert.equal(Object.hasOwn(patientView, 'clinical_notes'), false);
  await assert.rejects(investigations.acknowledgeResult(f.order.id, f.labCaller, meta), code('ROLE_NOT_PERMITTED'));
  await assert.rejects(investigations.acknowledgeResult(f.order.id, { ...f.doctorCaller, cpid: randomUUID() }, meta), code('NOT_RESOURCE_OWNER'));
  assert.equal((await investigations.acknowledgeResult(f.order.id, f.doctorCaller, meta)).status, 'acknowledged');
});

test('result validation rejects reversed ranges and empty reports', () => {
  assert.equal(fileResultSchema.safeParse({ values: [] }).success, false);
  assert.equal(fileResultSchema.safeParse({ values: [{ analyte: '   ', value: '1' }] }).success, false);
  assert.equal(fileResultSchema.safeParse({ values: [{ analyte: 'A', value: '   ' }] }).success, false);
  assert.equal(fileResultSchema.safeParse({ values: [{ analyte: 'A', value: '1', reference_low: 5, reference_high: 2 }] }).success, false);
  assert.equal(fileResultSchema.safeParse({ values: [{ analyte: 'A', value: '1', critical_low: 8, critical_high: 2 }] }).success, false);
});


test('preliminary findings stay private until a versioned, authorized release', async()=>{
 const f=await fixture(),other=await fixture();
 const receipt=await investigations.collectSample(f.order.id,f.labCaller,f.order.version,meta,{specimen_reference:'SYN-SPECIMEN-1',specimen_type:'Synthetic sample',collected_at:new Date(Date.now()-60000).toISOString()});
 assert.equal(receipt.specimen_reference,'SYN-SPECIMEN-1');assert.ok(receipt.received_at);assert.ok(receipt.collected_at);
 let prepared=await investigations.fileResult(f.order.id,f.labCaller,{base_version:receipt.version,save_as_draft:true,values:[{analyte:'Synthetic analyte',value:'9',reference_low:1,reference_high:5,critical_high:8}],narrative:'Synthetic preliminary comment'},meta);
 const oldVersion=prepared.version;
 prepared=await investigations.fileResult(f.order.id,f.labCaller,{base_version:prepared.version,save_as_draft:true,values:[{analyte:'Synthetic analyte',value:'10',reference_low:1,reference_high:5,critical_high:8}]},meta);
 const revision=await prisma.investigationReportRevision.findUniqueOrThrow({where:{orderId_version:{orderId:f.order.id,version:oldVersion}}});
 assert.equal((revision.snapshot as {values:{value:string}[]}).values[0]?.value,'9');
 assert.equal(prepared.values[0]?.value,'10');
 assert.equal(prepared.report_state,'preliminary');assert.equal(prepared.resulted_at,null);assert.equal(prepared.values[0]?.critical_high,8);
 const patient={sub:f.patient.id,role:'patient'};
 const hidden=await investigations.getOrder(f.order.id,patient);assert.equal(hidden.values.length,0);assert.equal(hidden.narrative,null);assert.equal(hidden.is_critical,false);
 await assert.rejects(()=>investigations.acknowledgeResult(f.order.id,f.doctorCaller,meta),code('STATE_TRANSITION_INVALID'));
 await assert.rejects(()=>investigations.releaseReport(f.order.id,other.labCaller,prepared.version,meta));
 await assert.rejects(()=>investigations.releaseReport(f.order.id,f.labCaller,receipt.version,meta));
 const releases=await Promise.allSettled([1,2].map(()=>investigations.releaseReport(f.order.id,f.labCaller,prepared.version,meta)));
 assert.equal(releases.filter(v=>v.status==='fulfilled').length,1);
 const final=await investigations.getOrder(f.order.id,patient);assert.equal(final.report_state,'final');assert.equal(final.values.length,1);assert.equal(final.released_by_id,f.tech.id);assert.ok(final.resulted_at);assert.equal(final.is_critical,true);
 assert.equal((await investigations.listOrders(f.doctorCaller,{limit:25,worklist:'critical'})).data.length,1);
 await assert.rejects(()=>investigations.acknowledgeResult(f.order.id,f.doctorCaller,meta,prepared.version),code('VERSION_CONFLICT'));
 await investigations.acknowledgeResult(f.order.id,f.doctorCaller,meta,final.version);
 assert.equal((await investigations.listOrders(f.doctorCaller,{limit:25,worklist:'critical'})).data.length,0);
 assert.equal((await investigations.listOrders(f.doctorCaller,{limit:25,worklist:'awaiting_sample'})).data.length,0);
 await assert.rejects(()=>investigations.fileResult(f.order.id,f.labCaller,{base_version:final.version,values:[{analyte:'Replaced',value:'0'}]},meta));
});

test('unrelated clinicians cannot order on a patient case and unbounded results are not labelled normal',async()=>{
 const f=await fixture(),other=await fixture();
 await assert.rejects(()=>investigations.createOrder(other.doctorCaller,{care_thread_id:f.thread.id,investigation_code:'UNAUTHORIZED',investigation_type:'laboratory'},meta),code('NOT_RESOURCE_OWNER'));
 const received=await investigations.collectSample(f.order.id,f.labCaller,f.order.version,meta);
 const report=await investigations.fileResult(f.order.id,f.labCaller,{base_version:received.version,values:[{analyte:'Qualitative',value:'Reactive'},{analyte:'Unbounded',value:'42'}]},meta);
 assert.equal(report.values[0]?.flag,'not_assessed');assert.equal(report.values[1]?.flag,'not_assessed');
 assert.equal((await investigations.listOrders(f.labCaller,{limit:25,q:'SYNTHETIC-LAB'})).data.length,1);
 assert.equal((await investigations.listOrders(f.labCaller,{limit:25,q:'No such patient or test'})).data.length,0);
});

test('a failed correction audit preserves the existing preliminary findings and history atomically',async()=>{
 const f=await fixture();const received=await investigations.collectSample(f.order.id,f.labCaller,f.order.version,meta);
 const prepared=await investigations.fileResult(f.order.id,f.labCaller,{base_version:received.version,save_as_draft:true,values:[{analyte:'Original synthetic result',value:'7'}]},meta);
 await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_dx_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'investigation.preliminary_corrected' THEN RAISE EXCEPTION 'synthetic correction audit failure'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_dx_correction_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_dx_correction_audit()`);
 try{
  await assert.rejects(()=>investigations.fileResult(f.order.id,f.labCaller,{base_version:prepared.version,save_as_draft:true,values:[{analyte:'Replacement synthetic result',value:'99'}]},meta));
  const still=await investigations.getOrder(f.order.id,f.labCaller);assert.equal(still.version,prepared.version);assert.equal(still.values[0]?.value,'7');assert.equal(still.values[0]?.analyte,'Original synthetic result');
  assert.equal(await prisma.investigationReportRevision.count({where:{orderId:f.order.id}}),0);
 }finally{await prisma.$executeRawUnsafe('DROP TRIGGER reject_dx_correction_audit ON audit_logs');await prisma.$executeRawUnsafe('DROP FUNCTION reject_dx_correction_audit()');}
});
