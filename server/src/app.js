import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import env from './config/env.js';
import apiRoutes from './routes/index.js';
import { errorHandler, notFoundHandler, requireJsonBody } from './middleware/errorHandler.js';

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp() {
  const app = express();

  // Railway (and most PaaS) terminate TLS at a proxy; needed for correct req.ip and rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  const allowedOrigins = env.CLIENT_URL.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin requests and non-browser clients send no Origin header.
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: false,
    })
  );
  app.use('/api', requireJsonBody);
  app.use(express.json({ limit: '100kb' }));
  if (!env.isTest) app.use(morgan(env.isProduction ? 'combined' : 'dev'));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: env.isTest ? 10000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' },
    })
  );

  app.use('/api', apiRoutes);
  app.use('/api', notFoundHandler);

  // Single-service deployment: serve the built React app when it exists.
  if (env.SERVE_CLIENT && fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: env.isProduction ? '1h' : 0 }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
