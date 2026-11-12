import { prisma } from '@a-health/database';
import { appendAudit, conflict, notFound } from '@a-health/http';

import { requireDispatcher, type Caller } from './emergencyRequest.service.js';

function serialise(u: {
  id: string; callSign: string; capability: string; status: string; version: number;
  lat: number | null; lng: number | null; locationUpdatedAt: Date | null;
}, distanceKm?: number) {
  return {
    id: u.id,
    version: u.version,
    location_is_stale: !u.locationUpdatedAt || Date.now()-u.locationUpdatedAt.getTime()>10*60000 || u.locationUpdatedAt>new Date(),
    call_sign: u.callSign,
    capability: u.capability,
    status: u.status,
    location: u.lat != null && u.lng != null ? { lat: u.lat, lng: u.lng } : null,
    distance_km: distanceKm ?? null,
    location_updated_at: u.locationUpdatedAt?.toISOString() ?? null,
  };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function listTransportUnits(query: {
  status?: string; near_lat?: number; near_lng?: number;
}) {
  const hasLocation=query.near_lat!=null && query.near_lng!=null;
  const ids=hasLocation?await prisma.$queryRaw<{id:string}[]>`SELECT id FROM transport_units
    WHERE (${query.status??null}::text IS NULL OR status::text=${query.status??null}::text)
    ORDER BY CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
      AND location_updated_at >= ((NOW() AT TIME ZONE 'UTC') - INTERVAL '10 minutes')
      AND location_updated_at <= (NOW() AT TIME ZONE 'UTC')
      THEN 6371*acos(LEAST(1::double precision,GREATEST(-1::double precision,
        sin(radians(${query.near_lat!}::double precision))*sin(radians(lat))+
        cos(radians(${query.near_lat!}::double precision))*cos(radians(lat))*cos(radians(lng-${query.near_lng!}::double precision)))))
      ELSE NULL END ASC NULLS LAST, call_sign, id LIMIT 200`:null;
  const rows = await prisma.transportUnit.findMany({
    where: { ...(query.status ? { status: query.status as never } : {}), ...(ids?{id:{in:ids.map(row=>row.id)}}:{}) },
    orderBy:{callSign:'asc'}, take:200,
  });

  const withDistance = rows.map((u) => {
    const distance =
      query.near_lat != null && query.near_lng != null && u.lat != null && u.lng != null && !!u.locationUpdatedAt && u.locationUpdatedAt<=new Date() && Date.now()-u.locationUpdatedAt.getTime()<=10*60000
        ? haversineKm(query.near_lat, query.near_lng, u.lat, u.lng)
        : undefined;
    return { unit: u, distance };
  });

  if (query.near_lat != null && query.near_lng != null) {
    withDistance.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  return { data: withDistance.map(({ unit, distance }) => serialise(unit, distance)) };
}

/**
 * High frequency, low value individually. A live position matters; a month of
 * breadcrumbs does not — this writes the cached position on the unit for fast
 * reads, plus one TransportPing row for the trail, and does not audit-log
 * each call, which at this volume would drown every other entry in the log.
 */
export async function updateTransportLocation(
  unitId: string,
  input: { location: { lat: number; lng: number }; heading_degrees?: number; speed_kph?: number },
) {
  const unit = await prisma.transportUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw notFound('Transport unit not found');

  await prisma.$transaction([
    prisma.transportUnit.update({
      where: { id: unitId },
      data: { lat: input.location.lat, lng: input.location.lng, locationUpdatedAt: new Date() },
    }),
    prisma.transportPing.create({
      data: {
        unitId,
        lat: input.location.lat,
        lng: input.location.lng,
        headingDegrees: input.heading_degrees ?? null,
        speedKph: input.speed_kph ?? null,
      },
    }),
  ]);
}

export async function setTransportStatus(unitId:string,status:string,caller:Caller,baseVersion?:number) {
 return prisma.$transaction(async tx=>{
  await requireDispatcher(caller,tx);
  await tx.$queryRaw`SELECT id FROM transport_units WHERE id=${unitId}::uuid FOR UPDATE`;
  const unit=await tx.transportUnit.findUnique({where:{id:unitId}});
  if(!unit)throw notFound('Transport unit not found');
  if(baseVersion!==undefined && unit.version!==baseVersion)throw conflict('VERSION_CONFLICT','This unit changed. Refresh its status.');
  const active=await tx.emergencyRequest.findFirst({where:{transportUnitId:unitId,status:{in:['dispatched','en_route','arrived']}}});
  if(active)throw conflict('UNIT_HAS_ACTIVE_EMERGENCY','Update the assigned emergency first. An active unit cannot be released or repurposed.');
  if(!['available','out_of_service'].includes(status))throw conflict('STATE_TRANSITION_INVALID','Assign operational movements through the emergency workflow');
  const updated=await tx.transportUnit.update({where:{id:unitId},data:{status:status as never,version:{increment:1}}});
  await appendAudit({actorUserId:caller.sub,action:'emergency.transport_status_changed',entityType:'transport_units',entityId:unitId,metadata:{from:unit.status,to:status}},tx);
  return serialise(updated);
 },{maxWait:10000,timeout:15000});
}
