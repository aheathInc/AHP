import type { NextFunction, Request, Response } from "express";
import { pathParam } from "@a-health/http";
import { z } from "zod";
import * as f from "../services/family.service.js";
import * as t from "../types/families.types.js";
const caller = (req: Request) => ({
  sub: req.auth!.sub,
  role: req.auth!.role,
  ppid: req.auth!.ppid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  requestId: (res.locals.requestId as string) ?? null,
});
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req, res));
    } catch (e) {
      next(e);
    }
  };
export const create = handle(
  (q, r) =>
    f.createFamily(caller(q), t.createFamilySchema.parse(q.body), meta(q, r)),
  201,
);
export const getMine = handle((q) => f.getMyFamily(caller(q)));
export const list = handle((q) =>
  f.listFamilies(caller(q), t.listFamiliesSchema.parse(q.query)),
);
export const get = handle((q) =>
  f.getFamily(pathParam(q, "family_id"), caller(q)),
);
export const addMember = handle(
  (q, r) =>
    f.addFamilyMember(
      pathParam(q, "family_id"),
      caller(q),
      t.addMemberSchema.parse(q.body),
      meta(q, r),
    ),
  201,
);
export const removeMember = handle((q, r) =>
  f.removeFamilyMember(
    pathParam(q, "family_id"),
    pathParam(q, "member_id"),
    caller(q),
    z
      .object({ base_version: z.number().int().positive() })
      .strict()
      .parse(q.body).base_version,
    meta(q, r),
  ),
);
export const assignDoctors = handle((q, r) =>
  f.assignFamilyDoctors(
    pathParam(q, "family_id"),
    caller(q),
    t.assignDoctorsSchema.parse(q.body),
    meta(q, r),
  ),
);
export const plans = handle((q) => f.listPlans(caller(q)));
export const savePlan = handle((q, r) =>
  f.updatePlan(
    t.tierSchema.parse(pathParam(q, "tier")),
    caller(q),
    t.planSchema.parse(q.body),
    meta(q, r),
  ),
);
export const requestPlan = handle(
  (q, r) =>
    f.requestPackage(
      pathParam(q, "family_id"),
      caller(q),
      t.requestPlanSchema.parse(q.body),
      meta(q, r),
    ),
  201,
);
export const requests = handle((q) =>
  f.listPackageRequests(caller(q), t.requestListSchema.parse(q.query)),
);
export const familyRequests = handle((q) =>
  f.listPackageRequests(
    caller(q),
    t.requestListSchema.parse(q.query),
    pathParam(q, "family_id"),
  ),
);
export const review = handle((q, r) =>
  f.reviewPackage(
    pathParam(q, "request_id"),
    caller(q),
    t.reviewPlanSchema.parse(q.body),
    meta(q, r),
  ),
);
export const roster = handle((q) =>
  f.listFamilyClinicians(caller(q), t.listFamiliesSchema.parse(q.query)),
);
