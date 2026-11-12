import { Router } from 'express';
import { createAuthGuards, createIdempotency, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import { requireDispatcher } from '../services/emergencyRequest.service.js';
import * as c from '../controllers/emergency.controller.js';

const tokens = createTokenService({
  secret: env.JWT_SECRET, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});
const { requireAuth, requireRole, optionalAuth } = createAuthGuards(tokens);
const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
const dispatcherOnly = requireRole('dispatcher', 'platform_admin');
const currentDispatcher = (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => { void requireDispatcher({sub:req.auth?.sub,role:req.auth?.role}).then(()=>next(),next); };

export const emergencyRouter = Router();
emergencyRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});

// The one deliberate exception to requiring a session: reporting an
// emergency must never be blocked by an auth problem.
emergencyRouter.post('/emergency-requests', optionalAuth, c.currentReportIdentity, c.checkDeviceAttestation, idempotency, c.create);

emergencyRouter.get('/emergency-requests', requireAuth, c.list);
emergencyRouter.get('/emergency-requests/by-client-id/:client_id', requireAuth, c.recover);
emergencyRouter.get('/emergency-requests/:emergency_id', requireAuth, c.getOne);
emergencyRouter.post('/emergency-requests/:emergency_id/dispatch', requireAuth, dispatcherOnly, currentDispatcher, idempotency, c.dispatch);
emergencyRouter.post('/emergency-requests/:emergency_id/priority', requireAuth, dispatcherOnly, currentDispatcher, idempotency, c.reassessPriority);
emergencyRouter.post('/emergency-requests/:emergency_id/status', requireAuth, dispatcherOnly, currentDispatcher, idempotency, c.setStatus);

emergencyRouter.get('/transport-units', requireAuth, dispatcherOnly, currentDispatcher, c.listUnits);
emergencyRouter.put('/transport-units/:unit_id/location', requireAuth, dispatcherOnly, currentDispatcher, c.updateLocation);
emergencyRouter.post('/transport-units/:unit_id/status', requireAuth, dispatcherOnly, currentDispatcher, c.setUnitStatus);
