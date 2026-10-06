import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  sellThroughRate,
  demandCoverageRate,
  rescueRate,
  channelConcentration,
  repeatBuyerRate,
  matchConversionRate,
} from '../src/services/analyticsService.js';
import { api, resetDb, login, clearTokens, ACCOUNTS, ids, pool } from './helpers.js';

describe('Analytics formulas (unit)', () => {
  it('sell-through = sold ÷ actual harvest × 100', () => {
    assert.equal(sellThroughRate(55, 60).value, 91.7);
    assert.equal(sellThroughRate(0, 0).value, null);
    assert.equal(sellThroughRate(0, 0).sufficient, false);
  });

  it('demand coverage = confirmed ÷ expected × 100', () => {
    assert.equal(demandCoverageRate(24, 70).value, 34.3);
  });

  it('rescue rate = recovered ÷ at-risk × 100 (capped at 100)', () => {
    assert.equal(rescueRate(3, 5).value, 60);
    assert.equal(rescueRate(8, 5).value, 100);
    assert.equal(rescueRate(0, 0).sufficient, false);
  });

  it('channel concentration = largest buyer revenue ÷ total revenue × 100', () => {
    assert.equal(channelConcentration([300, 100, 100]).value, 60);
    assert.equal(channelConcentration([]).sufficient, false);
  });

  it('repeat buyer rate = buyers with 2+ orders ÷ buyers × 100', () => {
    assert.equal(repeatBuyerRate([1, 2, 3, 1]).value, 50);
    assert.equal(repeatBuyerRate([]).value, null);
  });

  it('match conversion = approved ÷ generated × 100', () => {
    assert.equal(matchConversionRate(3, 4).value, 75);
    assert.equal(matchConversionRate(0, 0).sufficient, false);
  });
});

describe('Farm analytics endpoint (integration)', () => {
  let I;
  before(async () => {
    clearTokens();
    await resetDb();
    I = await ids();
  });
  after(clearTokens);

  it('derives every metric from database records', async () => {
    const admin = await login(ACCOUNTS.farmAdmin);
    const res = await api().get(`/api/analytics?farmId=${I.comcrop}`).set('Authorization', admin);
    assert.equal(res.status, 200);
    const { totals, metrics } = res.body.data;

    const rev = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS r FROM orders WHERE farm_id = $1 AND status IN ('CONFIRMED','READY','COMPLETED')`,
      [I.comcrop]
    );
    assert.equal(totals.revenue, Number(rev.rows[0].r));
    // Seeded HarvestMatch history: 3 approved, 1 rejected → 75%.
    assert.equal(metrics.matchConversion.value, 75);
    // No recovery has run yet → no at-risk baseline → not enough data.
    assert.equal(metrics.rescueRate.sufficient, false);
    assert.equal(metrics.rescueRate.value, null);
    assert.ok(metrics.sellThrough.sufficient);
    assert.ok(metrics.channelConcentration.value > 0 && metrics.channelConcentration.value <= 100);
  });

  it('a farm with no activity reports "not enough data" rather than invented numbers', async () => {
    const farmB = await login(ACCOUNTS.farmBAdmin);
    const res = await api().get(`/api/analytics?farmId=${I.farmB}`).set('Authorization', farmB);
    const { metrics, weeklyRevenue, totals } = res.body.data;
    assert.equal(totals.revenue, 0);
    for (const key of ['sellThrough', 'rescueRate', 'channelConcentration', 'repeatBuyerRate', 'matchConversion']) {
      assert.equal(metrics[key].sufficient, false, key);
      assert.equal(metrics[key].value, null, key);
    }
    assert.equal(weeklyRevenue.sufficient, false);
  });
});
