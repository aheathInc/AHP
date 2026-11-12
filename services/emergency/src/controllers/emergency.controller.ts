import { prisma } from '@a-health/database';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { forbidden, verifyEmergencyDeviceReport, pathParam } from '@a-health/http';
import { env } from '../config/env.js';
import * as emergencies from '../services/emergencyRequest.service.js';
import * as units from '../services/transportUnit.service.js';
import {
  reassessPrioritySchema, createEmergencySchema, dispatchSchema, listEmergenciesQuery, listUnitsQuery,
  setStatusSchema, setUnitStatusSchema, updateLocationSchema,
} from '../types/emergency.types.js';

const caller = (req: Request) => ({ sub: req.auth?.sub, role: req.auth?.role, ppid: req.auth?.ppid });
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.setHeader('Cache-Control','no-store'); res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export async function currentReportIdentity(req:Request,_res:Response,next:NextFunction) {
 try {if(req.auth?.sub){const user=await prisma.user.findUnique({where:{id:req.auth.sub},select:{status:true}});if(!user||user.status!=='active')req.auth=undefined;}next();}catch(error){next(error);}
}
export function checkDeviceAttestation(req: Request, _res: Response, next: NextFunction) {
 if((req.body?.device_alert_id || req.body?.location_source==='device') && !verifyEmergencyDeviceReport(env.JWT_SECRET,req.body,req.header('X-AHP-Device-Report'))){next(forbidden('NOT_RESOURCE_OWNER','A signed device report is required'));return;}
 next();
}
export const create = handle(
  (req) => emergencies.createEmergencyRequest((verifyEmergencyDeviceReport(env.JWT_SECRET,req.body,req.header('X-AHP-Device-Report'))?{deviceAlertId:req.body.device_alert_id as string}:caller(req)), createEmergencySchema.parse(req.body)), 201,
);

export const list = handle((req) =>
  emergencies.listEmergencyRequests(caller(req), listEmergenciesQuery.parse(req.query)));

export const getOne = handle((req) =>
  emergencies.getEmergencyRequest(z.string().uuid().parse(pathParam(req, 'emergency_id')), caller(req)));

export const recover = handle((req) => emergencies.getEmergencyByClientId(z.string().uuid().parse(pathParam(req,'client_id')), caller(req)));

export const dispatch = handle((req, res) =>
  emergencies.dispatchEmergency(z.string().uuid().parse(pathParam(req, 'emergency_id')), caller(req), dispatchSchema.parse(req.body), meta(req, res)));

export const setStatus = handle((req, res) =>
  emergencies.setEmergencyStatus(z.string().uuid().parse(pathParam(req, 'emergency_id')), caller(req), setStatusSchema.parse(req.body), meta(req, res)));

export const reassessPriority=handle((req,res)=>emergencies.reassessEmergencyPriority(z.string().uuid().parse(pathParam(req,'emergency_id')),caller(req),reassessPrioritySchema.parse(req.body),meta(req,res)));

export const listUnits = handle((req) => units.listTransportUnits(listUnitsQuery.parse(req.query)));

export const updateLocation = handle(async (req) => {
  await units.updateTransportLocation(z.string().uuid().parse(pathParam(req, 'unit_id')), updateLocationSchema.parse(req.body));
  return undefined;
}, 204);

export const setUnitStatus = handle((req) => {
  const input = setUnitStatusSchema.parse(req.body);
  return units.setTransportStatus(z.string().uuid().parse(pathParam(req, 'unit_id')), input.status, caller(req), input.base_version);
});
