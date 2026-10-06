/**
 * HarvestMatch — transparent weighted scoring that ranks existing demand against a harvest batch.
 *
 * This is NOT machine learning. Every score is a documented rule (see config/rules.js) and every
 * recommendation carries human-readable reasons. The farm admin approves or rejects each one.
 */
import { withTransaction, query } from '../config/db.js';
import {
  MATCH_WEIGHTS,
  FRESHNESS_WINDOW_DAYS,
  NEUTRAL_RELIABILITY_SCORE,
  ADJACENT_REGIONS,
  STRONG_MATCH_THRESHOLD,
  buyerChannel,
} from '../config/rules.js';
import { round2 } from '../utils/numbers.js';
import { addDays, daysBetween } from '../utils/dates.js';
import { camelize } from '../utils/case.js';
import { notFound, conflict } from '../utils/errors.js';
import { lockBatch, findBatchById, toBatchDTO } from '../models/harvestModel.js';
import { getReliabilityStats } from './buyerService.js';
import { assertFarmAccess, assertFarmAdmin } from './farmAccessService.js';
import { logAudit } from './auditService.js';

const LABEL = {
  FARM_PICKUP: 'farm pickup',
  DELIVERY: 'delivery',
  COMMUNITY_DROP: 'community drop',
};
const money = (n) => `$${Number(n).toFixed(2)}`;
const normalise = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Next occurrence of a recurring requirement on/after the harvest date. */
export function effectiveRequiredDate(demand, harvestDate) {
  const step = { WEEKLY: 7, BIWEEKLY: 14 }[demand.recurrence];
  let date = demand.required_date;
  if (demand.recurrence === 'NONE' || date >= harvestDate) return date;
  for (let i = 0; i < 60 && date < harvestDate; i++) {
    if (step) date = addDays(date, step);
    else {
      const [y, m, d] = date.split('-').map(Number);
      const next = new Date(y, m, d); // +1 month
      date = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    }
  }
  return date;
}

// ---- individual factor scores (0-100). Each returns { score, reason?, warning?, exclude? } ----

export function scoreProduce(batch, demand) {
  if (demand.produce_id && demand.produce_id === batch.produce_id) return { score: 100, reason: 'Exact produce match' };
  const a = normalise(batch.produce_name);
  const b = normalise(demand.produce_name);
  if (a === b) return { score: 100, reason: 'Exact produce match' };
  if (a.includes(b) || b.includes(a)) {
    return { score: 75, reason: `Close produce match (${demand.produce_name} ≈ ${batch.produce_name})` };
  }
  return { score: 0, exclude: 'Different produce' };
}

export function scoreDate(batch, demand) {
  const required = effectiveRequiredDate(demand, batch.harvest_date);
  const gap = daysBetween(batch.harvest_date, required);
  if (gap < 0) return { score: 0, exclude: `Required ${-gap} day(s) before harvest date`, required };
  if (gap > FRESHNESS_WINDOW_DAYS) {
    return { score: 0, exclude: `Required ${gap} days after harvest — beyond ${FRESHNESS_WINDOW_DAYS}-day freshness window`, required };
  }
  if (gap <= 2) return { score: 100, reason: 'Required date matches harvest window', required };
  if (gap <= 4) return { score: 75, reason: `Required ${gap} days after harvest`, required };
  return { score: 45, reason: `Required ${gap} days after harvest`, warning: `Produce will be ${gap} days post-harvest at fulfilment`, required };
}

/** Price compatibility. Also returns the unit price the order would use. */
export function scorePrice(batch, demand) {
  const min = Number(batch.min_price);
  const preferred = Number(batch.preferred_price);
  const max = demand.max_price === null || demand.max_price === undefined ? null : Number(demand.max_price);

  if (max === null) {
    return {
      score: 70,
      unitPrice: preferred,
      reason: 'Buyer has not set a price — farm preferred price applied',
      warning: 'Confirm price with buyer',
    };
  }
  if (max < min) {
    return { score: 0, unitPrice: null, exclude: `Buyer max price ${money(max)} is below farm minimum ${money(min)}` };
  }
  if (max >= preferred) return { score: 100, unitPrice: preferred, reason: 'Buyer price meets farm preferred price' };
  const span = preferred - min;
  const score = span > 0 ? Math.round(50 + (50 * (max - min)) / span) : 100;
  return { score, unitPrice: max, reason: `Buyer price ${money(max)} meets farm minimum` };
}

