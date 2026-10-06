import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetDb, login, clearTokens, ACCOUNTS, ids } from './helpers.js';
import { riskLevel, demandCoverage } from '../src/services/riskService.js';

describe('Produce and harvest management', () => {
  let I;
  let admin;
  let kaleProduce;
  const base = () => ({ farmId: I.comcrop, produceId: kaleProduce, expectedQuantity: 40, harvestDate: '2099-03-01', preferredPrice: 14, minPrice: 10 });

  before(async () => {
    clearTokens();
    await resetDb();
    I = await ids();
    admin = await login(ACCOUNTS.farmAdmin);
    kaleProduce = await I.produce('Kale');
  });
  after(clearTokens);

  it('farm admin can create produce', async () => {
    const res = await api().post('/api/produce').set('Authorization', admin)
      .send({ farmId: I.comcrop, name: 'Pea Shoots', category: 'MICROGREENS', unit: 'kg', defaultPrice: 30 });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.farmId, I.comcrop);
    const dup = await api().post('/api/produce').set('Authorization', admin)
      .send({ farmId: I.comcrop, name: 'pea shoots', category: 'MICROGREENS', defaultPrice: 30 });
    assert.equal(dup.status, 409);
  });

  it('creates a harvest batch with PLANNED status and live coverage', async () => {
    const res = await api().post('/api/harvests').set('Authorization', admin).send(base());
    assert.equal(res.status, 201);
    const b = res.body.data;
    assert.equal(b.status, 'PLANNED');
    assert.equal(b.harvestQuantity, 40);
    assert.equal(b.confirmedDemand, 0);
    assert.equal(b.demandCoverage, 0);
    assert.equal(b.riskLevel, 'HIGH');
    assert.equal(b.unallocatedQuantity, 40);
  });

  it('validates quantities, dates and prices', async () => {
    const cases = [
      [{ expectedQuantity: 0 }, 'expectedQuantity'],
      [{ expectedQuantity: -5 }, 'expectedQuantity'],
      [{ harvestDate: undefined }, 'harvestDate'],
      [{ minPrice: 15, preferredPrice: 14 }, 'minPrice'],
    ];
    for (const [override, field] of cases) {
      const res = await api().post('/api/harvests').set('Authorization', admin).send({ ...base(), ...override });
      assert.equal(res.status, 400, JSON.stringify(override));
      assert.equal(res.body.code, 'VALIDATION_ERROR');
      assert.ok(res.body.details.some((d) => d.field === field), `expected error on ${field}`);
    }
  });

  it('rejects minimum price above preferred price on update', async () => {
    const res = await api().patch(`/api/harvests/${I.naiBai}`).set('Authorization', admin).send({ minPrice: 9 }); // preferred is 8
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Minimum price cannot exceed preferred price/);
  });

  it('cannot reduce quantity below what is already allocated', async () => {
    // Nai Bai has 33kg allocated in the demo data.
    const res = await api().patch(`/api/harvests/${I.naiBai}`).set('Authorization', admin).send({ actualQuantity: 30 });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'QUANTITY_BELOW_COMMITTED');
  });

  it('marks available, edits, and closes a batch', async () => {
    const created = await api().post('/api/harvests').set('Authorization', admin).send(base());
    const id = created.body.data.id;
    const avail = await api().post(`/api/harvests/${id}/mark-available`).set('Authorization', admin);
    assert.equal(avail.body.data.status, 'AVAILABLE');
    const edited = await api().patch(`/api/harvests/${id}`).set('Authorization', admin).send({ grade: 'PREMIUM', actualQuantity: 42 });
    assert.equal(edited.body.data.grade, 'PREMIUM');
    assert.equal(edited.body.data.harvestQuantity, 42);
    const closed = await api().post(`/api/harvests/${id}/close`).set('Authorization', admin);
    assert.equal(closed.body.data.status, 'CLOSED');
    const afterClose = await api().patch(`/api/harvests/${id}`).set('Authorization', admin).send({ notes: 'late' });
    assert.equal(afterClose.status, 409);
  });

  it('records an audit log entry for harvest changes', async () => {
    const res = await api().get(`/api/farms/${I.comcrop}/audit-logs`).set('Authorization', admin);
    const actions = res.body.data.map((a) => a.action);
    assert.ok(actions.includes('HARVEST_CREATED'));
    assert.ok(actions.includes('HARVEST_UPDATED'));
    assert.ok(actions.includes('HARVEST_CLOSED'));
  });
});

describe('Demand coverage and risk rules', () => {
  it('computes coverage as confirmed ÷ expected × 100', () => {
    assert.equal(demandCoverage(24, 70), 34.3);
    assert.equal(demandCoverage(0, 70), 0);
    assert.equal(demandCoverage(10, 0), null);
  });

  it('maps coverage to transparent risk thresholds', () => {
    assert.equal(riskLevel(80), 'LOW');
    assert.equal(riskLevel(95), 'LOW');
    assert.equal(riskLevel(79.9), 'MEDIUM');
    assert.equal(riskLevel(50), 'MEDIUM');
    assert.equal(riskLevel(49.9), 'HIGH');
    assert.equal(riskLevel(34.3), 'HIGH');
    assert.equal(riskLevel(null), null);
  });
});
