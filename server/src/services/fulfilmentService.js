/**
 * Fulfilment terms and cost (proposal v3 §8.4, §17): logistics responsibility differs by transaction, so
 * Tyllage estimates the cost of each route/order from the farm's own per-method figures instead of
 * assuming farm delivery. Estimates are farm-private and advisory.
 */
import { COLLECTION_METHODS, DEFAULT_FULFILMENT_COSTS, LOGISTICS_RESPONSIBILITY } from '../config/rules.js';
import { round2 } from '../utils/numbers.js';

/** The farm's cost figures, with platform defaults for any method it has not recorded. */
export function fulfilmentCostsFor(farmCosts) {
  const costs = {};
  for (const m of COLLECTION_METHODS) {
    const own = farmCosts?.[m];
    costs[m] = {
      perOrder: Number(own?.perOrder ?? DEFAULT_FULFILMENT_COSTS[m].perOrder),
      perKg: Number(own?.perKg ?? DEFAULT_FULFILMENT_COSTS[m].perKg),
    };
  }
  return costs;
}

/** The buyer's preferred method when the farm offers it, otherwise buyer pickup at the farm. */
export function resolveMethod(preferred, offered = []) {
  return preferred && offered.includes(preferred) ? preferred : 'FARM_PICKUP';
}

/** Estimated cost of fulfilling `orders` order(s) totalling `quantity` with one method. */
export function estimateFulfilment(method, quantity, farmCosts, orders = 1) {
  const c = fulfilmentCostsFor(farmCosts)[method] || { perOrder: 0, perKg: 0 };
  const qty = Number(quantity) || 0;
  const total = round2(c.perOrder * orders + c.perKg * qty);
  return {
    method,
    responsibility: LOGISTICS_RESPONSIBILITY[method] || 'BUYER',
    total,
    perKg: qty > 0 ? round2(total / qty) : 0,
  };
}
