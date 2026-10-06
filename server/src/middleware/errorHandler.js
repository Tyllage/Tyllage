import env from '../config/env.js';
import { AppError } from '../utils/errors.js';

// Postgres error codes mapped to safe client messages.
const PG_ERRORS = {
  23505: { status: 409, code: 'DUPLICATE', message: 'A record with these details already exists' },
  23503: { status: 400, code: 'INVALID_REFERENCE', message: 'A referenced record does not exist' },
  23514: { status: 400, code: 'CONSTRAINT_VIOLATION', message: 'The data violates a business rule' },
  '22P02': { status: 400, code: 'INVALID_INPUT', message: 'Invalid input format' },
};

/** 415 for write requests that send a body in anything other than JSON. */
export function requireJsonBody(req, res, next) {
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && hasBody && !req.is('application/json')) {
    return res.status(415).json({ success: false, message: 'Request body must be JSON (Content-Type: application/json)', code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  next();
}

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}`, code: 'ROUTE_NOT_FOUND' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    const body = { success: false, message: err.message, code: err.code };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  // Body-parser errors carry their own HTTP status; map them to clear codes instead of a 500.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON body', code: 'INVALID_JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' });
  }
  if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
    return res.status(415).json({ success: false, message: 'Unsupported request encoding', code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  if (err?.expose && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ success: false, message: err.message, code: 'BAD_REQUEST' });
  }

  const pgError = err?.code && PG_ERRORS[err.code];
  if (pgError) {
    return res.status(pgError.status).json({ success: false, message: pgError.message, code: pgError.code });
  }

  if (!env.isTest) console.error('[error]', err);
  res.status(500).json({
    success: false,
    // Never leak internals in production.
    message: env.isProduction ? 'Something went wrong. Please try again.' : err?.message || 'Internal error',
    code: 'INTERNAL_ERROR',
  });
}
