/**
 * Demand Recovery — when produce is left unallocated (buyer cancels, harvest exceeds demand, coverage
 * stays low), re-run matching against remaining eligible demand and recommend next steps.
 * Nothing is executed automatically: every suggestion requires farm admin approval.
 */
import { query } from '../config/db.js';
import { camelize } from '../utils/case.js';
import { round2 } from '../utils/numbers.js';
import { listBatches, toBatchDTO } from '../models/harvestModel.js';
import { runMatching, getMatchesForBatch } from './harvestMatchService.js';
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

/** Turns a recovery run summary into explicit, approval-required suggestions. */
export function buildRecoverySuggestions(summary, unit = 'kg') {
  const suggestions = [];
  if (summary.potentialStrongTotal > 0) {
    suggestions.push({
      type: 'APPROVE_MATCHES',
      quantity: summary.potentialStrongTotal,
      message: `Review and approve recovery matches for ${summary.potentialStrongTotal}${unit}`,
    });
  }
  const remainder = round2(summary.remainingAfterStrong);
  if (remainder > 0) {
    suggestions.push({
      type: 'MOVE_TO_RESCUE',
      quantity: remainder,
      message:
        summary.potentialStrongTotal > 0
          ? `Move the remaining ${remainder}${unit} to Rescue`
          : `No strong normal-market demand remains. Move ${remainder}${unit} to Rescue`,
    });
  }
  if (!suggestions.length) {
    suggestions.push({ type: 'NONE', quantity: 0, message: 'Nothing left to recover — all produce is allocated' });
  }
  return suggestions;
}

export async function startRecovery(user, batchId, { trigger } = {}, ip) {
  const result = await runMatching(user, batchId, { runType: 'RECOVERY', trigger: trigger || 'MANUAL', ip });
  const suggestions = buildRecoverySuggestions(result.run.summary, result.batch.unit);
  await query(`UPDATE match_runs SET summary = summary || $1::jsonb WHERE id = $2`, [
    JSON.stringify({ suggestions }),
    result.run.id,
  ]);
  return { ...result, recovery: { ...result.run.summary, suggestions } };
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
