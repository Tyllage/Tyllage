import pg from 'pg';
import env from './env.js';

// NUMERIC -> JS number (quantities/prices are 2dp, well within float precision).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// BIGINT (COUNT(*)) -> number.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE -> 'YYYY-MM-DD' string, avoiding timezone shifts.
pg.types.setTypeParser(1082, (v) => v);

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL (or TEST_DATABASE_URL in tests) is not configured');
}

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: env.isTest ? 5 : 10,
});

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Runs `fn(client)` inside a transaction and rolls back on any thrown error.
 * Pass an existing client to join an outer transaction instead.
 */
export async function withTransaction(fn, existingClient) {
  if (existingClient) return fn(existingClient);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  try {
    await pool.query('SELECT 1');
    return 'connected';
  } catch {
    return 'unavailable';
  }
}
