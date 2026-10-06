// Preloaded with `node --import` so it runs before any application module reads the environment.
process.env.NODE_ENV = 'test';
// Tests always exercise mock integrations, never real external APIs.
process.env.OPENAI_API_KEY = '';
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';

if (!process.env.TEST_DATABASE_URL) {
  console.error(
    'TEST_DATABASE_URL is not set. Point it at a disposable database (it is wiped on every run), e.g.\n' +
      '  TEST_DATABASE_URL=postgres://user:pass@localhost:5432/tyllage_test'
  );
  process.exit(1);
}
