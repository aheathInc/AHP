import { prisma, Prisma } from '@a-health/database';
import { appendAudit, conflict, cursorArgs, forbidden, hashPayload, notFound, toCursorPage, unprocessable } from '@a-health/http';
import { canDispatch, isLegalStatusTransition, type EmergencyStatus } from './transition.js';
import { resolveEmergencyContext } from './consentContext.js';
import { publishEmergencyEvent } from '../events.js';
import { createEmergencySchema } from '../types/emergency.types.js';

export interface Caller { sub?: string; role?: string; ppid?: string; deviceAlertId?: string }
export interface Meta { ip?: string | null; requestId?: string | null }
const ACTIVE = ['reported','triaged','dispatched','en_route','arrived'] as const;
const ASSIGNED = ['dispatched','en_route','arrived'] as const;
type Row = Prisma.EmergencyRequestGetPayload<{}>;
type Priority = 'highest' | 'other';
const priorityValue = (value: Priority) => value === 'highest' ? 2 : 0;
function serialise(e: Row) {
 return {
  id:e.id, scale:e.scale, category:e.category, source:e.source, status:e.status, outcome:e.outcome,
  priority:e.dispatchPriority===2?'highest':e.dispatchPriority===0?'other':'unassessed',
  acknowledged_at:e.acknowledgedAt?.toISOString()??null,
  location:{lat:e.lat,lng:e.lng}, location_source:e.locationSource,
  location_accuracy_m:e.locationAccuracyM, location_captured_at:e.locationCapturedAt?.toISOString()??null,
  landmark:e.landmark, patient_profile_id:e.patientProfileId, estimated_casualties:e.estimatedCasualties,
  description:e.description, transport_unit_id:e.transportUnitId, destination_facility_id:e.destinationFacilityId,
  reported_at:e.reportedAt.toISOString(), dispatched_at:e.dispatchedAt?.toISOString()??null,
  arrived_at:e.arrivedAt?.toISOString()??null, resolved_at:e.resolvedAt?.toISOString()??null, version:e.version,
 };
}
export async function requireDispatcher(caller: Caller, db: Prisma.TransactionClient = prisma) {
 if (!caller.sub || !['dispatcher','platform_admin'].includes(caller.role??'')) throw forbidden('ROLE_NOT_PERMITTED','Dispatcher access required');
 const user=await db.user.findUnique({where:{id:caller.sub},select:{role:true,status:true}});
 if(!user || user.status!=='active' || !['dispatcher','platform_admin'].includes(user.role)) throw forbidden('ROLE_NOT_PERMITTED','An active dispatcher account is required');
}
async function lockEmergency(id: string, tx: Prisma.TransactionClient) {
 await tx.$queryRaw`SELECT id FROM emergency_requests WHERE id = ${id}::uuid FOR UPDATE`;
 const row=await tx.emergencyRequest.findUnique({where:{id}});
 if(!row)throw notFound('Emergency not found');return row;
}
function checkVersion(row: Row, version?: number) {
 if(version!==undefined && version!==row.version)throw conflict('VERSION_CONFLICT','This emergency changed. Refresh before taking another action.');
}

