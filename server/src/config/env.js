// Centralised environment configuration. Railway injects PORT and DATABASE_URL.

// Business dates (harvest dates, required dates) are Singapore calendar days.
// Railway containers default to UTC, so pin the process timezone.
process.env.TZ = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Singapore';

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function required(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return devFallback;
}

const env = {
  NODE_ENV,
  isProduction,
  isTest,
  PORT: Number(process.env.PORT) || 4000,
  DATABASE_URL: isTest
    ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    : required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/tyllage'),
  DATABASE_SSL: process.env.DATABASE_SSL === 'true',
  JWT_SECRET: required('JWT_SECRET', 'dev-only-insecure-jwt-secret-change-me'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || '',
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION || 'v21.0',
  // When true (default) and client/dist exists, Express also serves the built frontend.
  SERVE_CLIENT: process.env.SERVE_CLIENT !== 'false',
};

if (isProduction && env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export default env;
