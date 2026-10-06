import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetDb, clearTokens, ACCOUNTS, DEMO_PASSWORD } from './helpers.js';

describe('HTTP status codes', () => {
  before(async () => {
    clearTokens();
    await resetDb();
  });
  after(clearTokens);

  it('413 for a JSON body over the 100kb limit', async () => {
    const res = await api().post('/api/auth/login').send({ email: ACCOUNTS.farmAdmin, password: 'x'.repeat(120 * 1024) });
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'PAYLOAD_TOO_LARGE');
  });

  it('415 for a write request whose body is not JSON', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'text/plain').send(`email=${ACCOUNTS.farmAdmin}`);
    assert.equal(res.status, 415);
    assert.equal(res.body.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('400 for malformed JSON; JSON requests still work', async () => {
    const bad = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'INVALID_JSON');
    const ok = await api().post('/api/auth/login').send({ email: ACCOUNTS.farmAdmin, password: DEMO_PASSWORD });
    assert.equal(ok.status, 200);
  });

  it('bodyless POSTs (e.g. actions) are not rejected as 415', async () => {
    const res = await api().post('/api/harvests/1/close');
    assert.equal(res.status, 401); // reaches auth, not the content-type check
  });
});
