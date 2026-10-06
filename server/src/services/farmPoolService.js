/**
 * FarmPool — cross-farm supply aggregation. A buyer's open-market request (flagged allow_pooling) can be
 * fulfilled by several farms together. Each farm commits a quantity from one of its batches; every
 * contribution becomes that farm's own order (it fulfils its own portion). The demand row lock prevents
 * farms collectively over-committing. Other farms are shown anonymised — only quantities are shared.
 */
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { notFound, conflict } from '../utils/errors.js';
import { round2 } from '../utils/numbers.js';
import { listBatches } from '../models/harvestModel.js';
import { assertFarmAccess, assertFarmAdmin } from './farmAccessService.js';
import { scoreProduce, scoreDate, scorePrice } from './harvestMatchService.js';
import { createAllocatedOrder } from './allocationService.js';
import { logAudit } from './auditService.js';
import { notifyBuyer } from './notificationService.js';

const contributeSchema = z.object({
  farmId: z.coerce.number().int().positive(),
  harvestBatchId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive().max(100000),
});

const POOL_SELECT = `
  SELECT dr.*, bp.organisation_name AS buyer_name, bp.buyer_type, bp.region, bp.preferred_collection_method
    FROM demand_requests dr JOIN buyer_profiles bp ON bp.id = dr.buyer_id AND bp.is_active
   WHERE dr.allow_pooling AND dr.farm_id IS NULL`;

/** Why a batch can't serve a demand, or null if it can (produce, timing and price must all fit). */
function incompatibility(batch, demand) {
  return scoreProduce(batch, demand).exclude || scoreDate(batch, demand).exclude || scorePrice(batch, demand).exclude || null;
}

export async function listFarmPool(user, farmId) {
  assertFarmAccess(user, farmId);
  const [{ rows: demands }, batches] = await Promise.all([
    query(`${POOL_SELECT} AND (dr.status IN ('OPEN', 'PARTIALLY_FULFILLED') OR dr.updated_at > NOW() - INTERVAL '14 days') ORDER BY dr.required_date`),
    listBatches(farmId),
  ]);
  if (!demands.length) return [];

  const { rows: contributions } = await query(
    `SELECT oi.demand_request_id, o.farm_id, o.id AS order_id, o.status, oi.quantity, oi.unit_price, oi.harvest_batch_id
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.demand_request_id = ANY($1::int[]) AND o.status <> 'CANCELLED'`,
    [demands.map((d) => d.id)]
  );

  return demands.map((d) => {
    const mine = contributions.filter((c) => c.demand_request_id === d.id && c.farm_id === farmId);
    const others = contributions.filter((c) => c.demand_request_id === d.id && c.farm_id !== farmId);
    const otherFarms = [...new Set(others.map((c) => c.farm_id))];
    const open = ['OPEN', 'PARTIALLY_FULFILLED'].includes(d.status);
    return {
      demandRequestId: d.id,
      buyerName: d.buyer_name,
      buyerType: d.buyer_type,
      produceName: d.produce_name,
      unit: d.unit,
      requiredDate: d.required_date,
      maxPrice: d.max_price,
      status: d.status,
      targetQuantity: Number(d.quantity),
      committedQuantity: Number(d.fulfilled_quantity),
      remainingQuantity: round2(Number(d.quantity) - Number(d.fulfilled_quantity)),
      contributingFarms: otherFarms.length + (mine.length ? 1 : 0),
      // Other farms are anonymised: confidential farm details are never shared through FarmPool.
      otherContributions: otherFarms.map((fid, i) => ({
        label: `Partner farm ${i + 1}`,
        quantity: round2(others.filter((c) => c.farm_id === fid).reduce((s, c) => s + Number(c.quantity), 0)),
      })),
      myContributions: mine.map((c) => ({ orderId: c.order_id, harvestBatchId: c.harvest_batch_id, quantity: Number(c.quantity), unitPrice: Number(c.unit_price), status: c.status })),
      eligibleBatches: open
        ? batches
            .filter((b) => Number(b.remaining_quantity) > 0 && !incompatibility(b, d))
            .map((b) => ({
              id: b.id,
              produceName: b.produce_name,
              harvestDate: b.harvest_date,
              availableQuantity: round2(b.remaining_quantity),
              unitPrice: scorePrice(b, d).unitPrice,
            }))
        : [],
    };
  });
}

export async function contribute(user, demandId, input, ip) {
  const d = validate(contributeSchema, input);
  assertFarmAdmin(user, d.farmId);
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(`${POOL_SELECT} AND dr.id = $1`, [demandId]);
    const demand = rows[0];
    if (!demand) throw notFound('FarmPool request not found');
    const batch = (await listBatches(d.farmId)).find((b) => b.id === d.harvestBatchId);
    if (!batch) throw notFound('Harvest batch not found for this farm');
    const reason = incompatibility(batch, demand);
    if (reason) throw conflict(`This batch can't serve the request: ${reason}`, 'POOL_INCOMPATIBLE');

    const farm = (await client.query('SELECT fulfilment_methods FROM farms WHERE id = $1', [d.farmId])).rows[0];
    const { order } = await createAllocatedOrder(client, {
      batchId: batch.id,
      buyerId: demand.buyer_id,
      demandRequestId: demand.id,
      quantity: d.quantity,
      unitPrice: scorePrice(batch, demand).unitPrice,
      source: 'FARMPOOL',
      status: 'CONFIRMED',
      collectionMethod: farm.fulfilment_methods.includes(demand.preferred_collection_method) ? demand.preferred_collection_method : 'FARM_PICKUP',
      userId: user.id,
    });
    await logAudit({ farmId: d.farmId, userId: user.id, action: 'FARMPOOL_CONTRIBUTED', entityType: 'demand_request', entityId: demand.id, details: { orderId: order.id, quantity: d.quantity, harvestBatchId: batch.id }, ip }, client);
    return { order, demand, batch };
  });

  await notifyBuyer({
    buyerId: result.demand.buyer_id,
    farmId: d.farmId,
    type: 'FARMPOOL_CONTRIBUTION',
    title: `FarmPool: ${d.quantity}${result.demand.unit} of ${result.demand.produce_name} committed`,
    body: `${result.batch.farm_name} will supply part of your request (order #${result.order.id}).`,
  });
  return { orderId: result.order.id, pool: (await listFarmPool(user, d.farmId)).find((p) => p.demandRequestId === demandId) };
}