export function scoreQuantity(demandRemaining, supplyRemaining, unit = 'kg') {
  if (supplyRemaining <= 0) return { score: 0, exclude: 'No unallocated supply remaining' };
  if (demandRemaining <= supplyRemaining) return { score: 100, reason: 'Requested quantity fits available supply' };
  const ratio = supplyRemaining / demandRemaining;
  return {
    score: Math.max(20, Math.round(ratio * 100)),
    reason: `Can partially supply ${round2(supplyRemaining)}${unit} of ${round2(demandRemaining)}${unit} requested`,
  };
}

export function scoreReliability(stats) {
  if (!stats) return { score: NEUTRAL_RELIABILITY_SCORE, reason: 'Limited order history — neutral reliability score applied' };
  const score = Math.round((stats.completed / stats.total) * 100);
  return {
    score,
    reason: `Completed ${stats.completed} of ${stats.total} past orders`,
    warning: score < 50 ? 'Buyer has a history of cancellations' : undefined,
  };
}

export function scoreLocation(batch, buyer) {
  const methods = batch.fulfilment_methods || [];
  const method = buyer.preferred_collection_method;
  let score;
  let reason;
  if (!buyer.region || !batch.farm_region) {
    score = 60;
    reason = 'Location not specified — neutral location score';
  } else if (buyer.region === batch.farm_region) {
    score = 100;
    reason = 'Buyer is in the same region as the farm';
  } else if ((ADJACENT_REGIONS[batch.farm_region] || []).includes(buyer.region)) {
    score = 75;
    reason = 'Buyer is in a neighbouring region';
  } else {
    score = 50;
    reason = 'Buyer is in a distant region';
  }
  if (method && !methods.includes(method)) {
    return { score: Math.round(score * 0.4), reason, warning: `Buyer prefers ${LABEL[method]}, which the farm does not currently offer` };
  }
  return { score, reason: `${reason}; ${LABEL[method] || 'collection'} supported` };
}

/**
 * Scores one demand candidate against a batch. Pure function: no I/O.
 * Returns { excluded: true, reason } or a scored candidate with weighted total and reasons.
 */
export function scoreCandidate(batch, demand, { supplyRemaining, reliability }) {
  const demandRemaining = round2(Number(demand.quantity) - Number(demand.fulfilled_quantity || 0));
  const factors = {
    produce: scoreProduce(batch, demand),
    date: scoreDate(batch, demand),
    price: scorePrice(batch, demand),
    quantity: scoreQuantity(demandRemaining, supplyRemaining, batch.unit),
    reliability: scoreReliability(reliability),
    location: scoreLocation(batch, demand),
  };
  const blocker = Object.values(factors).find((f) => f.exclude);
  if (blocker) return { excluded: true, reason: blocker.exclude };

  let total = 0;
  const breakdown = {};
  for (const [key, weight] of Object.entries(MATCH_WEIGHTS)) {
    const contribution = (factors[key].score * weight) / 100;
    total += contribution;
    breakdown[key] = { score: factors[key].score, weight, contribution: round2(contribution) };
  }

  return {
    excluded: false,
    matchScore: Math.round(total),
    breakdown,
    reasons: Object.values(factors).map((f) => f.reason).filter(Boolean),
    warnings: Object.values(factors).map((f) => f.warning).filter(Boolean),
    unitPrice: factors.price.unitPrice,
    demandRemaining,
    effectiveRequiredDate: factors.date.required,
  };
}

/**
 * Ranks candidates and assigns recommended quantities greedily in score order so the
 * total recommended never exceeds the batch's unallocated quantity.
 */
