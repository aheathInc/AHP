import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import type { AppError } from '@a-health/http';
import { bus } from '../events.js';
import * as emergencies from '../services/emergencyRequest.service.js';
import * as units from '../services/transportUnit.service.js';
import { isLegalStatusTransition, canDispatch } from '../services/transition.js';

const testTarget = assertIsolatedLocalTestTarget(process.env);

const meta = { ip: '127.0.0.1', requestId: 'test' };
const dispatcher = { sub: randomUUID(), role: 'dispatcher' };
const users: string[] = [];
const emergencyIds: string[] = [];
const unitIds: string[] = [];
const facilityIds: string[] = [];
const deviceIds:string[]=[];

before(async () => { await verifyLocalTestIdentity(prisma, testTarget); await prisma.user.create({data:{id:dispatcher.sub,phoneNumber:`+2557${randomInt(10000000,99999999)}`,role:'dispatcher',status:'active'}});users.push(dispatcher.sub); });

after(async () => {
  for (const id of emergencyIds) {
    await prisma.emergencyEvent.deleteMany({ where: { emergencyId: id } }).catch(() => undefined);
    await prisma.emergencyRequest.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of unitIds) {
    await prisma.transportPing.deleteMany({ where: { unitId: id } }).catch(() => undefined);
    await prisma.transportUnit.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of facilityIds) {
    await prisma.facility.delete({ where: { id } }).catch(() => undefined);
  }
  if(deviceIds.length)await prisma.device.deleteMany({where:{id:{in:deviceIds}}});
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
  await bus.close();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Emergency Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Emergency Test' } });
  return { user, profile };
}

async function makeUnit(status = 'available') {
  const unit = await prisma.transportUnit.create({
    data: { callSign: `T-${randomInt(1000, 9999)}`, capability: 'basic', status: status as never, lat: -6.8, lng: 39.28, locationUpdatedAt:new Date() },
  });
  unitIds.push(unit.id);
  return unit;
}

async function makeFacility() {
  const facility = await prisma.facility.create({
    data: { name: 'Test Facility', type: 'hospital', lat: -6.79, lng: 39.27 },
  });
  facilityIds.push(facility.id);
  return facility;
}

describe('transition rules', () => {
  it('never allows entering dispatched via the status endpoint', () => {
    assert.equal(isLegalStatusTransition('reported', 'dispatched'), false);
    assert.equal(isLegalStatusTransition('triaged', 'dispatched'), false);
  });

  it('allows dispatch action only from reported or triaged', () => {
    assert.equal(canDispatch('reported'), true);
    assert.equal(canDispatch('triaged'), true);
    assert.equal(canDispatch('dispatched'), false);
    assert.equal(canDispatch('resolved'), false);
  });

  it('allows cancellation from any active state', () => {
    for (const s of ['reported', 'triaged', 'dispatched', 'en_route', 'arrived'] as const) {
      assert.equal(isLegalStatusTransition(s, 'cancelled'), true);
    }
  });
});

describe('reporting', () => {
  it('accepts a report with no authenticated caller', async () => {
    const result = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, source: 'bystander' },
    );
    emergencyIds.push(result.id);
    assert.equal(result.status, 'reported');
    assert.equal(result.source, 'bystander');
  });

  it('defaults source to patient_app for an authenticated caller', async () => {
    const { user } = await makePatient();
    const result = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' }, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(result.id);
    assert.equal(result.source, 'patient_app');
  });
});

