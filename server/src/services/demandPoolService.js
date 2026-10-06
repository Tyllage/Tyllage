/**
 * DemandPool — buyer aggregation. Several small requests (each below the farm's minimum order) for the
 * same produce and timing are combined into one commercially viable farm order: Many Buyers → One Viable
 * Farm Order. Optionally fulfilled together through a Community Drop. Created atomically: all orders or none.
 */
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelizeAll } from '../utils/case.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { round2 } from '../utils/numbers.js';
import { listBatches, lockBatch } from '../models/harvestModel.js';
import { assertFarmAccess, assertFarmAdmin } from './farmAccessService.js';
import { scoreProduce, scoreDate, scorePrice, loadOpenDemandForFarm } from './harvestMatchService.js';
import { createAllocatedOrder } from './allocationService.js';
import { getPolicy } from './policyService.js';
import { logAudit } from './auditService.js';
import { notifyBuyer } from './notificationService.js';

const createSchema = z.object({
  farmId: z.coerce.number().int().positive(),
  harvestBatchId: z.coerce.number().int().positive(),
  demandRequestIds: z.array(z.coerce.number().int().positive()).min(2, 'A DemandPool needs at least two requests').max(50),
  communityDropId: z.coerce.number().int().positive().nullable().optional(),
});

const fits = (batch, d) => !(scoreProduce(batch, d).exclude || scoreDate(batch, d).exclude || scorePrice(batch, d).exclude);
const viableMinimum = (batch) => Math.max(Number(batch.min_order_quantity || 0), getPolicy().demandPoolMinViableKg);

/** Proposed pools per open batch: compatible requests that are each too small to serve alone. */
export async function listSuggestions(user, farmId) {
  assertFarmAccess(user, farmId);
  const [batches, demand] = await Promise.all([listBatches(farmId), loadOpenDemandForFarm(farmId)]);
  const out = [];
  for (const b of batches) {
    if (Number(b.remaining_quantity) <= 0) continue;
    const minimum = viableMinimum(b);
    const members = demand
      .filter((d) => fits(b, d) && Number(d.quantity) - Number(d.fulfilled_quantity) < minimum)
      .sort((x, y) => x.required_date.localeCompare(y.required_date))
      .map((d) => ({
        demandRequestId: d.id,
        buyerName: d.organisation_name,
        buyerType: d.buyer_type,
        region: d.region,
        quantity: round2(Number(d.quantity) - Number(d.fulfilled_quantity)),
        requiredDate: d.required_date,
        unitPrice: scorePrice(b, d).unitPrice,
      }));
    if (members.length < 2) continue;
    const total = round2(members.reduce((s, m) => s + m.quantity, 0));
    out.push({
      harvestBatchId: b.id,
      produceName: b.produce_name,
      unit: b.unit,
      harvestDate: b.harvest_date,
      availableQuantity: round2(b.remaining_quantity),
      viableMinimum: minimum,
      totalQuantity: total,
      isViable: total >= minimum,
      fitsSupply: total <= Number(b.remaining_quantity),
      expectedRevenue: round2(members.reduce((s, m) => s + m.quantity * m.unitPrice, 0)),
      members,
    });
  }
  return out;
}

