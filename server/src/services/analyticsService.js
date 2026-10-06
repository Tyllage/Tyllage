/**
 * Analytics derived only from database records. When a denominator is zero (no data), the metric is
 * returned with value null and `sufficient: false` so the UI shows "Not enough data yet" instead of
 * inventing a number.
 */
import { query } from '../config/db.js';
import { percent, round2 } from '../utils/numbers.js';
import { todayISO } from '../utils/dates.js';
import { buyerChannel } from '../config/rules.js';
import { listBatches, toBatchDTO } from '../models/harvestModel.js';

// ---------------------------------------------------------------- pure formulas

export function metric(numerator, denominator, formula) {
  const value = percent(numerator, denominator, 1);
  return {
    value,
    numerator: round2(numerator || 0),
    denominator: round2(denominator || 0),
    sufficient: value !== null,
    formula,
  };
}

/** Sold Quantity / Actual Harvest × 100 */
export const sellThroughRate = (sold, harvested) => metric(sold, harvested, 'Sold Quantity ÷ Actual Harvest × 100');

/** Confirmed Demand / Expected Harvest × 100 */
export const demandCoverageRate = (confirmed, expected) => metric(confirmed, expected, 'Confirmed Demand ÷ Expected Harvest × 100');

/** Recovered At-Risk Produce / Total At-Risk Produce × 100 */
export const rescueRate = (recovered, atRisk) =>
  metric(Math.min(recovered, atRisk), atRisk, 'Recovered At-Risk Produce ÷ Total At-Risk Produce × 100');

/** Revenue From Largest Buyer / Total Revenue × 100 */
export function channelConcentration(revenueByBuyer) {
  const values = revenueByBuyer.map(Number).filter((v) => v > 0);
  const total = values.reduce((s, v) => s + v, 0);
  const largest = values.length ? Math.max(...values) : 0;
  return metric(largest, total, 'Revenue From Largest Buyer ÷ Total Revenue × 100');
}

/** Returning Buyers / Total Buyers × 100 (returning = 2+ non-cancelled orders) */
export function repeatBuyerRate(orderCountsByBuyer) {
  const buyers = orderCountsByBuyer.filter((c) => c >= 1);
  const returning = buyers.filter((c) => c >= 2);
  return metric(returning.length, buyers.length, 'Returning Buyers ÷ Total Buyers × 100');
}

/** Approved Matches / Generated Matches × 100 */
export const matchConversionRate = (approved, generated) => metric(approved, generated, 'Approved Matches ÷ Generated Matches × 100');

// ---------------------------------------------------------------- aggregation

const SOLD_STATUSES = ['CONFIRMED', 'READY', 'COMPLETED'];

