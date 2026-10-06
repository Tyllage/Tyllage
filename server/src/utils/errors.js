export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, code = 'BAD_REQUEST', details) => new AppError(msg, 400, code, details);
export const unauthorized = (msg = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(msg, 401, code);
export const forbidden = (msg = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
  new AppError(msg, 403, code);
export const notFound = (msg = 'Resource not found', code = 'NOT_FOUND') => new AppError(msg, 404, code);
export const conflict = (msg, code = 'CONFLICT') => new AppError(msg, 409, code);
