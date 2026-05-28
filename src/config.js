import 'dotenv/config';

function booleanValue(value, fallback) {
  if (value === undefined) return fallback;
  return value === 'true';
}

function integerValue(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const isRailway = Boolean(
    env.RAILWAY_ENVIRONMENT ||
    env.RAILWAY_ENVIRONMENT_NAME ||
    env.RAILWAY_PUBLIC_DOMAIN ||
    env.RAILWAY_SERVICE_NAME,
  );
  const isHosted = isProduction || isRailway;
  const sameSite = env.COOKIE_SAME_SITE || (isHosted ? 'none' : 'lax');

  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('COOKIE_SAME_SITE must be lax, strict, or none.');
  }

  return {
    env: env.NODE_ENV || 'development',
    isProduction,
    isHosted,
    port: integerValue(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL,
    databaseSsl: booleanValue(env.DATABASE_SSL, isProduction),
    databaseSslRejectUnauthorized: booleanValue(
      env.DATABASE_SSL_REJECT_UNAUTHORIZED,
      true,
    ),
    frontendOrigins: (env.FRONTEND_ORIGIN || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionCookieName: env.SESSION_COOKIE_NAME || 'reddit_session',
    sessionTtlMs: integerValue(env.SESSION_TTL_SECONDS, 30 * 24 * 60 * 60) * 1000,
    cookieSecure: booleanValue(env.COOKIE_SECURE, isHosted),
    cookieSameSite: sameSite,
    profileReadRateLimit: integerValue(env.PROFILE_READ_RATE_LIMIT, 120),
    profileReadRateWindowMs: integerValue(env.PROFILE_READ_RATE_WINDOW_SECONDS, 60) * 1000,
  };
}

export const config = createConfig();
