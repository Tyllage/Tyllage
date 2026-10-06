/**
 * Demand Recovery — when produce is left unallocated (buyer cancels, harvest exceeds demand, coverage
 * stays low), re-run commercial-route comparison and buyer matching against the remaining eligible
 * channels, and recommend the next stage (proposal v3 §8.5):
 *   Primary route → Alternative route → Rescue route → Final disposition record.
 * Nothing is executed automatically: every suggestion requires farm admin approval.
 */
import { query } from '../config/db.js';
import { camelize } from '../utils/case.js';
import { round2 } from '../utils/numbers.js';
import { ROUTE_LABELS } from '../config/rules.js';
import { listBatches, toBatchDTO, findBatchById } from '../models/harvestModel.js';
import { runMatching, getMatchesForBatch } from './harvestMatchService.js';
import { assessBatch, compactAssessment } from './marketRouteService.js';
import { getPolicy } from './policyService.js';
import { assertFarmAccess } from './farmAccessService.js';

export const RECOVERY_TRIGGERS = {
  BUYER_CANCELLED: 'A buyer cancelled an order for this batch',
  ACTUAL_EXCEEDS_EXPECTED: 'Actual harvest exceeds the expected quantity',
  LOW_COVERAGE: 'Demand coverage is below 50%',
  UNALLOCATED_NEAR_HARVEST: 'Produce is still unallocated close to (or after) harvest',
};

/** Batches that currently need recovery attention, with the reasons why. */
export async function listRecoveryCandidates(farmId) {
  const batches = (await listBatches(farmId)).map(toBatchDTO);
  const cancellations = await query(
    `SELECT oi.harvest_batch_id, SUM(a.quantity) AS released_quantity, MAX(o.cancelled_at) AS last_cancelled_at
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN allocations a ON a.order_item_id = oi.id AND a.status = 'RELEASED'
      WHERE o.farm_id = $1 AND o.status = 'CANCELLED' AND o.cancelled_at > NOW() - INTERVAL '14 days'
      GROUP BY oi.harvest_batch_id`,
    [farmId]
  );
  const cancelledByBatch = new Map(cancellations.rows.map((r) => [r.harvest_batch_id, r]));
  const lastRuns = await query(
    `SELECT DISTINCT ON (harvest_batch_id) harvest_batch_id, id, created_at, summary
       FROM match_runs WHERE farm_id = $1 AND run_type = 'RECOVERY'
      ORDER BY harvest_batch_id, created_at DESC`,
    [farmId]
  );
  const lastRunByBatch = new Map(lastRuns.rows.map((r) => [r.harvest_batch_id, r]));

  const candidates = [];
  for (const b of batches) {
    if (b.unallocatedQuantity <= 0) continue;
    const triggers = [];
    const cancelled = cancelledByBatch.get(b.id);
    if (cancelled) triggers.push('BUYER_CANCELLED');
    if (b.actualQuantity && b.actualQuantity > b.expectedQuantity) triggers.push('ACTUAL_EXCEEDS_EXPECTED');
    if (b.riskLevel === 'HIGH') triggers.push('LOW_COVERAGE');
    if (b.atRiskQuantity > 0 && b.daysToHarvest <= 3) triggers.push('UNALLOCATED_NEAR_HARVEST');
    if (!triggers.length) continue;
    const lastRun = lastRunByBatch.get(b.id);
    candidates.push({
      ...b,
      triggers: triggers.map((t) => ({ code: t, label: RECOVERY_TRIGGERS[t] })),
      cancelledQuantity: cancelled ? Number(cancelled.released_quantity) : 0,
      lastRecoveryAt: lastRun?.created_at || null,
    });
  }
  return candidates;
}

/**
 * Which recovery stage applies now. PRIMARY while the farm's primary route (or, before a route is chosen,
 * any route) still has strong demand; ALTERNATIVE when only other routes do; then RESCUE; and finally a
 * FINAL_DISPOSITION record once the produce is past its commercial window.
 */
