import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetDb, login, clearTokens, ACCOUNTS, DEMO_PASSWORD } from './helpers.js';

describe('Authentication', () => {
  before(async () => {
    clearTokens();
    await resetDb();
  });
  after(clearTokens);

  it('logs in a farm admin and returns a JWT and profile', async () => {
    const res = await api().post('/api/auth/login').send({ email: ACCOUNTS.farmAdmin, password: DEMO_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.user.role, 'farm_admin');
    assert.equal(res.body.data.user.farmIds.length, 1);
    assert.equal(res.body.data.user.passwordHash, undefined);
  });

  it('rejects an incorrect password with a generic message', async () => {
    const res = await api().post('/api/auth/login').send({ email: ACCOUNTS.farmAdmin, password: 'wrong-password' });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the same generic message', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever123' });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'INVALID_CREDENTIALS');
  });

  it('GET /me requires a valid token', async () => {
    assert.equal((await api().get('/api/auth/me')).status, 401);
    assert.equal((await api().get('/api/auth/me').set('Authorization', 'Bearer not-a-token')).status, 401);
    const token = await login(ACCOUNTS.consumer);
    const res = await api().get('/api/auth/me').set('Authorization', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.role, 'consumer');
    assert.ok(res.body.data.user.buyerId);
  });

  it('registers a business buyer with a buyer profile', async () => {
    const res = await api().post('/api/auth/register').send({
      email: 'NewCafe@Example.com', password: 'longenough1', fullName: 'New Cafe Owner', role: 'business_buyer',
      organisationName: 'New Cafe', buyerType: 'CAFE', region: 'CENTRAL',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email, 'newcafe@example.com');
    assert.ok(res.body.data.user.buyerId);
  });

  it('does not allow self-registration as a farm or platform role', async () => {
    for (const role of ['farm_admin', 'platform_admin', 'farm_staff']) {
      const res = await api().post('/api/auth/register').send({ email: `${role}@x.com`, password: 'longenough1', fullName: 'Sneaky', role });
      assert.equal(res.status, 400, role);
    }
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const dup = await api().post('/api/auth/register').send({ email: ACCOUNTS.consumer, password: 'longenough1', fullName: 'Dup', role: 'consumer' });
    assert.equal(dup.status, 409);
    const weak = await api().post('/api/auth/register').send({ email: 'weak@x.com', password: 'short', fullName: 'Weak', role: 'consumer' });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.code, 'VALIDATION_ERROR');
  });

  it('blocks deactivated accounts', async () => {
    const admin = await login(ACCOUNTS.platformAdmin);
    const users = await api().get('/api/users').set('Authorization', admin);
    const hotel = users.body.data.find((u) => u.email === ACCOUNTS.hotel);
    const token = await login(ACCOUNTS.hotel);
    await api().patch(`/api/users/${hotel.id}/active`).set('Authorization', admin).send({ isActive: false }).expect(200);
    assert.equal((await api().get('/api/auth/me').set('Authorization', token)).status, 401);
    const relogin = await api().post('/api/auth/login').send({ email: ACCOUNTS.hotel, password: DEMO_PASSWORD });
    assert.equal(relogin.status, 401);
  });
});
