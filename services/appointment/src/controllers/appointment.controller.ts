import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as appointments from '../services/appointment.service.js';
import {
  cancelAppointmentSchema, createAppointmentSchema, listAppointmentsQuery, rescheduleAppointmentSchema, rescheduleOptionsQuery, appointmentIdSchema,
} from '../types/appointment.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null, requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const create = handle(
  (req, res) => appointments.createAppointment(caller(req), createAppointmentSchema.parse(req.body), meta(req, res)), 201,
);

export const list = handle((req) => appointments.listAppointments(caller(req), listAppointmentsQuery.parse(req.query)));

export const getOne = handle((req) => appointments.getAppointment(pathParam(req, 'appointment_id'), caller(req)));

export const start = handle(
  (req, res) => appointments.startAppointment(pathParam(req, 'appointment_id'), caller(req), meta(req, res)), 201,
);

export const cancel = handle((req, res) => {
  const input = cancelAppointmentSchema.parse(req.body ?? {});
  return appointments.cancelAppointment(pathParam(req, 'appointment_id'), caller(req), input.reason, meta(req, res), input.base_version);
});

export const reschedule = handle((req, res) => appointments.rescheduleAppointment(appointmentIdSchema.parse(pathParam(req, 'appointment_id')), caller(req), rescheduleAppointmentSchema.parse(req.body), meta(req, res)));
export const rescheduleOptions = handle(req => appointments.rescheduleOptions(appointmentIdSchema.parse(pathParam(req, 'appointment_id')), caller(req), rescheduleOptionsQuery.parse(req.query)));

export async function requireRescheduleOwner(req: Request, _res: Response, next: NextFunction) {
  try { await appointments.assertRescheduleOwnership(appointmentIdSchema.parse(pathParam(req, 'appointment_id')), caller(req)); next(); }
  catch (error) { next(error); }
}