export function recoveryStage(summary, { primaryRoute, routingStage } = {}) {
  if (summary.potentialStrongTotal > 0) {
    if (!primaryRoute) return 'PRIMARY';
    return (summary.potentialByRoute?.[primaryRoute] || 0) > 0 ? 'PRIMARY' : 'ALTERNATIVE';
  }
  if (!(summary.remainingAfterStrong > 0)) return null;
  return routingStage === 'DONATION' ? 'FINAL_DISPOSITION' : 'RESCUE';
}

/** Turns a recovery run summary into explicit, approval-required suggestions. */
export function buildRecoverySuggestions(summary, unit = 'kg', { routingStage } = {}) {
  const suggestions = [];
  if (summary.potentialStrongTotal > 0) {
    const routes = Object.entries(summary.potentialByRoute || {})
      .filter(([, q]) => q > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([route, quantity]) => ({ route, label: ROUTE_LABELS[route], quantity }));
    suggestions.push({
      type: 'APPROVE_MATCHES',
      quantity: summary.potentialStrongTotal,
      routes,
      message: `Review and approve recovery matches for ${summary.potentialStrongTotal}${unit}${routes.length ? ` (${routes.map((r) => `${r.label} ${r.quantity}${unit}`).join(', ')})` : ''}`,
    });
  }
  let remainder = round2(summary.remainingAfterStrong);
  // DemandPool is a Phase 3 network feature: only suggested when the preview is enabled.
  if (remainder > 0 && summary.demandPoolQuantity > 0 && getPolicy().networkFeaturesEnabled) {
    const qty = round2(Math.min(remainder, summary.demandPoolQuantity));
    suggestions.push({
      type: 'DEMAND_POOL',
      quantity: qty,
      message: `${summary.demandPoolRequests} small request(s) below your minimum order could be served together via DemandPool (${qty}${unit})`,
    });
    remainder = round2(remainder - qty);
  }
  if (remainder > 0 && routingStage === 'DONATION') {
    suggestions.push({
      type: 'RECORD_DISPOSITION',
      quantity: remainder,
      message: `Past its sales window. Donate or put ${remainder}${unit} to alternative use, and record it`,
    });
  } else if (remainder > 0) {
    suggestions.push({
      type: 'MOVE_TO_RESCUE',
      quantity: remainder,
      message:
        summary.potentialStrongTotal > 0
          ? `Move the remaining ${remainder}${unit} to Rescue`
          : `No strong demand remains on any route. Move ${remainder}${unit} to Rescue`,
    });
  }
  if (!suggestions.length) {
    suggestions.push({ type: 'NONE', quantity: 0, message: 'Nothing left to recover — all produce is allocated' });
  }
  return suggestions;
}

export async function startRecovery(user, batchId, { trigger } = {}, ip) {
  const result = await runMatching(user, batchId, { runType: 'RECOVERY', trigger: trigger || 'MANUAL', ip });
  const opts = { routingStage: result.batch.routing?.stage, primaryRoute: result.batch.primaryRoute };
  const suggestions = buildRecoverySuggestions(result.run.summary, result.batch.unit, opts);
  const stage = recoveryStage(result.run.summary, opts);
  // Route comparison over the channels that remain eligible after the run's exclusions.
  const routes = compactAssessment(await assessBatch(await findBatchById(batchId)));
  const extra = { suggestions, stage, primaryRoute: opts.primaryRoute || null, ...routes };
  await query(`UPDATE match_runs SET summary = summary || $1::jsonb WHERE id = $2`, [JSON.stringify(extra), result.run.id]);
  return { ...result, recovery: { ...result.run.summary, ...extra } };
}

/** Latest recovery run for a batch (if any) alongside current matches. */
export async function getRecovery(user, batchId) {
  const data = await getMatchesForBatch(user, batchId);
  assertFarmAccess(user, data.batch.farmId);
  const { rows } = await query(
    `SELECT * FROM match_runs WHERE harvest_batch_id = $1 AND run_type = 'RECOVERY' ORDER BY created_at DESC, id DESC LIMIT 1`,
    [batchId]
  );
  const run = rows[0] ? camelize(rows[0]) : null;
  return { ...data, recoveryRun: run, recovery: run?.summary || null };
}