export function rankAndAllocate(batch, candidates, context) {
  const supply = round2(Number(batch.remaining_quantity));
  const scored = [];
  const excluded = [];

  for (const demand of candidates) {
    const exclusion = context.exclusions?.get(demand.id);
    if (exclusion) {
      excluded.push(describeExcluded(demand, exclusion));
      continue;
    }
    const result = scoreCandidate(batch, demand, {
      supplyRemaining: supply,
      reliability: context.reliability?.get(demand.buyer_id) ?? null,
    });
    if (result.excluded) {
      if (result.reason !== 'Different produce') excluded.push(describeExcluded(demand, result.reason));
      continue;
    }
    scored.push({ demand, ...result });
  }

  scored.sort((a, b) => b.matchScore - a.matchScore || a.effectiveRequiredDate.localeCompare(b.effectiveRequiredDate) || a.demand.id - b.demand.id);

  let remaining = supply;
  const matches = [];
  for (const c of scored) {
    const qty = round2(Math.min(c.demandRemaining, remaining));
    if (qty <= 0) {
      excluded.push(describeExcluded(c.demand, 'No supply left after higher-ranked matches'));
      continue;
    }
    remaining = round2(remaining - qty);
    matches.push({ ...c, recommendedQuantity: qty, expectedRevenue: round2(qty * c.unitPrice) });
  }
  return { matches, excluded, supply, unmatchedQuantity: remaining };
}

function describeExcluded(demand, reason) {
  return {
    demandRequestId: demand.id,
    buyerId: demand.buyer_id,
    buyerName: demand.organisation_name,
    buyerType: demand.buyer_type,
    quantity: round2(Number(demand.quantity) - Number(demand.fulfilled_quantity || 0)),
    reason,
  };
}

// ---------------------------------------------------------------- persistence

/** Open demand this farm may serve, joined with buyer info needed for scoring. */
async function loadCandidates(client, batch) {
  const { rows } = await client.query(
    `SELECT dr.*, bp.organisation_name, bp.buyer_type, bp.region, bp.preferred_collection_method
       FROM demand_requests dr
       JOIN buyer_profiles bp ON bp.id = dr.buyer_id AND bp.is_active
      WHERE dr.status IN ('OPEN', 'PARTIALLY_FULFILLED')
        AND dr.quantity > dr.fulfilled_quantity
        AND (dr.farm_id IS NULL OR dr.farm_id = $1)`,
    [batch.farm_id]
  );
  return rows;
}

/**
 * Demand that must not be recommended for this batch:
 *  - the farm already rejected this demand for this batch;
 *  - the buyer cancelled an order on this batch (don't immediately re-offer the same stock).
 */
async function loadExclusions(client, batchId) {
  const exclusions = new Map();
  const rejected = await client.query(
    `SELECT DISTINCT demand_request_id FROM harvest_matches WHERE harvest_batch_id = $1 AND status = 'REJECTED'`,
    [batchId]
  );
  for (const r of rejected.rows) exclusions.set(r.demand_request_id, 'Previously rejected by farm for this batch');

  const cancelledBuyers = await client.query(
    `SELECT DISTINCT o.buyer_id FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE oi.harvest_batch_id = $1 AND o.status = 'CANCELLED'`,
    [batchId]
  );
  return { exclusions, cancelledBuyerIds: new Set(cancelledBuyers.rows.map((r) => r.buyer_id)) };
}

/**
 * Runs HarvestMatch (or Demand Recovery) for a batch and stores the suggestions.
 * Previous unactioned suggestions for the batch are superseded. Nothing is allocated here —
 * allocation only happens when the farm admin approves a match.
 */
