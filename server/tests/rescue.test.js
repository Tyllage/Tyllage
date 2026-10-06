import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetDb, login, clearTokens, ACCOUNTS, ids, batchStock, futureISO } from './helpers.js';

describe('Tyllage Rescue', () => {
  let I;
  let admin;
  const listing = (o = {}) => ({
    harvestBatchId: I.naiBai, quantity: 5, rescuePrice: 5, reason: 'SURPLUS', collectionDeadline: futureISO(2), suitabilityConfirmed: true, ...o,
  });

  before(async () => {
    clearTokens();
    await resetDb();
    I = await ids();
    admin = await login(ACCOUNTS.farmAdmin);
  });
  after(clearTokens);

  it('requires the farm to confirm suitability for sale', async () => {
    const res = await api().post('/api/rescue').set('Authorization', admin).send(listing({ suitabilityConfirmed: undefined }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /suitable for sale/);
    const falsy = await api().post('/api/rescue').set('Authorization', admin).send(listing({ suitabilityConfirmed: false }));
    assert.equal(falsy.status, 400);
  });

  it('validates quantity, price, reason and deadline', async () => {
    const tooMuch = await api().post('/api/rescue').set('Authorization', admin).send(listing({ quantity: 28 })); // 27kg unallocated
    assert.equal(tooMuch.status, 409);
    assert.equal(tooMuch.body.code, 'OVER_ALLOCATION');
    assert.equal((await api().post('/api/rescue').set('Authorization', admin).send(listing({ rescuePrice: 9 }))).status, 400); // original is 8
    assert.equal((await api().post('/api/rescue').set('Authorization', admin).send(listing({ quantity: 0 }))).status, 400);
    assert.equal((await api().post('/api/rescue').set('Authorization', admin).send(listing({ reason: 'ROTTEN' }))).status, 400);
    assert.equal((await api().post('/api/rescue').set('Authorization', admin).send(listing({ collectionDeadline: futureISO(-1) }))).status, 400);
  });

  it('creates a listing that removes stock from the batch, and shows it publicly without internal prices', async () => {
    const before = await batchStock(I.naiBai);
    const res = await api().post('/api/rescue').set('Authorization', admin).send(listing());
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'ACTIVE');
    const after = await batchStock(I.naiBai);
    assert.equal(after.remaining_quantity, before.remaining_quantity - 5);

    const pub = await api().get('/api/rescue/public');
    const card = pub.body.data.find((l) => l.id === res.body.data.id);
    assert.equal(card.rescuePrice, 5);
    assert.equal(card.originalPrice, 8);
    assert.equal(card.availableQuantity, 5);
    assert.ok(card.disclaimer);
    assert.equal(card.minPrice, undefined);
  });

  it('consumers reserve Rescue produce; reservations cannot exceed what is listed', async () => {
    const consumer = await login(ACCOUNTS.consumer);
    const id = (await api().get('/api/rescue/public')).body.data.find((l) => l.produceName === 'Nai Bai').id;
    const over = await api().post(`/api/rescue/${id}/reserve`).set('Authorization', consumer).send({ quantity: 6 });
    assert.equal(over.status, 409);
    const ok = await api().post(`/api/rescue/${id}/reserve`).set('Authorization', consumer).send({ quantity: 2 });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.listing.availableQuantity, 3);
    const order = await api().get(`/api/orders/${ok.body.data.orderId}`).set('Authorization', consumer);
    assert.equal(order.body.data.status, 'PENDING');
    assert.equal(order.body.data.source, 'RESCUE');
    // Farm admins cannot reserve (buyer-only action).
    assert.equal((await api().post(`/api/rescue/${id}/reserve`).set('Authorization', admin).send({ quantity: 1 })).status, 403);
  });

  it('cancelling a listing returns only the unsold quantity to the batch', async () => {
    const before = await batchStock(I.naiBai);
    const id = (await api().get(`/api/rescue?farmId=${I.comcrop}`).set('Authorization', admin)).body.data.find((l) => l.produceName === 'Nai Bai').id;
    const res = await api().post(`/api/rescue/${id}/cancel`).set('Authorization', admin);
    assert.equal(res.body.data.status, 'CANCELLED');
    const after = await batchStock(I.naiBai);
    assert.equal(after.remaining_quantity, before.remaining_quantity + 3); // 2kg sold stays committed
  });
});
