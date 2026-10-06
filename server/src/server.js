import env from './config/env.js';
import { pool } from './config/db.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './app.js';
import { loadPolicies } from './services/policyService.js';

async function start() {
  // Apply pending migrations on boot so a fresh Railway Postgres is usable immediately.
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') {
    await runMigrations();
  }

  await loadPolicies();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`Tyllage API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