export async function runMatching(user, batchId, { runType = 'HARVESTMATCH', trigger = null, ip } = {}, existingClient) {
  return withTransaction(async (client) => {
    const batch = await lockBatch(batchId, client);
    if (!batch) throw notFound('Harvest batch not found');
    assertFarmAdmin(user, batch.farm_id);
    if (batch.status === 'CLOSED') throw conflict('Matching cannot run on a closed batch', 'BATCH_CLOSED');

    const candidates = await loadCandidates(client, batch);
    const { exclusions, cancelledBuyerIds } = await loadExclusions(client, batchId);
    for (const c of candidates) {
      if (!exclusions.has(c.id) && cancelledBuyerIds.has(c.buyer_id)) {
        exclusions.set(c.id, 'Buyer cancelled an order for this batch');
      }
    }
    const reliability = await getReliabilityStats([...new Set(candidates.map((c) => c.buyer_id))], client);
    const result = rankAndAllocate(batch, candidates, { exclusions, reliability });

    await client.query(
      `UPDATE harvest_matches SET status = 'SUPERSEDED' WHERE harvest_batch_id = $1 AND status = 'SUGGESTED'`,
      [batchId]
    );
    const summary = buildSummary(result);
    const run = await client.query(
      `INSERT INTO match_runs (farm_id, harvest_batch_id, run_type, trigger_reason, remaining_quantity,
                               candidates_count, excluded, summary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [batch.farm_id, batchId, runType, trigger, result.supply, result.matches.length,
        JSON.stringify(result.excluded), JSON.stringify(summary), user.id]
    );
    const runId = run.rows[0].id;

    for (const m of result.matches) {
      await client.query(
        `INSERT INTO harvest_matches (farm_id, run_id, harvest_batch_id, demand_request_id, buyer_id, source, match_score,
                                      score_breakdown, reasons, warnings, recommended_quantity, unit_price, expected_revenue)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [batch.farm_id, runId, batchId, m.demand.id, m.demand.buyer_id, runType, m.matchScore,
          JSON.stringify(m.breakdown), JSON.stringify(m.reasons), JSON.stringify(m.warnings),
          m.recommendedQuantity, m.unitPrice, m.expectedRevenue]
      );
    }

    await logAudit(
      {
        farmId: batch.farm_id,
        userId: user.id,
        action: runType === 'RECOVERY' ? 'RECOVERY_STARTED' : 'HARVESTMATCH_RUN',
        entityType: 'harvest_batch',
        entityId: batchId,
        details: { runId, trigger, matches: result.matches.length, excluded: result.excluded.length },
        ip,
      },
      client
    );

    return { run: camelize(run.rows[0]), ...(await getMatchesForBatch(user, batchId, client)) };
  }, existingClient);
}

/** Groups strong matches by channel for the recovery view; weak matches are reported separately. */
function buildSummary(result) {
  const channels = { BUSINESS: 0, COMMUNITY: 0, CONSUMER: 0 };
  let strongTotal = 0;
  let weakTotal = 0;
  for (const m of result.matches) {
    if (m.matchScore >= STRONG_MATCH_THRESHOLD) {
      channels[buyerChannel(m.demand.buyer_type)] = round2(channels[buyerChannel(m.demand.buyer_type)] + m.recommendedQuantity);
      strongTotal = round2(strongTotal + m.recommendedQuantity);
    } else {
      weakTotal = round2(weakTotal + m.recommendedQuantity);
    }
  }
  return {
    remainingAtStart: result.supply,
    strongMatchThreshold: STRONG_MATCH_THRESHOLD,
    potentialByChannel: channels,
    potentialStrongTotal: strongTotal,
    potentialWeakTotal: weakTotal,
    remainingAfterStrong: round2(result.supply - strongTotal),
  };
}

const MATCH_SELECT = `
  SELECT hm.*, bp.organisation_name AS buyer_name, bp.buyer_type, bp.region AS buyer_region,
         bp.preferred_collection_method,
         dr.quantity AS demand_quantity, dr.fulfilled_quantity AS demand_fulfilled_quantity,
         dr.required_date, dr.max_price, dr.recurrence, dr.produce_name AS demand_produce_name,
         u.full_name AS decided_by_name
    FROM harvest_matches hm
    JOIN buyer_profiles bp ON bp.id = hm.buyer_id
    JOIN demand_requests dr ON dr.id = hm.demand_request_id
    LEFT JOIN users u ON u.id = hm.decided_by`;

/** Current suggestions plus decided matches for a batch, with the latest run's exclusions. */
export async function getMatchesForBatch(user, batchId, client) {
  const runner = client || { query };
  const batchRow = (await runner.query('SELECT farm_id FROM harvest_batches WHERE id = $1', [batchId])).rows[0];
  if (!batchRow) throw notFound('Harvest batch not found');
  assertFarmAccess(user, batchRow.farm_id);

  const batch = toBatchDTO(await findBatchById(batchId, client));
  const { rows } = await runner.query(
    `${MATCH_SELECT} WHERE hm.harvest_batch_id = $1 AND hm.status <> 'SUPERSEDED'
      ORDER BY (hm.status = 'SUGGESTED') DESC, hm.match_score DESC, hm.id`,
    [batchId]
  );
  const lastRun = (
    await runner.query('SELECT * FROM match_runs WHERE harvest_batch_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [batchId])
  ).rows[0];

  return {
    batch,
    matches: rows.map(camelize),
    lastRun: lastRun ? camelize(lastRun) : null,
  };
}

export { MATCH_SELECT };
