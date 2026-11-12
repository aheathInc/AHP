import { Router } from "express";
import { createAuthGuards, createTokenService } from "@a-health/http";
import { env } from "../config/env.js";
import * as c from "../controllers/families.controller.js";

const tokens = createTokenService({
  secret: env.JWT_SECRET,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth } = createAuthGuards(tokens);

export const familiesRouter = Router();

familiesRouter.use("/families", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
familiesRouter.get("/families/clinicians", requireAuth, c.roster);
familiesRouter.get("/families/plans", requireAuth, c.plans);
familiesRouter.put("/families/plans/:tier", requireAuth, c.savePlan);
familiesRouter.get("/families/subscription-requests", requireAuth, c.requests);
familiesRouter.post(
  "/families/subscription-requests/:request_id/review",
  requireAuth,
  c.review,
);
familiesRouter.get("/families", requireAuth, c.list);
familiesRouter.post("/families", requireAuth, c.create);
familiesRouter.get("/families/me", requireAuth, c.getMine);
familiesRouter.get("/families/:family_id", requireAuth, c.get);
familiesRouter.post("/families/:family_id/members", requireAuth, c.addMember);
familiesRouter.post(
  "/families/:family_id/members/:member_id/remove",
  requireAuth,
  c.removeMember,
);
familiesRouter.post(
  "/families/:family_id/assignments",
  requireAuth,
  c.assignDoctors,
);
familiesRouter.post(
  "/families/:family_id/subscription-requests",
  requireAuth,
  c.requestPlan,
);
familiesRouter.get(
  "/families/:family_id/subscription-requests",
  requireAuth,
  c.familyRequests,
);
