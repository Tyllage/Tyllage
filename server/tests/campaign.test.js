import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetDb, login, clearTokens, ACCOUNTS, ids, pool, futureISO } from './helpers.js';
import { findUnapprovedPrices, mockCopy } from '../src/services/openaiService.js';
import { normalisePhone } from '../src/services/whatsappService.js';

describe('Tyllage Connect (mock mode)', () => {
  let I;
  let admin;
  let rescueId;
  before(async () => {
    clearTokens();
    await resetDb();
    I = await ids();
    admin = await login(ACCOUNTS.farmAdmin);
    const r = await api().post('/api/rescue').set('Authorization', admin).send({
      harvestBatchId: I.naiBai, quantity: 4, rescuePrice: 5, reason: 'SURPLUS', collectionDeadline: futureISO(2), suitabilityConfirmed: true,
    });
    rescueId = r.body.data.id;
  });
  after(clearTokens);

  it('generates a draft from backend context only; nothing is sent', async () => {
    const res = await api().post('/api/campaigns/generate').set('Authorization', admin)
      .send({ farmId: I.comcrop, campaignType: 'RESCUE_ALERT', rescueListingId: rescueId });
    assert.equal(res.status, 201);
    const c = res.body.data;
    assert.equal(c.status, 'DRAFT');
    assert.equal(c.generationMode, 'MOCK');
    assert.equal(c.context.rescuePrice, 5);
    assert.match(c.finalContent, /\$5\.00/);
    assert.match(c.finalContent, /Tyllage does not inspect produce/);
    const sent = await pool.query("SELECT COUNT(*)::int AS n FROM notifications WHERE campaign_id = $1", [c.id]);
    assert.equal(sent.rows[0].n, 0);
  });

  it("rejects context from another farm's records", async () => {
    const res = await api().post('/api/campaigns/generate').set('Authorization', admin)
      .send({ farmId: I.comcrop, campaignType: 'B2B_AVAILABILITY', harvestBatchId: I.pakChoi });
    assert.equal(res.status, 404);
  });

  it('enforces review → approve → send, with mock WhatsApp delivery', async () => {
    const draft = (await api().get(`/api/campaigns?farmId=${I.comcrop}`).set('Authorization', admin)).body.data.find((c) => c.status === 'DRAFT');
    assert.equal((await api().post(`/api/campaigns/${draft.id}/send`).set('Authorization', admin)).status, 409);

    const staff = await login(ACCOUNTS.farmStaff);
    assert.equal((await api().post(`/api/campaigns/${draft.id}/approve`).set('Authorization', staff)).status, 403);

    const edited = await api().patch(`/api/campaigns/${draft.id}`).set('Authorization', admin).send({ finalContent: `${draft.finalContent}\nEdited by farm.` });
    assert.match(edited.body.data.finalContent, /Edited by farm/);
    assert.equal(edited.body.data.generatedContent, draft.generatedContent);

    const approved = await api().post(`/api/campaigns/${draft.id}/approve`).set('Authorization', admin);
    assert.equal(approved.body.data.status, 'APPROVED');
    assert.equal((await api().patch(`/api/campaigns/${draft.id}`).set('Authorization', admin).send({ title: 'nope' })).status, 409);

    const sent = await api().post(`/api/campaigns/${draft.id}/send`).set('Authorization', admin);
    assert.equal(sent.status, 200);
    assert.equal(sent.body.data.campaign.status, 'SENT');
    assert.ok(sent.body.data.delivery.MOCK_SENT > 0);
    // Only opted-in consumers/community recipients related to the farm were messaged.
    const rows = await pool.query(
      `SELECT bp.buyer_type, bp.whatsapp_opt_in, n.status FROM notifications n JOIN buyer_profiles bp ON bp.id = n.buyer_id WHERE n.campaign_id = $1`,
      [draft.id]
    );
    assert.ok(rows.rows.every((r) => r.whatsapp_opt_in && r.buyer_type === 'CONSUMER' && r.status === 'MOCK_SENT'));
    assert.equal((await api().post(`/api/campaigns/${draft.id}/send`).set('Authorization', admin)).status, 409);
  });

  it('flags prices in generated copy that are not in the approved context', () => {
    const ctx = { rescuePrice: 5, originalPrice: 8 };
    assert.deepEqual(findUnapprovedPrices('Now $5.00, was $8', ctx), []);
    assert.deepEqual(findUnapprovedPrices('Only $3.50 today!', ctx), ['3.50']);
  });

  it('mock copy is deterministic and uses only context facts', () => {
    const ctx = { campaignType: 'HARVEST_ANNOUNCEMENT', farm: 'Farm', produce: 'Kale', quantity: 5, unit: 'kg', harvestDate: '2030-01-01', price: 14 };
    assert.equal(mockCopy(ctx), mockCopy(ctx));
    assert.match(mockCopy(ctx), /5kg available at \$14\.00\/kg/);
  });

  it('normalises Singapore phone numbers for WhatsApp', () => {
    assert.equal(normalisePhone('8000 0001'), '6580000001');
    assert.equal(normalisePhone('+65 8000 0001'), '6580000001');
  });
});

describe('Health check', () => {
  it('reports service, environment, database and timestamp without secrets', async () => {
    const res = await api().get('/api/health');
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.status, 'ok');
    assert.equal(d.database, 'connected');
    assert.equal(d.environment, 'test');
    assert.ok(d.timestamp);
    assert.ok(!JSON.stringify(d).includes('postgres://'));
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await api().get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});