export async function getFarmAnalytics(farmId) {
  const today = todayISO();

  const [sales, harvested, buyers, matches, atRisk, rescue, topProduce, weekly, openBatches] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(oi.line_total), 0) AS revenue, COALESCE(SUM(oi.quantity), 0) AS quantity,
              COUNT(DISTINCT o.id) AS orders
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.farm_id = $1 AND o.status = ANY($2::text[])`,
      [farmId, SOLD_STATUSES]
    ),
    // Sell-through only considers batches that have been harvested (harvest date today or earlier).
    query(
      `SELECT COALESCE(SUM(COALESCE(hb.actual_quantity, hb.expected_quantity)), 0) AS harvested,
              COALESCE(SUM((SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                              WHERE oi.harvest_batch_id = hb.id AND o.status = ANY($3::text[]))), 0) AS sold
         FROM harvest_batches hb WHERE hb.farm_id = $1 AND hb.harvest_date <= $2`,
      [farmId, today, SOLD_STATUSES]
    ),
    query(
      `SELECT bp.id, bp.organisation_name, bp.buyer_type,
              COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = ANY($2::text[])), 0) AS revenue
         FROM orders o JOIN buyer_profiles bp ON bp.id = o.buyer_id
        WHERE o.farm_id = $1 AND o.status <> 'CANCELLED'
        GROUP BY bp.id`,
      [farmId, SOLD_STATUSES]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
              COUNT(*) FILTER (WHERE status IN ('APPROVED', 'REJECTED', 'SUGGESTED')) AS generated,
              COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected
         FROM harvest_matches WHERE farm_id = $1`,
      [farmId]
    ),
    // At-risk produce = quantity unallocated when Demand Recovery first started for a batch.
    // Recovered = quantity allocated (incl. Rescue sales) on that batch after that point.
    query(
      `WITH first_run AS (
         SELECT DISTINCT ON (harvest_batch_id) harvest_batch_id, remaining_quantity, created_at
           FROM match_runs WHERE farm_id = $1 AND run_type = 'RECOVERY'
          ORDER BY harvest_batch_id, created_at ASC
       )
       SELECT COALESCE(SUM(fr.remaining_quantity), 0) AS at_risk,
              COALESCE(SUM(LEAST(fr.remaining_quantity,
                (SELECT COALESCE(SUM(a.quantity), 0) FROM allocations a
                  WHERE a.harvest_batch_id = fr.harvest_batch_id AND a.status = 'ACTIVE' AND a.created_at >= fr.created_at))), 0) AS recovered
         FROM first_run fr`,
      [farmId]
    ),
    query(
      `SELECT COALESCE(SUM(CASE WHEN rl.status = 'CANCELLED' THEN rs.sold_quantity ELSE rl.quantity END), 0) AS listed,
              COALESCE(SUM(rs.sold_quantity), 0) AS sold,
              COALESCE(SUM(rs.available_quantity) FILTER (WHERE rl.status = 'ACTIVE'), 0) AS active_available
         FROM rescue_listings rl JOIN rescue_stock rs ON rs.rescue_listing_id = rl.id WHERE rl.farm_id = $1`,
      [farmId]
    ),
    query(
      `SELECT p.name, p.unit, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN produce p ON p.id = oi.produce_id
        WHERE o.farm_id = $1 AND o.status = ANY($2::text[])
        GROUP BY p.id ORDER BY revenue DESC LIMIT 5`,
      [farmId, SOLD_STATUSES]
    ),
    query(
      `SELECT to_char(date_trunc('week', o.created_at), 'YYYY-MM-DD') AS week, SUM(o.total_amount) AS revenue, COUNT(*) AS orders
         FROM orders o WHERE o.farm_id = $1 AND o.status = ANY($2::text[]) AND o.created_at > NOW() - INTERVAL '8 weeks'
        GROUP BY 1 ORDER BY 1`,
      [farmId, SOLD_STATUSES]
    ),
    listBatches(farmId),
  ]);

  const batches = openBatches.map(toBatchDTO);
  const expected = batches.reduce((s, b) => s + b.harvestQuantity, 0);
  const confirmed = batches.reduce((s, b) => s + b.confirmedDemand, 0);
  const atRiskNow = batches.reduce((s, b) => s + b.atRiskQuantity, 0);

  const s = sales.rows[0];
  const h = harvested.rows[0];
  const m = matches.rows[0];
  const r = rescue.rows[0];
  const ar = atRisk.rows[0];

  const revenueByChannel = { BUSINESS: 0, COMMUNITY: 0, CONSUMER: 0 };
  for (const b of buyers.rows) revenueByChannel[buyerChannel(b.buyer_type)] = round2(revenueByChannel[buyerChannel(b.buyer_type)] + Number(b.revenue));
  const largestBuyer = [...buyers.rows].sort((a, b) => b.revenue - a.revenue)[0];

  return {
    totals: {
      revenue: round2(s.revenue),
      orders: s.orders,
      soldQuantity: round2(s.quantity),
      atRiskQuantity: round2(atRiskNow),
      rescueListedQuantity: round2(r.listed),
      rescueSoldQuantity: round2(r.sold),
      rescueActiveQuantity: round2(r.active_available),
      matchesGenerated: m.generated,
      matchesApproved: m.approved,
      matchesRejected: m.rejected,
    },
    metrics: {
      sellThrough: sellThroughRate(Number(h.sold), Number(h.harvested)),
      demandCoverage: demandCoverageRate(confirmed, expected),
      rescueRate: rescueRate(Number(ar.recovered), Number(ar.at_risk)),
      channelConcentration: {
        ...channelConcentration(buyers.rows.map((b) => b.revenue)),
        largestBuyer: largestBuyer && Number(largestBuyer.revenue) > 0 ? largestBuyer.organisation_name : null,
      },
      repeatBuyerRate: repeatBuyerRate(buyers.rows.map((b) => b.orders)),
      matchConversion: matchConversionRate(m.approved, m.generated),
    },
    topProduce: topProduce.rows.map((p) => ({ name: p.name, unit: p.unit, quantity: round2(p.quantity), revenue: round2(p.revenue) })),
    revenueByChannel,
    // A trend needs at least two data points; otherwise the UI shows "Not enough data yet".
    weeklyRevenue: {
      sufficient: weekly.rows.length >= 2,
      points: weekly.rows.map((w) => ({ week: w.week, revenue: round2(w.revenue), orders: w.orders })),
    },
  };
}