export async function createPool(user, input, ip) {
  const d = validate(createSchema, input);
  assertFarmAdmin(user, d.farmId);

  const result = await withTransaction(async (client) => {
    const batch = await lockBatch(d.harvestBatchId, client);
    if (!batch || batch.farm_id !== d.farmId) throw notFound('Harvest batch not found for this farm');
    if (d.communityDropId) {
      const drop = await client.query(`SELECT id FROM community_drops WHERE id = $1 AND farm_id = $2 AND status = 'SCHEDULED'`, [d.communityDropId, d.farmId]);
      if (!drop.rowCount) throw badRequest('Community Drop not found or not scheduled', 'VALIDATION_ERROR');
    }
    const open = await loadOpenDemandForFarm(d.farmId, client);
    const members = d.demandRequestIds.map((id) => {
      const m = open.find((x) => x.id === id);
      if (!m) throw conflict(`Demand request #${id} is no longer open to this farm`, 'DEMAND_NOT_OPEN');
      if (!fits(batch, m)) throw conflict(`Demand request #${id} does not fit this batch`, 'POOL_INCOMPATIBLE');
      return { demand: m, quantity: round2(Number(m.quantity) - Number(m.fulfilled_quantity)), unitPrice: scorePrice(batch, m).unitPrice };
    });
    const total = round2(members.reduce((s, m) => s + m.quantity, 0));
    const minimum = viableMinimum(batch);
    if (total < minimum) throw conflict(`Pooled total ${total}${batch.unit} is below the viable minimum of ${minimum}${batch.unit}`, 'POOL_NOT_VIABLE');

    const pool = await client.query(
      `INSERT INTO demand_pools (farm_id, harvest_batch_id, community_drop_id, total_quantity, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [d.farmId, batch.id, d.communityDropId ?? null, total, user.id]
    );
    for (const m of members) {
      // Pooled orders are exempt from the per-order farm MOQ — that is the point of pooling.
      const { order } = await createAllocatedOrder(client, {
        batchId: batch.id,
        buyerId: m.demand.buyer_id,
        demandRequestId: m.demand.id,
        quantity: m.quantity,
        unitPrice: m.unitPrice,
        source: 'DEMANDPOOL',
        status: 'CONFIRMED',
        collectionMethod: d.communityDropId ? 'COMMUNITY_DROP' : 'FARM_PICKUP',
        enforceFarmMoq: false,
        userId: user.id,
      });
      if (d.communityDropId) await client.query('UPDATE orders SET community_drop_id = $1 WHERE id = $2', [d.communityDropId, order.id]);
      await client.query(
        'INSERT INTO demand_pool_members (pool_id, demand_request_id, order_id, quantity) VALUES ($1, $2, $3, $4)',
        [pool.rows[0].id, m.demand.id, order.id, m.quantity]
      );
      m.orderId = order.id;
    }
    await logAudit({ farmId: d.farmId, userId: user.id, action: 'DEMANDPOOL_CREATED', entityType: 'demand_pool', entityId: pool.rows[0].id, details: { members: members.length, total }, ip }, client);
    return { pool: pool.rows[0], members, batch };
  });

  for (const m of result.members) {
    await notifyBuyer({
      buyerId: m.demand.buyer_id,
      farmId: d.farmId,
      type: 'ORDER_CONFIRMED',
      title: `Order #${m.orderId} confirmed`,
      body: `${result.batch.farm_name} grouped your ${m.quantity}${result.batch.unit} ${result.batch.produce_name} request with nearby buyers.`,
    });
  }
  return (await listPools(user, d.farmId)).find((p) => p.id === result.pool.id);
}

export async function listPools(user, farmId) {
  assertFarmAccess(user, farmId);
  const { rows } = await query(
    `SELECT dp.*, p.name AS produce_name, p.unit, hb.harvest_date, cd.community_name,
            COALESCE((SELECT json_agg(json_build_object('demandRequestId', m.demand_request_id, 'orderId', m.order_id,
                       'quantity', m.quantity, 'buyerName', bp.organisation_name, 'orderStatus', o.status))
                        FROM demand_pool_members m
                        JOIN demand_requests dr ON dr.id = m.demand_request_id
                        JOIN buyer_profiles bp ON bp.id = dr.buyer_id
                        LEFT JOIN orders o ON o.id = m.order_id
                       WHERE m.pool_id = dp.id), '[]') AS members
       FROM demand_pools dp
       JOIN harvest_batches hb ON hb.id = dp.harvest_batch_id
       JOIN produce p ON p.id = hb.produce_id
       LEFT JOIN community_drops cd ON cd.id = dp.community_drop_id
      WHERE dp.farm_id = $1 ORDER BY dp.created_at DESC`,
    [farmId]
  );
  return camelizeAll(rows);
}
