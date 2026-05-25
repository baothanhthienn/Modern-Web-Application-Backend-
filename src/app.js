import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createAuthRouter } from './auth/auth.routes.js';
import { AuthService } from './auth/auth.service.js';
import { HttpError } from './errors.js';
import { HealthService } from './health.service.js';

function corsOrigin(config) {
  return (origin, callback) => {
    if (!origin || config.frontendOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  };
}

export function createApp({ config, db, authService, healthService, logger = console } = {}) {
  const app = express();
  const resolvedAuthService = authService || new AuthService(db, config);
  const resolvedHealthService = healthService || new HealthService(db);

  if (config.isProduction) {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigin(config), credentials: true }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (request, response, next) => {
    try {
      response.json(await resolvedHealthService.check());
    } catch (error) {
      next(error);
    }
  });
  app.use('/api/auth', createAuthRouter({ authService: resolvedAuthService, config }));

  app.use((request, response) => {
    response.status(404).json({ success: false, error: 'Endpoint not found.' });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      return next(error);
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return response.status(400).json({ success: false, error: 'Request body must be valid JSON.' });
    }

    if (error instanceof HttpError) {
      return response.status(error.status).json({ success: false, error: error.message });
    }

    logger.error('[api] unexpected error', error);
    const payload = { success: false, error: 'Authentication service failed.' };
    if (!config.isProduction) {
      payload.details = error.message;
    }
    return response.status(500).json(payload);
  });

  return app;
}
