import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { createAuthRouter } from './auth/auth.routes.js';
import { AuthService } from './auth/auth.service.js';
import { ChatService } from './chat/chat.service.js';
import { createChatRouter } from './chat/chat.routes.js';
import { createCommunityRouter } from './community/community.routes.js';
import { CommunityService } from './community/community.service.js';
import { createPostRouter, createSearchRouter } from './content/post.routes.js';
import { PostService } from './content/post.service.js';
import { HttpError } from './errors.js';
import { HealthService } from './health.service.js';
import { createMeRouter, createProfileRouter } from './profile/profile.routes.js';
import { ProfileService } from './profile/profile.service.js';
import { createSocialRouter } from './social/social.routes.js';
import { SocialService } from './social/social.service.js';

function corsOrigin(config) {
  return (origin, callback) => {
    if (!origin || config.frontendOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  };
}

export function createApp({
  config,
  db,
  authService,
  healthService,
  profileService,
  postService,
  communityService,
  socialService,
  chatService,
  logger = console,
} = {}) {
  const app = express();
  const resolvedAuthService = authService || new AuthService(db, config);
  const resolvedHealthService = healthService || new HealthService(db);
  const resolvedProfileService = profileService || new ProfileService(db);
  const resolvedPostService = postService || new PostService(db);
  const resolvedCommunityService = communityService || new CommunityService(db);
  const resolvedSocialService = socialService || new SocialService(db);
  const resolvedChatService = chatService || new ChatService(
    db,
    resolvedCommunityService,
    resolvedSocialService,
  );
  const profileReadLimiter = rateLimit({
    windowMs: config.profileReadRateWindowMs,
    limit: config.profileReadRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    handler(request, response) {
      response.status(429).json({
        success: false,
        error: 'Too many profile requests. Please try again later.',
      });
    },
  });

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
  app.use(
    '/api/posts',
    profileReadLimiter,
    createPostRouter({ postService: resolvedPostService, authService: resolvedAuthService, config }),
  );
  app.use('/api/search', profileReadLimiter, createSearchRouter({ postService: resolvedPostService }));
  app.use(
    '/api/communities',
    profileReadLimiter,
    createCommunityRouter({
      communityService: resolvedCommunityService,
      authService: resolvedAuthService,
      config,
    }),
  );
  app.use(
    '/api/profiles',
    profileReadLimiter,
    createProfileRouter({
      profileService: resolvedProfileService,
      authService: resolvedAuthService,
      config,
    }),
  );
  app.use(
    '/api/me',
    profileReadLimiter,
    createMeRouter({
      profileService: resolvedProfileService,
      authService: resolvedAuthService,
      config,
    }),
  );
  app.use(
    '/api/chats',
    profileReadLimiter,
    createChatRouter({ chatService: resolvedChatService, authService: resolvedAuthService, config }),
  );
  app.use(
    '/api',
    createSocialRouter({ socialService: resolvedSocialService, authService: resolvedAuthService, config }),
  );

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