describe('visibility', () => {
  it('lets the reporter see their own report', async () => {
    const { user } = await makePatient();
    const created = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' }, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const fetched = await emergencies.getEmergencyRequest(created.id, { sub: user.id, role: 'patient' });
    assert.equal(fetched.id, created.id);
  });

  it('refuses a stranger', async () => {
    const { user: stranger } = await makePatient();
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    await assert.rejects(
      () => emergencies.getEmergencyRequest(created.id, { sub: stranger.id, role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('refuses list to a non-dispatcher', async () => {
    await assert.rejects(
      () => emergencies.listEmergencyRequests({ sub: randomUUID(), role: 'patient' }, { limit: 10 }),
      (e: AppError) => e.code === 'ROLE_NOT_PERMITTED',
    );
  });
});

describe('dispatch', () => {
  it('dispatches to an available unit and facility', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();

    const result = await emergencies.dispatchEmergency(
      created.id, dispatcher, { priority: 'highest', transport_unit_id: unit.id, destination_facility_id: facility.id }, meta,
    );
    assert.equal(result.status, 'dispatched');

    const reloadedUnit = await prisma.transportUnit.findUniqueOrThrow({ where: { id: unit.id } });
    assert.equal(reloadedUnit.status, 'dispatched');
  });

  it('refuses to dispatch an out-of-service unit', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('out_of_service');
    const facility = await makeFacility();

    await assert.rejects(
      () => emergencies.dispatchEmergency(created.id, dispatcher, { priority: 'highest', transport_unit_id: unit.id, destination_facility_id: facility.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('refuses to dispatch an already-dispatched emergency', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { priority: 'highest', transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);

    const unit2 = await makeUnit('available');
    await assert.rejects(
      () => emergencies.dispatchEmergency(created.id, dispatcher, { priority: 'highest', transport_unit_id: unit2.id, destination_facility_id: facility.id }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });

  it('writes a break-glass audit entry when the patient has no standing consent', async () => {
    const { user, profile } = await makePatient();
    const created = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' },
      { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, patient_profile_id: profile.id },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();

    const result = await emergencies.dispatchEmergency(
      created.id, dispatcher, { priority: 'highest', transport_unit_id: unit.id, destination_facility_id: facility.id,break_glass_reason:'Emergency minimum access justified by synthetic dispatcher assessment' }, meta,
    );
    assert.equal(result.break_glass, true);

    const entries = await prisma.auditLog.count({
      where: { action: 'emergency.context_break_glass_access', entityId: profile.id },
    });
    assert.equal(entries, 1);
    const event = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'emergency.context_break_glass_access', entityId: profile.id },
    });
    assert.equal(event.actorUserId, dispatcher.sub);
    assert.deepEqual(event.metadata, { emergencyRequestId: created.id });
    assert.equal('allergies' in (event.metadata as object), false);
  });

  it('uses active emergency consent and switches to audited break-glass after revocation', async () => {
    const { user, profile } = await makePatient();
    const consent = await prisma.patientConsent.create({
      data: {
        patientProfileId: profile.id,
        granteeType: 'emergency_responder',
        scope: 'emergency_minimum',
        reason: 'Synthetic consent lifecycle test',
      },
    });

    const activeRequest = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' },
      { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, patient_profile_id: profile.id },
    );
    emergencyIds.push(activeRequest.id);
    const activeUnit = await makeUnit('available');
    const activeFacility = await makeFacility();
    const activeDispatch = await emergencies.dispatchEmergency(
      activeRequest.id, dispatcher,
      { priority: 'highest', transport_unit_id: activeUnit.id, destination_facility_id: activeFacility.id }, meta,
    );
    assert.equal(activeDispatch.break_glass, false);

    await prisma.patientConsent.update({
      where: { id: consent.id },
      data: { allowed: false, revokedAt: new Date() },
    });
    const revokedRequest = await emergencies.createEmergencyRequest(
      { sub: user.id, role: 'patient' },
      { scale: 'individual', location: { lat: -6.8, lng: 39.28 }, patient_profile_id: profile.id },
    );
    emergencyIds.push(revokedRequest.id);
    const revokedUnit = await makeUnit('available');
    const revokedFacility = await makeFacility();
    const revokedDispatch = await emergencies.dispatchEmergency(
      revokedRequest.id, dispatcher,
      { priority: 'highest', transport_unit_id: revokedUnit.id, destination_facility_id: revokedFacility.id, break_glass_reason:'Synthetic emergency assessment requires minimum context access' }, meta,
    );
    assert.equal(revokedDispatch.break_glass, true);

    const entries = await prisma.auditLog.count({
      where: { action: 'emergency.context_break_glass_access', entityId: profile.id },
    });
    assert.equal(entries, 1);
  });
});

describe('status transitions', () => {
  it('walks a full lifecycle to resolved', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { priority: 'highest', transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);

    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'en_route' }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' }, meta);
    const resolved = await emergencies.setEmergencyStatus(
      created.id, dispatcher, { status: 'resolved', outcome: 'transported' }, meta,
    );
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.outcome, 'transported');
  });

  it('refuses to resolve without an outcome', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    const unit = await makeUnit('available');
    const facility = await makeFacility();
    await emergencies.dispatchEmergency(created.id, dispatcher, { priority: 'highest', transport_unit_id: unit.id, destination_facility_id: facility.id }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'en_route' }, meta);
    await emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' }, meta);

    await assert.rejects(
      () => emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'resolved' }, meta),
      (e: AppError) => e.code === 'VALIDATION_FAILED',
    );
  });

  it('refuses an illegal jump from reported to arrived', async () => {
    const created = await emergencies.createEmergencyRequest(
      {}, { scale: 'individual', location: { lat: -6.8, lng: 39.28 } },
    );
    emergencyIds.push(created.id);
    await assert.rejects(
      () => emergencies.setEmergencyStatus(created.id, dispatcher, { status: 'arrived' as never }, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('transport units', () => {
  it('orders results by distance when a location is given', async () => {
    const near = await makeUnit('available');
    await prisma.transportUnit.update({ where: { id: near.id }, data: { lat: -6.80, lng: 39.28 } });
    const far = await makeUnit('available');
    await prisma.transportUnit.update({ where: { id: far.id }, data: { lat: -7.50, lng: 39.90 } });

    const result = await units.listTransportUnits({ status: 'available', near_lat: -6.80, near_lng: 39.28 });
    const ids = result.data.map((u) => u.id);
    assert.ok(ids.indexOf(near.id) < ids.indexOf(far.id));
  });

  it('records a ping and updates the cached position on a location update', async () => {
    const unit = await makeUnit('en_route');
    await units.updateTransportLocation(unit.id, { location: { lat: -6.81, lng: 39.29 } });

    const reloaded = await prisma.transportUnit.findUniqueOrThrow({ where: { id: unit.id } });
    assert.equal(reloaded.lat, -6.81);

    const pings = await prisma.transportPing.count({ where: { unitId: unit.id } });
    assert.equal(pings, 1);
  });

  it('sets a unit status', async () => {
    const unit = await makeUnit('available');
    const updated = await units.setTransportStatus(unit.id, 'out_of_service', dispatcher);
    assert.equal(updated.status, 'out_of_service');
  });
});


describe('reliability and emergency privacy', () => {
 it('rejects out-of-range, non-finite and fake zero coordinates',async()=>{
  for(const location of [{lat:0,lng:0},{lat:91,lng:20},{lat:-6,lng:181},{lat:NaN,lng:39},{lat:-6,lng:Infinity}]){
   await assert.rejects(()=>emergencies.createEmergencyRequest({}, {scale:'individual',location}));
  }
 });
 it('deduplicates concurrent retries in the database and rejects a changed payload',async()=>{
  const {user}=await makePatient();const caller={sub:user.id,role:'patient'};
  const input={client_request_id:randomUUID(),scale:'individual',location:{lat:-6.8,lng:39.28},landmark:'Synthetic gate'};
  const results=await Promise.all([emergencies.createEmergencyRequest(caller,input),emergencies.createEmergencyRequest(caller,input)]);
  emergencyIds.push(results[0]!.id);assert.equal(results[0]!.id,results[1]!.id);
  assert.equal(await prisma.auditLog.count({where:{entityId:results[0]!.id,action:'emergency.reported'}}),1);
  await assert.rejects(()=>emergencies.createEmergencyRequest(caller,{...input,landmark:'Different gate'}),(e:AppError)=>e.code==='REQUEST_KEY_CONFLICT');
  const recovered=await emergencies.getEmergencyByClientId(input.client_request_id,caller);assert.equal(recovered.id,results[0]!.id);
  const stranger=await makePatient();await assert.rejects(()=>emergencies.getEmergencyByClientId(input.client_request_id,{sub:stranger.user.id,role:'patient'}),(e:AppError)=>e.statusCode===404);
 });
 it('does not allow an anonymous reporter or unrelated patient to link another patient',async()=>{
  const a=await makePatient(),b=await makePatient();
  for(const caller of [{},{sub:a.user.id,role:'patient'}])await assert.rejects(()=>emergencies.createEmergencyRequest(caller,{scale:'individual',location:{lat:-6.8,lng:39.28},patient_profile_id:b.profile.id}),(e:AppError)=>e.code==='NOT_RESOURCE_OWNER');
 });
 it('serializes two different incidents claiming the same available unit',async()=>{
  const a=await emergencies.createEmergencyRequest({}, {scale:'individual',location:{lat:-6.8,lng:39.28}}),b=await emergencies.createEmergencyRequest({}, {scale:'individual',location:{lat:-6.8,lng:39.28}});emergencyIds.push(a.id,b.id);
  const unit=await makeUnit(),facility=await makeFacility();
  const results=await Promise.allSettled([a,b].map(row=>emergencies.dispatchEmergency(row.id,dispatcher,{priority:'highest',base_version:row.version,transport_unit_id:unit.id,destination_facility_id:facility.id},meta)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(await prisma.emergencyRequest.count({where:{transportUnitId:unit.id,status:'dispatched'}}),1);
  await assert.rejects(()=>units.setTransportStatus(unit.id,'available',dispatcher),(e:AppError)=>e.code==='UNIT_HAS_ACTIVE_EMERGENCY');
 });
 it('requires current versions and an explicit human priority; exposes a minimized timeline',async()=>{
  const {user}=await makePatient();const caller={sub:user.id,role:'patient'};
  const e=await emergencies.createEmergencyRequest(caller,{scale:'individual',location:{lat:-6.8,lng:39.28}});emergencyIds.push(e.id);
  await assert.rejects(()=>emergencies.setEmergencyStatus(e.id,dispatcher,{status:'triaged',base_version:e.version},meta));
  const ack=await emergencies.setEmergencyStatus(e.id,dispatcher,{status:'triaged',priority:'highest',base_version:e.version,notes:'Private dispatcher detail'},meta);
  assert.ok(ack.acknowledged_at);assert.equal(ack.priority,'highest');
  await assert.rejects(()=>emergencies.setEmergencyStatus(e.id,dispatcher,{status:'cancelled',base_version:e.version},meta),(error:AppError)=>error.code==='VERSION_CONFLICT');
  const read=await emergencies.getEmergencyRequest(e.id,caller);assert.equal(read.timeline.length,2);assert.equal('notes' in read.timeline[1]!,false);assert.equal('reporter_phone' in read,false);
 });
 it('filters active incidents before pagination and keeps closed high-priority cases out',async()=>{
  const closed=await emergencies.createEmergencyRequest({}, {scale:'individual',location:{lat:-6.8,lng:39.28}});emergencyIds.push(closed.id);
  await emergencies.setEmergencyStatus(closed.id,dispatcher,{status:'triaged',priority:'highest'},meta);
  await emergencies.setEmergencyStatus(closed.id,dispatcher,{status:'cancelled'},meta);
  const active=await emergencies.createEmergencyRequest({}, {scale:'mass_casualty',location:{lat:-6.8,lng:39.28}});emergencyIds.push(active.id);
  const page=await emergencies.listEmergencyRequests(dispatcher,{scope:'active',limit:1});assert.equal(page.data.length,1);assert.ok(!['cancelled','resolved'].includes((page.data[0] as {status:string}).status));
 });
 it('rejects inactive destinations and does not auto-break-glass without justification',async()=>{
  const {user,profile}=await makePatient();const e=await emergencies.createEmergencyRequest({sub:user.id,role:'patient'},{scale:'individual',patient_profile_id:profile.id,location:{lat:-6.8,lng:39.28}});emergencyIds.push(e.id);
  const unit=await makeUnit(),facility=await makeFacility();await prisma.facility.update({where:{id:facility.id},data:{isActive:false}});
  await assert.rejects(()=>emergencies.dispatchEmergency(e.id,dispatcher,{priority:'highest',transport_unit_id:unit.id,destination_facility_id:facility.id},meta),(error:AppError)=>error.code==='FACILITY_UNAVAILABLE');
  await prisma.facility.update({where:{id:facility.id},data:{isActive:true}});
  const dispatched=await emergencies.dispatchEmergency(e.id,dispatcher,{priority:'highest',transport_unit_id:unit.id,destination_facility_id:facility.id},meta);assert.equal(dispatched.break_glass,false);assert.equal(dispatched.context_available,false);assert.equal(dispatched.context_shared,false);
 });
 it('does not advertise stale unit coordinates as a current nearest position',async()=>{
  const unit=await makeUnit();await prisma.transportUnit.update({where:{id:unit.id},data:{locationUpdatedAt:new Date(Date.now()-11*60000)}});
  const list=await units.listTransportUnits({status:'available',near_lat:-6.8,near_lng:39.28});const row=list.data.find(row=>row.id===unit.id)!;assert.equal(row.distance_km,null);assert.equal(row.location_is_stale,true);
 });
 it('rolls report and timeline back when the required audit write fails',async()=>{
  const key=randomUUID();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_emergency_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'emergency.reported' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_emergency_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_emergency_test_audit()`);
  try{await assert.rejects(()=>emergencies.createEmergencyRequest({}, {client_request_id:key,scale:'individual',location:{lat:-6.8,lng:39.28}}));assert.equal(await prisma.emergencyRequest.count({where:{clientRequestId:key}}),0);}
  finally{await prisma.$executeRawUnsafe('DROP TRIGGER reject_emergency_test_audit ON audit_logs');await prisma.$executeRawUnsafe('DROP FUNCTION reject_emergency_test_audit()');}
 });
});


it('an audit failure rolls back dispatch assignment, unit reservation and timeline together',async()=>{
 const e=await emergencies.createEmergencyRequest({}, {scale:'individual',location:{lat:-6.8,lng:39.28}});emergencyIds.push(e.id);
 const unit=await makeUnit(),facility=await makeFacility();
 await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_dispatch_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'emergency.dispatched' THEN RAISE EXCEPTION 'synthetic dispatch audit failure'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_dispatch_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_dispatch_test_audit()`);
 try{
  await assert.rejects(()=>emergencies.dispatchEmergency(e.id,dispatcher,{priority:'highest',transport_unit_id:unit.id,destination_facility_id:facility.id},meta));
  const saved=await prisma.emergencyRequest.findUniqueOrThrow({where:{id:e.id}});assert.equal(saved.status,'reported');assert.equal(saved.version,1);assert.equal(saved.transportUnitId,null);
  assert.equal((await prisma.transportUnit.findUniqueOrThrow({where:{id:unit.id}})).status,'available');
  assert.equal(await prisma.emergencyEvent.count({where:{emergencyId:e.id}}),1);
 }finally{await prisma.$executeRawUnsafe('DROP TRIGGER reject_dispatch_test_audit ON audit_logs');await prisma.$executeRawUnsafe('DROP FUNCTION reject_dispatch_test_audit()');}
});


it('serves JWT-protected recovery and versioned dispatch through real HTTP routes',async()=>{
 const {createService,createTokenService}=await import('@a-health/http');const {emergencyRouter}=await import('../routes/emergency.routes.js');const {env}=await import('../config/env.js');
 const a=await makePatient(),b=await makePatient();const token=createTokenService({secret:env.JWT_SECRET,issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE,ttlSeconds:900});
 const headers=(sub:string,role:string)=>({Authorization:`Bearer ${token.sign({sub,role:role as 'patient',status:'active',jti:randomUUID()})}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()});
 const server=createService({name:'emergency-http-test',port:0,routers:[emergencyRouter],development:false}).app.listen(0,'127.0.0.1');
 await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 try{
  const key=randomUUID(),body={client_request_id:key,scale:'individual',location:{lat:-6.8,lng:39.28},reporter_phone:'+255749900999'};
  const first=await fetch(base+'/emergency-requests',{method:'POST',headers:headers(a.user.id,'patient'),body:JSON.stringify(body)});assert.equal(first.status,201);assert.equal(first.headers.get('cache-control'),'no-store');const e=await first.json() as {id:string;version:number};emergencyIds.push(e.id);
  const again=await fetch(base+'/emergency-requests',{method:'POST',headers:headers(a.user.id,'patient'),body:JSON.stringify(body)});assert.equal(again.status,201);assert.equal((await again.json() as {id:string}).id,e.id);
  assert.equal((await fetch(base+'/emergency-requests/by-client-id/'+key)).status,401);
  assert.equal((await fetch(base+'/emergency-requests/by-client-id/'+key,{headers:headers(b.user.id,'patient')})).status,404);
  assert.equal((await fetch(base+'/emergency-requests/by-client-id/'+key,{headers:headers(a.user.id,'patient')})).status,200);
  const invalid=await fetch(base+'/emergency-requests',{method:'POST',headers:headers(a.user.id,'patient'),body:JSON.stringify({scale:'individual',location:{lat:100,lng:20}})});assert.equal(invalid.status,422);
  const unit=await makeUnit(),facility=await makeFacility();const dispatchBody={base_version:1,priority:'highest',transport_unit_id:unit.id,destination_facility_id:facility.id};
  assert.equal((await fetch(base+`/emergency-requests/${e.id}/dispatch`,{method:'POST',headers:headers(a.user.id,'patient'),body:JSON.stringify(dispatchBody)})).status,403);
  const staffHeaders=headers(dispatcher.sub,'dispatcher');const assigned=await fetch(base+`/emergency-requests/${e.id}/dispatch`,{method:'POST',headers:staffHeaders,body:JSON.stringify(dispatchBody)});assert.equal(assigned.status,200);
  await prisma.user.update({where:{id:dispatcher.sub},data:{status:'suspended'}});
  assert.equal((await fetch(base+`/emergency-requests/${e.id}/dispatch`,{method:'POST',headers:staffHeaders,body:JSON.stringify(dispatchBody)})).status,403);
  await prisma.user.update({where:{id:dispatcher.sub},data:{status:'active'}});
  const read=await fetch(base+`/emergency-requests/${e.id}`,{headers:headers(a.user.id,'patient')});const publicBody=await read.json() as Record<string,unknown>;assert.equal('reporter_phone' in publicBody,false);assert.ok(Array.isArray(publicBody.timeline));
 }finally{await prisma.user.update({where:{id:dispatcher.sub},data:{status:'active'}});await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});


it('a closed incident never exposes a unit location from its next assignment',async()=>{
 const {user}=await makePatient();const caller={sub:user.id,role:'patient'};
 const old=await emergencies.createEmergencyRequest(caller,{scale:'individual',location:{lat:-6.8,lng:39.28}});emergencyIds.push(old.id);
 const unit=await makeUnit(),facility=await makeFacility();
 await emergencies.dispatchEmergency(old.id,dispatcher,{priority:'highest',transport_unit_id:unit.id,destination_facility_id:facility.id},meta);
 await emergencies.setEmergencyStatus(old.id,dispatcher,{status:'en_route'},meta);await emergencies.setEmergencyStatus(old.id,dispatcher,{status:'arrived'},meta);await emergencies.setEmergencyStatus(old.id,dispatcher,{status:'resolved',outcome:'treated_on_scene',notes:'Private clinical handover'},meta);
 await units.setTransportStatus(unit.id,'available',dispatcher);
 const next=await emergencies.createEmergencyRequest({}, {scale:'individual',location:{lat:-6.9,lng:39.3}});emergencyIds.push(next.id);
 await emergencies.dispatchEmergency(next.id,dispatcher,{priority:'highest',transport_unit_id:unit.id,destination_facility_id:facility.id},meta);await units.updateTransportLocation(unit.id,{location:{lat:-6.9,lng:39.3}});
 const publicRead=await emergencies.getEmergencyRequest(old.id,caller);assert.equal(publicRead.response_unit?.location,null);assert.equal(publicRead.response_unit?.location_updated_at,null);assert.equal(publicRead.response_unit?.assignment_active,false);assert.equal('notes' in publicRead.timeline.at(-1)!,false);
 const staffRead=await emergencies.getEmergencyRequest(old.id,dispatcher);assert.equal(staffRead.timeline.at(-1)!.notes,'Private clinical handover');
});


it('accepts attested sensor reports, rejects forged profile links and never assigns human ownership from an attached JWT',async()=>{
 const {createService,createTokenService,signEmergencyDeviceReport}=await import('@a-health/http');const {env}=await import('../config/env.js');const {emergencyRouter}=await import('../routes/emergency.routes.js');
 const a=await makePatient(),b=await makePatient();
 const device=await prisma.device.create({data:{deviceType:'wearable_watch',serialNumber:randomUUID(),patientProfileId:a.profile.id,credentialHash:'synthetic-credential-hash',status:'active'}});deviceIds.push(device.id);
 const alert=await prisma.deviceAlert.create({data:{deviceId:device.id,alertType:'manual_trigger',lat:-6.8,lng:39.28,detectedAt:new Date()}});
 const body={client_request_id:alert.id,device_alert_id:alert.id,location_source:'device',scale:'individual',location:{lat:-6.8,lng:39.28},patient_profile_id:a.profile.id,source:'wearable'};
 const tokens=createTokenService({secret:env.JWT_SECRET,issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE,ttlSeconds:900});
 const stranger=tokens.sign({sub:b.user.id,role:'patient',status:'active',jti:randomUUID()});
 const server=createService({name:'emergency-device-test',port:0,routers:[emergencyRouter],development:false}).app.listen(0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const headers=()=>({'Content-Type':'application/json','Idempotency-Key':randomUUID(),Authorization:`Bearer ${stranger}`});
 try{
  const unsigned=await fetch(base+'/emergency-requests',{method:'POST',headers:headers(),body:JSON.stringify(body)});assert.equal(unsigned.status,403);
  const signature=signEmergencyDeviceReport(env.JWT_SECRET,body);
  const tampered=await fetch(base+'/emergency-requests',{method:'POST',headers:{...headers(),'X-AHP-Device-Report':signature},body:JSON.stringify({...body,location:{lat:-6.9,lng:39.28}})});assert.equal(tampered.status,403);
  const response=await fetch(base+'/emergency-requests',{method:'POST',headers:{...headers(),'X-AHP-Device-Report':signature},body:JSON.stringify(body)});assert.equal(response.status,201);const e=await response.json() as {id:string};emergencyIds.push(e.id);
  const saved=await prisma.emergencyRequest.findUniqueOrThrow({where:{id:e.id}});assert.equal(saved.patientProfileId,a.profile.id);assert.equal(saved.reportedByUserId,null);assert.equal(saved.locationSource,'device');assert.equal(saved.deviceAlertId,alert.id);
  assert.equal((await fetch(base+`/emergency-requests/${e.id}`,{headers:headers()})).status,403);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});


it('allows an active response to be reprioritized with an audited reason and current version',async()=>{
 const {user}=await makePatient();const caller={sub:user.id,role:'patient'};const e=await emergencies.createEmergencyRequest(caller,{scale:'individual',location:{lat:-6.8,lng:39.28}});emergencyIds.push(e.id);
 const ack=await emergencies.setEmergencyStatus(e.id,dispatcher,{status:'triaged',priority:'other'},meta);
 const higher=await emergencies.reassessEmergencyPriority(e.id,dispatcher,{priority:'highest',base_version:ack.version,notes:'Synthetic dispatcher reassessment after operational update'},meta);
 assert.equal(higher.status,'triaged');assert.equal(higher.priority,'highest');assert.equal(higher.version,3);
 await assert.rejects(()=>emergencies.reassessEmergencyPriority(e.id,dispatcher,{priority:'other',base_version:ack.version,notes:'Synthetic stale assessment'},meta),(error:AppError)=>error.code==='VERSION_CONFLICT');
 const publicRead=await emergencies.getEmergencyRequest(e.id,caller);assert.equal(publicRead.timeline.length,2);
 const staff=await emergencies.getEmergencyRequest(e.id,dispatcher);assert.equal(staff.timeline.length,3);assert.equal(staff.timeline.at(-1)!.kind,'priority_assessment');
});
