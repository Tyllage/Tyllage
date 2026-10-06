import { z } from 'zod';
import { withTransaction, query } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelize, camelizeAll } from '../utils/case.js';
import { notFound, conflict } from '../utils/errors.js';
import { assertFarmAdmin } from './farmAccessService.js';
import { createAllocatedOrder } from './allocationService.js';
import { MATCH_SELECT } from './harvestMatchService.js';
import { findBatchById, toBatchDTO } from '../models/harvestModel.js';
import { logAudit } from './auditService.js';
import { notifyBuyer } from './notificationService.js';

const approveSchema = z.object({
  quantity: z.coerce.number().positive('must be greater than 0').max(100000).optional(),
  note: z.string().trim().max(500).optional(),
});
const rejectSchema = z.object({ reason: z.string().trim().max(500).optional() });

async function lockMatch(client, id) {
  const { rows } = await client.query('SELECT * FROM harvest_matches WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw notFound('Match not found');
  return rows[0];
}

async function loadMatch(id, client) {
  const runner = client || { query };
  const { rows } = await runner.query(`${MATCH_SELECT} WHERE hm.id = $1`, [id]);
  return rows[0] ? camelize(rows[0]) : null;
}

/**
 * Farm admin approves a HarvestMatch suggestion (optionally with an edited quantity).
 * Creates the order, order item and allocation atomically; over-allocation is rejected.
 */
export async function approveMatch(user, matchId, input, ip) {
  const d = validate(approveSchema, input);
  const result = await withTransaction(async (client) => {
    const match = await lockMatch(client, matchId);
    assertFarmAdmin(user, match.farm_id);
    if (match.status !== 'SUGGESTED') {
      throw conflict(`This match has already been ${match.status.toLowerCase()}`, 'MATCH_NOT_PENDING');
    }
    const quantity = d.quantity ?? Number(match.recommended_quantity);

    const buyer = (await client.query('SELECT preferred_collection_method FROM buyer_profiles WHERE id = $1', [match.buyer_id])).rows[0];
    const farm = (await client.query('SELECT fulfilment_methods FROM farms WHERE id = $1', [match.farm_id])).rows[0];
    const collectionMethod = farm.fulfilment_methods.includes(buyer.preferred_collection_method)
      ? buyer.preferred_collection_method
      : 'FARM_PICKUP';

    const { order } = await createAllocatedOrder(client, {
      batchId: match.harvest_batch_id,
      buyerId: match.buyer_id,
      demandRequestId: match.demand_request_id,
      quantity,
      unitPrice: Number(match.unit_price),
      source: match.source === 'RECOVERY' ? 'RECOVERY' : 'HARVESTMATCH',
      status: 'CONFIRMED',
      collectionMethod,
      userId: user.id,
    });

    await client.query(
      `UPDATE harvest_matches SET status = 'APPROVED', approved_quantity = $1, order_id = $2, decision_note = $3,
              decided_by = $4, decided_at = NOW()
        WHERE id = $5`,
      [quantity, order.id, d.note || null, user.id, matchId]
    );
    await logAudit(
      {
        farmId: match.farm_id, userId: user.id, action: 'MATCH_APPROVED', entityType: 'harvest_match', entityId: matchId,
        details: { orderId: order.id, quantity, recommended: Number(match.recommended_quantity), unitPrice: Number(match.unit_price) }, ip,
      },
      client
    );
    return { match: await loadMatch(matchId, client), batch: toBatchDTO(await findBatchById(match.harvest_batch_id, client)), order };
  });

  const m = result.match;
  await notifyBuyer({
    buyerId: m.buyerId,
    farmId: m.farmId,
    type: 'ORDER_CONFIRMED',
    title: `Order #${result.order.id} confirmed`,
    body: `${result.batch.farmName} has confirmed ${m.approvedQuantity}${result.batch.unit} of ${result.batch.produceName} for ${result.batch.harvestDate} at $${Number(m.unitPrice).toFixed(2)}/${result.batch.unit}.`,
  });
  return { match: result.match, batch: result.batch, orderId: result.order.id };
}

export async function rejectMatch(user, matchId, input, ip) {
  const d = validate(rejectSchema, input);
  return withTransaction(async (client) => {
    const match = await lockMatch(client, matchId);
    assertFarmAdmin(user, match.farm_id);
    if (match.status !== 'SUGGESTED') {
      throw conflict(`This match has already been ${match.status.toLowerCase()}`, 'MATCH_NOT_PENDING');
    }
    await client.query(
      `UPDATE harvest_matches SET status = 'REJECTED', decision_note = $1, decided_by = $2, decided_at = NOW() WHERE id = $3`,
      [d.reason || null, user.id, matchId]
    );
    await logAudit(
      { farmId: match.farm_id, userId: user.id, action: 'MATCH_REJECTED', entityType: 'harvest_match', entityId: matchId, details: { reason: d.reason }, ip },
      client
    );
    return { match: await loadMatch(matchId, client) };
  });
}

/** Recent match decisions/suggestions across a farm's batches. */
export async function listMatchesForFarm(farmId, { status } = {}) {
  const params = [farmId];
  let where = 'hm.farm_id = $1 AND hm.status <> \'SUPERSEDED\'';
  if (status) {
    params.push(status.split(','));
    where += ` AND hm.status = ANY($${params.length}::text[])`;
  }
  const { rows } = await query(
    `SELECT hm.id, hm.harvest_batch_id, hm.demand_request_id, hm.source, hm.match_score, hm.recommended_quantity,
            hm.approved_quantity, hm.unit_price, hm.expected_revenue, hm.status, hm.order_id, hm.decided_at, hm.created_at, hm.market_route,
            bp.organisation_name AS buyer_name, bp.buyer_type, p.name AS produce_name, hb.harvest_date
       FROM harvest_matches hm
       JOIN buyer_profiles bp ON bp.id = hm.buyer_id
       JOIN harvest_batches hb ON hb.id = hm.harvest_batch_id
       JOIN produce p ON p.id = hb.produce_id
      WHERE ${where} ORDER BY hm.created_at DESC LIMIT 200`,
    params
  );
  return camelizeAll(rows);
}

/** Buyer view: matches the farm has approved for the buyer's demand (never internal suggestions). */
export async function listMatchesForBuyer(user) {
  if (!user.buyerId) return [];
  const { rows } = await query(
    `SELECT hm.id, hm.match_score, hm.reasons, hm.approved_quantity, hm.unit_price, hm.decided_at, hm.order_id,
            dr.id AS demand_request_id, dr.produce_name, dr.unit, dr.quantity AS demand_quantity, dr.required_date,
            hb.harvest_date, f.name AS farm_name, o.status AS order_status
       FROM harvest_matches hm
       JOIN demand_requests dr ON dr.id = hm.demand_request_id
       JOIN harvest_batches hb ON hb.id = hm.harvest_batch_id
       JOIN farms f ON f.id = hm.farm_id
       LEFT JOIN orders o ON o.id = hm.order_id
      WHERE hm.buyer_id = $1 AND hm.status = 'APPROVED'
      ORDER BY hm.decided_at DESC`,
    [user.buyerId]
  );
  return camelizeAll(rows);
}
