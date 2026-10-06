import { badRequest } from './errors.js';

/** Parses `input` with a zod schema, throwing a 400 AppError with field details on failure. */
export function validate(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    const first = details[0];
    const message = first ? (first.field ? `${first.field}: ${first.message}` : first.message) : 'Invalid input';
    throw badRequest(message, 'VALIDATION_ERROR', details);
  }
  return result.data;
}

export function idParam(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`, 'VALIDATION_ERROR');
  return n;
}
