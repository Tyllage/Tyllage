/**
 * Farm dashboard (Demand Radar): expected harvest against confirmed and potential demand, the strongest
 * commercial route for each exposed batch, and what needs action.
 */
import { query } from '../config/db.js';
import { round2, percent } from '../utils/numbers.js';
import { listBatches, toBatchDTO } from '../models/harvestModel.js';
import { riskLevel } from './riskService.js';
import { listRecoveryCandidates } from './recoveryService.js';
import { expireListings } from './rescueService.js';
import { getPolicy } from './policyService.js';
import { loadOpenDemandForFarm, potentialDemandFor } from './harvestMatchService.js';
import { assessFarmBatches } from './marketRouteService.js';
import { ROUTE_LABELS } from '../config/rules.js';

const sum = (arr, key) => round2(arr.reduce((s, x) => s + Number(x[key] || 0), 0));

export async function getDashboard(farmId) {
  await expireListings();
  const [batchRows, orders, pendingMatches, drafts, expiringRescue, recovery] = await Promise.all([
    listBatches(farmId),
    query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('PENDING', 'CONFIRMED', 'READY')) AS active,
              COUNT(*) FILTER (WHERE status = 'PENDING') AS pending
         FROM orders WHERE farm_id = $1`,
      [farmId]
    ),
    query(
      `SELECT harvest_batch_id, COUNT(*) AS count FROM harvest_matches
        WHERE farm_id = $1 AND status = 'SUGGESTED' GROUP BY harvest_batch_id`,
      [farmId]
    ),
    query(`SELECT COUNT(*) AS count FROM campaigns WHERE farm_id = $1 AND status = 'DRAFT'`, [farmId]),
    query(
      `SELECT rl.id, p.name AS produce_name, rs.available_quantity, rl.collection_deadline
         FROM rescue_listings rl JOIN rescue_stock rs ON rs.rescue_listing_id = rl.id
         JOIN harvest_batches hb ON hb.id = rl.harvest_batch_id JOIN produce p ON p.id = hb.produce_id
        WHERE rl.farm_id = $1 AND rl.status = 'ACTIVE' AND rl.collection_deadline < NOW() + INTERVAL '24 hours'
          AND rs.available_quantity > 0`,
      [farmId]
    ),
    listRecoveryCandidates(farmId),
  ]);

  // Demand Radar: open, unconfirmed demand that fits each batch's produce and timing,
  // plus MarketRoute's recommended route for whatever is still unallocated.
  const openDemand = await loadOpenDemandForFarm(farmId);
  const routes = await assessFarmBatches(farmId, batchRows);
  const batches = batchRows.map((row) => {
    const a = routes.get(row.id);
    const top = a?.routes.find((r) => r.key === a.recommendedRoute);
    return {
      ...toBatchDTO(row),
      potentialDemand: potentialDemandFor(row, openDemand),
      marketRoute: a ? { recommendedRoute: a.recommendedRoute, label: top?.label || null, score: top?.score ?? null, plan: a.plan } : null,
    };
  });
  const pendingByBatch = new Map(pendingMatches.rows.map((r) => [r.harvest_batch_id, r.count]));
  const expected = sum(batches, 'harvestQuantity');
  const confirmed = sum(batches, 'confirmedDemand');
  const coverage = percent(confirmed, expected, 1);

  // Proposal §8.1 view: expected harvest vs confirmed demand per produce, across open batches.
  const byProduce = new Map();
  for (const b of batches) {
    const p = byProduce.get(b.produceName) || { produceName: b.produceName, unit: b.unit, expectedHarvest: 0, confirmedDemand: 0, potentialDemand: 0, unallocated: 0, batches: 0 };
    p.expectedHarvest = round2(p.expectedHarvest + b.harvestQuantity);
    p.confirmedDemand = round2(p.confirmedDemand + b.confirmedDemand);
    p.potentialDemand = round2(p.potentialDemand + b.potentialDemand.quantity);
    p.unallocated = round2(p.unallocated + b.unallocatedQuantity);
    p.batches += 1;
    byProduce.set(b.produceName, p);
  }
  const radar = [...byProduce.values()].map((p) => {
    const coverage = percent(p.confirmedDemand, p.expectedHarvest, 1);
    return { ...p, demandCoverage: coverage, riskLevel: riskLevel(coverage) };
  });

  const kpis = {
    expectedHarvest: expected,
    confirmedDemand: confirmed,
    potentialDemand: round2(batches.reduce((s, b) => s + b.potentialDemand.quantity, 0)),
    demandCoverage: coverage,
    riskLevel: riskLevel(coverage),
    unallocatedProduce: sum(batches, 'unallocatedQuantity'),
    atRiskProduce: sum(batches, 'atRiskQuantity'),
    activeOrders: orders.rows[0].active,
    rescueQuantity: sum(batches, 'rescueQuantity'),
  };

  const actions = [];
  for (const c of recovery) {
    const pending = pendingByBatch.get(c.id) || 0;
    if (pending) {
      actions.push({
        type: 'REVIEW_MATCHES', priority: 1, harvestBatchId: c.id,
        message: `${pending} HarvestMatch suggestion(s) awaiting approval for ${c.produceName}`,
      });
    } else if (c.riskLevel === 'HIGH' && !c.lastRecoveryAt) {
      const rec = routes.get(c.id)?.recommendedRoute;
      actions.push({
        type: 'COMPARE_ROUTES', priority: 1, harvestBatchId: c.id,
        message: `${c.produceName}: only ${c.demandCoverage ?? 0}% demand coverage, ${c.unallocatedQuantity}${c.unit} unallocated — compare routes${rec ? ` (MarketRoute suggests ${ROUTE_LABELS[rec]})` : ''}`,
      });
    } else if (c.triggers.some((t) => t.code === 'BUYER_CANCELLED')) {
      actions.push({
        type: 'RECOVER_DEMAND', priority: 1, harvestBatchId: c.id,
        message: `${c.cancelledQuantity}${c.unit} of ${c.produceName} released by a cancellation — recover demand`,
      });
    } else {
      actions.push({
        type: 'RECOVER_DEMAND', priority: 2, harvestBatchId: c.id,
        message: `${c.unallocatedQuantity}${c.unit} of ${c.produceName} still unallocated — recover demand or move to Rescue`,
      });
    }
  }
  // Dynamic Routing: late-stage stock needs a route change (clearance, donation).
  for (const b of batches) {
    if (b.routing?.active && ['CLEARANCE', 'DONATION'].includes(b.routing.stage)) {
      actions.push({
        type: 'ROUTING', priority: b.routing.stage === 'DONATION' ? 1 : 2, harvestBatchId: b.id,
        message: `${b.produceName} is at "${b.routing.label}" (day ${b.routing.daysSinceHarvest} of ${b.routing.shelfLifeDays}) — ${b.routing.advice.toLowerCase()}`,
      });
    }
  }
  if (orders.rows[0].pending) {
    actions.push({ type: 'CONFIRM_ORDERS', priority: 2, message: `${orders.rows[0].pending} order(s) awaiting confirmation` });
  }
  for (const r of expiringRescue.rows) {
    actions.push({
      type: 'RESCUE_EXPIRING', priority: 2, rescueListingId: r.id,
      message: `${r.available_quantity}kg ${r.produce_name} Rescue listing closes within 24 hours`,
    });
  }
  if (drafts.rows[0].count) {
    actions.push({ type: 'APPROVE_CAMPAIGNS', priority: 3, message: `${drafts.rows[0].count} campaign draft(s) awaiting review` });
  }
  actions.sort((a, b) => a.priority - b.priority);

  return {
    kpis,
    // Suggestions on a batch with nothing left to allocate aren't actionable.
    upcomingHarvest: batches.map((b) => ({ ...b, pendingMatches: b.unallocatedQuantity > 0 ? pendingByBatch.get(b.id) || 0 : 0 })),
    radar,
    actions,
    rules: { riskThresholds: getPolicy().riskThresholds, atRiskWindowDays: getPolicy().atRiskWindowDays, routeWeights: getPolicy().routeWeights },
  };
}
