import { createService } from '@a-health/http';
import { afpeWebhookRouter, rawBodies } from './afpe/webhook.js';
import { env } from './config/env.js';
import { followupRouter } from './routes/followup.routes.js';
import { continuityRouter } from './continuity/routes.js';
import { startCareReminderWorker } from './continuity/reminder.worker.js';
import { startScheduler } from './workers/scheduler.worker.js';

const service = createService({
  name: 'followup',
  port: env.PORT,
  routers: [followupRouter, continuityRouter, afpeWebhookRouter],
  jsonVerify: (req, _res, buffer) => { if (req && typeof req === 'object') rawBodies.set(req, Buffer.from(buffer)); },
  development: env.NODE_ENV === 'development',
});

startScheduler();
startCareReminderWorker();
service.start();
