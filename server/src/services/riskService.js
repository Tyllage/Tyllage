import { RISK_THRESHOLDS, AT_RISK_WINDOW_DAYS } from '../config/rules.js';
import { round2, percent } from '../utils/numbers.js';
import { todayISO, daysBetween } from '../utils/dates.js';

/** Demand Coverage = Confirmed Demand / Expected Harvest × 100. Null when there is no harvest quantity. */
export function demandCoverage(confirmedDemand, expectedHarvest) {
  return percent(confirmedDemand, expectedHarvest, 1);
}

/** Transparent rule-based risk level from coverage percent. */
export function riskLevel(coverage) {
  if (coverage === null || coverage === undefined) return null;
  if (coverage >= RISK_THRESHOLDS.LOW) return 'LOW';
  if (coverage >= RISK_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Derives the commercial metrics for one harvest batch from a row joined with batch_stock.
 * `atRiskQuantity` is unallocated produce that needs action: everything unallocated on a
 * MEDIUM/HIGH batch, or anything still unallocated when harvest is imminent or past.
 */
export function batchMetrics(row, today = todayISO()) {
  const harvestQuantity = Number(row.harvest_quantity);
  const confirmedDemand = Number(row.allocated_quantity);
  const rescueQuantity = Number(row.rescue_quantity || 0);
  const unallocated = Math.max(0, round2(Number(row.remaining_quantity)));
  const coverage = demandCoverage(confirmedDemand, harvestQuantity);
  const closed = row.status === 'CLOSED';
  const level = closed ? null : riskLevel(coverage);
  const daysToHarvest = daysBetween(today, row.harvest_date);
  const imminent = daysToHarvest <= AT_RISK_WINDOW_DAYS;

  let atRiskQuantity = 0;
  if (!closed && unallocated > 0 && (level === 'HIGH' || level === 'MEDIUM' || imminent)) {
    atRiskQuantity = unallocated;
  }

  return {
    harvestQuantity,
    confirmedDemand,
    rescueQuantity,
    unallocatedQuantity: unallocated,
    demandCoverage: coverage,
    riskLevel: level,
    atRiskQuantity,
    daysToHarvest,
  };
}

/**
 * Status derived from allocation state. CLOSED is terminal and only set explicitly.
 * PLANNED vs AVAILABLE depends on whether the farm has marked the batch available.
 */
export function deriveBatchStatus(row, today = todayISO()) {
  if (row.status === 'CLOSED') return 'CLOSED';
  const m = batchMetrics(row, today);
  const committed = m.confirmedDemand + m.rescueQuantity;
  if (m.unallocatedQuantity <= 0 && committed > 0) return 'FULLY_ALLOCATED';
  if (m.riskLevel === 'HIGH' && m.daysToHarvest <= AT_RISK_WINDOW_DAYS) return 'AT_RISK';
  if (committed > 0) return 'PARTIALLY_ALLOCATED';
  return row.marked_available ? 'AVAILABLE' : 'PLANNED';
}