/** An acknowledged retry is database-deduplicated even after a cache/process failure. */
export async function createEmergencyRequest(caller: Caller, raw: unknown) {
 const input=createEmergencySchema.parse(raw);
 const fingerprint=hashPayload(input);
 const result=await prisma.$transaction(async tx=>{
  if(input.client_request_id){
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`emergency-report:${input.client_request_id}`},0))::text`;
   const old=await tx.emergencyRequest.findUnique({where:{clientRequestId:input.client_request_id}});
   if(old){
    if(old.reportedByUserId!==(caller.sub??null) || old.clientPayloadHash!==fingerprint)throw conflict('REQUEST_KEY_CONFLICT','This report key belongs to a different request.');
    return old;
   }
  }
  let patientId=input.patient_profile_id;
  let trustedDeviceSource: 'wearable' | 'vehicle_sensor' | undefined;
  if(input.device_alert_id){
   if(caller.deviceAlertId!==input.device_alert_id)throw forbidden('NOT_RESOURCE_OWNER','A signed device report is required');
   const alert=await tx.deviceAlert.findUnique({where:{id:input.device_alert_id},include:{device:true}});
   if(!alert || alert.device.status!=='active' || alert.device.patientProfileId!==(patientId??null) || alert.lat!==input.location.lat || alert.lng!==input.location.lng)throw forbidden('NOT_RESOURCE_OWNER','Device report does not match its verified alert');
   trustedDeviceSource=alert.device.deviceType==='vehicle_sensor'?'vehicle_sensor':'wearable';
  }
  if(input.location_source==='device' && !trustedDeviceSource)throw forbidden('NOT_RESOURCE_OWNER','A signed device report is required');
  if(patientId && !trustedDeviceSource){
   const patient=await tx.patientProfile.findUnique({where:{id:patientId},select:{userId:true,guardianUserId:true}});
   const staff=!!caller.sub && ['dispatcher','platform_admin'].includes(caller.role??'');
   if(staff)await requireDispatcher(caller,tx);
   if(!patient || (!staff && (!caller.sub || (patient.userId!==caller.sub && patient.guardianUserId!==caller.sub))))throw forbidden('NOT_RESOURCE_OWNER','You cannot link this patient to an emergency.');
  }else if(caller.sub && caller.role==='patient'){
   patientId=(await tx.patientProfile.findUnique({where:{userId:caller.sub},select:{id:true}}))?.id;
  }
  const row=await tx.emergencyRequest.create({data:{
   deviceAlertId:input.device_alert_id,clientRequestId:input.client_request_id,clientPayloadHash:input.client_request_id?fingerprint:null,
   scale:input.scale,category:input.category??'other',source:trustedDeviceSource??(caller.role==='patient'?'patient_app':input.source??(caller.sub?'patient_app':'bystander')),
   status:'reported',lat:input.location.lat,lng:input.location.lng,
   locationSource:input.location_source,locationAccuracyM:input.location_accuracy_m,
   locationCapturedAt:input.location_captured_at?new Date(input.location_captured_at):null,landmark:input.landmark,
   patientProfileId:patientId??null,reportedByUserId:caller.sub??null,reporterPhone:input.reporter_phone,
   estimatedCasualties:input.estimated_casualties,description:input.description,
  }});
  await tx.emergencyEvent.create({data:{emergencyId:row.id,toStatus:'reported',actorUserId:caller.sub??null}});
  await appendAudit({actorUserId:caller.sub??null,action:'emergency.reported',entityType:'emergency_requests',entityId:row.id,metadata:{scale:row.scale,source:row.source}},tx);
  return row;
 },{maxWait:10000,timeout:15000});
 return serialise(result);
}

async function assertVisible(id: string, caller: Caller) {
 if(caller.sub){const viewer=await prisma.user.findUnique({where:{id:caller.sub},select:{status:true}});if(!viewer||viewer.status!=='active')throw forbidden('ROLE_NOT_PERMITTED','An active signed-in account is required to read emergency updates');}
 const e=await prisma.emergencyRequest.findUnique({where:{id},include:{patient:{select:{userId:true,guardianUserId:true}}}});
 if(!e)throw notFound('Emergency not found');
 const privileged=['dispatcher','platform_admin'].includes(caller.role??'');
 if(privileged)await requireDispatcher(caller);
 if(!privileged && (!caller.sub || (e.reportedByUserId!==caller.sub && e.patient?.userId!==caller.sub && e.patient?.guardianUserId!==caller.sub)))throw forbidden('NOT_RESOURCE_OWNER','You cannot view this emergency');
 return e;
}
export async function getEmergencyRequest(id: string, caller: Caller) {
 const e=await assertVisible(id,caller);
 const staff=['dispatcher','platform_admin'].includes(caller.role??'');
 const assigned=ASSIGNED.includes(e.status as typeof ASSIGNED[number]);
 const [events,unit,facility]=await Promise.all([
  prisma.emergencyEvent.findMany({where:{emergencyId:id},orderBy:[{occurredAt:'asc'},{id:'asc'}],select:{fromStatus:true,toStatus:true,occurredAt:true,notes:staff}}),
  e.transportUnitId?prisma.transportUnit.findUnique({where:{id:e.transportUnitId}}):null,
  e.destinationFacilityId?prisma.facility.findUnique({where:{id:e.destinationFacilityId},select:{name:true}}):null,
 ]);
 const fresh=!!unit?.locationUpdatedAt && unit.locationUpdatedAt<=new Date() && Date.now()-unit.locationUpdatedAt.getTime()<=10*60000;
 return {...serialise(e),...(['dispatcher','platform_admin'].includes(caller.role??'')?{reporter_phone:e.reporterPhone}:{}),as_of:new Date().toISOString(),
  timeline:events.filter(event=>staff||event.fromStatus!==event.toStatus).map(event=>({status:event.toStatus,occurred_at:event.occurredAt.toISOString(),...(staff?{notes:event.notes,kind:event.fromStatus===event.toStatus?'priority_assessment':'status'}:{} )})),
  response_unit:unit?{id:unit.id,call_sign:unit.callSign,
   ...(staff||assigned?{status:unit.status,version:unit.version,assignment_active:assigned,
    location:fresh && unit.lat!==null && unit.lng!==null?{lat:unit.lat,lng:unit.lng}:null,
    location_is_stale:!fresh,location_updated_at:unit.locationUpdatedAt?.toISOString()??null}:
    {assignment_active:false,location:null,location_is_stale:true,location_updated_at:null})}:null,
  destination_facility:facility?{id:e.destinationFacilityId,name:facility.name}:null,
 };
}
export async function getEmergencyByClientId(clientId: string, caller: Caller) {
 if(!caller.sub)throw forbidden('NOT_RESOURCE_OWNER','Sign in to recover your report');
 const row=await prisma.emergencyRequest.findUnique({where:{clientRequestId:clientId},select:{id:true,reportedByUserId:true}});
 if(!row || row.reportedByUserId!==caller.sub)throw notFound('Emergency not found');
 return getEmergencyRequest(row.id,caller);
}
export async function listEmergencyRequests(caller: Caller, query: {status?:string;facility_id?:string;cursor?:string;limit:number;scope?:'active'|'closed'|'all'}) {
 await requireDispatcher(caller);
 const rows=await prisma.emergencyRequest.findMany({where:{
  ...(query.scope==='active'?{status:{in:[...ACTIVE]}}:query.scope==='closed'?{status:{notIn:[...ACTIVE]}}:{}),
  ...(query.status?{status:query.status as EmergencyStatus}:{}),
  ...(query.facility_id?{destinationFacilityId:query.facility_id}:{}),
 },orderBy:[{dispatchPriority:'desc'},{scale:'desc'},{reportedAt:'asc'},{id:'asc'}],...cursorArgs(query.cursor,query.limit)});
 return {...toCursorPage(rows,query.limit,serialise),as_of:new Date().toISOString()};
}
export async function dispatchEmergency(id: string, caller: Caller,
 input: {transport_unit_id:string;destination_facility_id:string;notes?:string;base_version?:number;priority?:Priority;break_glass_reason?:string}, meta: Meta) {
 const result=await prisma.$transaction(async tx=>{
  await requireDispatcher(caller,tx);
  const e=await lockEmergency(id,tx);checkVersion(e,input.base_version);
  if(!canDispatch(e.status))throw conflict('STATE_TRANSITION_INVALID',`Cannot dispatch from ${e.status}`);
  if(e.dispatchPriority===1 && !input.priority)throw unprocessable('Assess the response priority before dispatch','priority');
  await tx.$queryRaw`SELECT id FROM transport_units WHERE id = ${input.transport_unit_id}::uuid FOR UPDATE`;
  const unit=await tx.transportUnit.findUnique({where:{id:input.transport_unit_id}});
  if(!unit)throw notFound('Transport unit not found');
  if(unit.status!=='available')throw conflict('STATE_TRANSITION_INVALID','This unit is not available. Refresh the unit list.');
  const active=await tx.emergencyRequest.findFirst({where:{transportUnitId:unit.id,status:{in:[...ASSIGNED]}}});
  if(active)throw conflict('TRANSPORT_UNIT_BUSY','This unit is already assigned to an active incident');
  const facility=await tx.facility.findUnique({where:{id:input.destination_facility_id},select:{isActive:true}});
  if(!facility?.isActive)throw conflict('FACILITY_UNAVAILABLE','Select an active receiving facility');
  const row=await tx.emergencyRequest.update({where:{id},data:{transportUnitId:unit.id,destinationFacilityId:input.destination_facility_id,
   status:'dispatched',dispatchedAt:new Date(),acknowledgedAt:e.acknowledgedAt??new Date(),
   ...(input.priority?{dispatchPriority:priorityValue(input.priority)}:{}),version:{increment:1}}});
  await tx.transportUnit.update({where:{id:unit.id},data:{status:'dispatched',version:{increment:1}}});
  await tx.emergencyEvent.create({data:{emergencyId:id,fromStatus:e.status,toStatus:'dispatched',actorUserId:caller.sub,notes:input.notes}});
  const context=e.patientProfileId?await resolveEmergencyContext(e.patientProfileId,id,caller.sub,{transaction:tx,breakGlassReason:input.break_glass_reason}):null;
  await appendAudit({actorUserId:caller.sub,action:'emergency.dispatched',entityType:'emergency_requests',entityId:id,
   metadata:{transportUnitId:unit.id,destinationFacilityId:input.destination_facility_id},ipAddress:meta.ip,requestId:meta.requestId},tx);
  return {row,context};
 },{maxWait:10000,timeout:15000});
 await publishEmergencyEvent(id,{status:'dispatched'});
 // Access to context is not proof of transmission to a hospital.
 return {...serialise(result.row),context_shared:false,context_available:result.context!==null,break_glass:result.context?.breakGlass??false};
}
export async function setEmergencyStatus(id:string,caller:Caller,input:{status:string;outcome?:string;notes?:string;base_version?:number;priority?:Priority},meta:Meta) {
 const row=await prisma.$transaction(async tx=>{
  await requireDispatcher(caller,tx);
  const e=await lockEmergency(id,tx);checkVersion(e,input.base_version);
  const status=input.status as EmergencyStatus;
  if(!isLegalStatusTransition(e.status,status))throw conflict('STATE_TRANSITION_INVALID',`Cannot move from ${e.status} to ${status}`);
  if(status==='resolved' && !input.outcome)throw unprocessable('An outcome is required to resolve an emergency','outcome');
  if(status==='triaged' && !input.priority)throw unprocessable('Select the response priority after assessment','priority');
  if(e.transportUnitId && (status==='en_route'||status==='arrived')){
   await tx.$queryRaw`SELECT id FROM transport_units WHERE id = ${e.transportUnitId}::uuid FOR UPDATE`;
   await tx.transportUnit.update({where:{id:e.transportUnitId},data:{status:status==='en_route'?'en_route':'at_scene',version:{increment:1}}});
  }
  const updated=await tx.emergencyRequest.update({where:{id},data:{status,
   ...(input.priority?{dispatchPriority:priorityValue(input.priority)}:{}),
   ...(status==='triaged'?{acknowledgedAt:e.acknowledgedAt??new Date()}:{}),
   ...(input.outcome?{outcome:input.outcome as never}:{}),
   ...(status==='arrived'?{arrivedAt:new Date()}:{}),
   ...(['resolved','cancelled'].includes(status)?{resolvedAt:new Date()}:{}),version:{increment:1}}});
  await tx.emergencyEvent.create({data:{emergencyId:id,fromStatus:e.status,toStatus:status,actorUserId:caller.sub,notes:input.notes}});
  await appendAudit({actorUserId:caller.sub,action:'emergency.status_changed',entityType:'emergency_requests',entityId:id,
   metadata:{from:e.status,to:status,outcome:input.outcome??null},ipAddress:meta.ip,requestId:meta.requestId},tx);
  return updated;
 },{maxWait:10000,timeout:15000});
 await publishEmergencyEvent(id,{status:row.status});return serialise(row);
}


export async function reassessEmergencyPriority(id:string,caller:Caller,input:{priority:Priority;base_version:number;notes:string},meta:Meta){
 const row=await prisma.$transaction(async tx=>{
  await requireDispatcher(caller,tx);const e=await lockEmergency(id,tx);checkVersion(e,input.base_version);
  if(!ACTIVE.includes(e.status as typeof ACTIVE[number]))throw conflict('STATE_TRANSITION_INVALID','Closed incidents cannot be reprioritized');
  const updated=await tx.emergencyRequest.update({where:{id},data:{dispatchPriority:priorityValue(input.priority),acknowledgedAt:e.acknowledgedAt??new Date(),...(e.status==='reported'?{status:'triaged'}:{}),version:{increment:1}}});
  await tx.emergencyEvent.create({data:{emergencyId:id,fromStatus:e.status,toStatus:updated.status,actorUserId:caller.sub,notes:input.notes}});
  await appendAudit({actorUserId:caller.sub,action:'emergency.priority_changed',entityType:'emergency_requests',entityId:id,metadata:{from:e.dispatchPriority,to:updated.dispatchPriority},ipAddress:meta.ip,requestId:meta.requestId},tx);
  return updated;
 },{maxWait:10000,timeout:15000});
 await publishEmergencyEvent(id,{status:row.status});return serialise(row);
}
