import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelize, camelizeAll } from '../utils/case.js';
import { notFound, forbidden, conflict, badRequest } from '../utils/errors.js';
import { hasFarmAccess, assertFarmAdmin, isFarmSide } from './farmAccessService.js';
import { releaseOrderAllocations } from './allocationService.js';
import { logAudit } from './auditService.js';
import { notifyBuyer, notifyFarm } from './notificationService.js';

export const ORDER_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const statusSchema = z.object({
  status: z.enum(['CONFIRMED', 'READY', 'COMPLETED', 'CANCELLED']),
  reason: z.string().trim().max(500).optional(),
});

const ORDER_SELECT = `
  SELECT o.*, bp.organisation_name AS buyer_name, bp.buyer_type, f.name AS farm_name,
         cd.community_name, cd.collection_point, cd.drop_date,
         COALESCE((SELECT json_agg(json_build_object(
                    'id', oi.id, 'produceId', oi.produce_id, 'produceName', p.name, 'unit', p.unit,
                    'harvestBatchId', oi.harvest_batch_id, 'demandRequestId', oi.demand_request_id,
                    'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'lineTotal', oi.line_total) ORDER BY oi.id)
                     FROM order_items oi JOIN produce p ON p.id = oi.produce_id WHERE oi.order_id = o.id), '[]'::json) AS items
    FROM orders o
    JOIN buyer_profiles bp ON bp.id = o.buyer_id
    JOIN farms f ON f.id = o.farm_id
    LEFT JOIN community_drops cd ON cd.id = o.community_drop_id`;

export async function listOrdersForFarm(farmId, { status } = {}) {
  const params = [farmId];
  let where = 'o.farm_id = $1';
  if (status) {
    params.push(status.split(','));
    where += ` AND o.status = ANY($${params.length}::text[])`;
  }
  const { rows } = await query(`${ORDER_SELECT} WHERE ${where} ORDER BY o.created_at DESC LIMIT 300`, params);
  return camelizeAll(rows);
}

export async function listOrdersForBuyer(user) {
  if (!user.buyerId) return [];
  const { rows } = await query(`${ORDER_SELECT} WHERE o.buyer_id = $1 ORDER BY o.created_at DESC`, [user.buyerId]);
  return camelizeAll(rows);
}

async function loadOrder(id, client) {
  const runner = client || { query };
  const { rows } = await runner.query(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw notFound('Order not found');
  return rows[0];
}

function canView(user, order) {
  return (user.buyerId && order.buyer_id === user.buyerId) || (isFarmSide(user) && hasFarmAccess(user, order.farm_id));
}

export async function getOrder(user, id) {
  const order = await loadOrder(id);
  if (!canView(user, order)) throw forbidden();
  return camelize(order);
}

/**
 * Moves an order through its lifecycle. Farm staff handle fulfilment (confirm/ready/complete);
 * cancelling is restricted to farm admins or the buyer (while PENDING/CONFIRMED).
 * Cancellation releases allocations so stock becomes available for Demand Recovery.
 */
export async function updateOrderStatus(user, id, input, ip) {
  const { status, reason } = validate(statusSchema, input);

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const order = rows[0];
    if (!order) throw notFound('Order not found');

    const isBuyer = user.buyerId && order.buyer_id === user.buyerId;
    const isFarm = isFarmSide(user) && hasFarmAccess(user, order.farm_id);
    if (!isBuyer && !isFarm) throw forbidden();
    if (isBuyer && !isFarm && (status !== 'CANCELLED' || !['PENDING', 'CONFIRMED'].includes(order.status))) {
      throw forbidden('Buyers can only cancel pending or confirmed orders');
    }
    if (isFarm && status === 'CANCELLED') assertFarmAdmin(user, order.farm_id);

    if (!ORDER_TRANSITIONS[order.status].includes(status)) {
      throw conflict(`Cannot change an order from ${order.status} to ${status}`, 'INVALID_TRANSITION');
    }
    if (status === 'CANCELLED' && !reason && isFarm) {
      throw badRequest('A cancellation reason is required', 'VALIDATION_ERROR');
    }

    let released = [];
    if (status === 'CANCELLED') {
      released = await releaseOrderAllocations(client, id);
      await client.query(
        `UPDATE orders SET status = 'CANCELLED', cancelled_reason = $1, cancelled_by_party = $2, cancelled_at = NOW(), updated_at = NOW()
          WHERE id = $3`,
        [reason || null, isFarm ? 'FARM' : 'BUYER', id]
      );
    } else {
      await client.query(
        `UPDATE orders SET status = $1::varchar, completed_at = CASE WHEN $1::varchar = 'COMPLETED' THEN NOW() ELSE completed_at END, updated_at = NOW()
          WHERE id = $2`,
        [status, id]
      );
    }
    await logAudit(
      {
        farmId: order.farm_id, userId: user.id,
        action: status === 'CANCELLED' ? 'ORDER_CANCELLED' : 'ORDER_STATUS_UPDATED',
        entityType: 'order', entityId: id,
        details: { from: order.status, to: status, reason, releasedQuantity: released.reduce((s, a) => s + Number(a.quantity), 0) },
        ip,
      },
      client
    );
    return { order: await loadOrder(id, client), released, cancelledBy: isFarm ? 'FARM' : 'BUYER' };
  });

  const order = camelize(result.order);
  if (status === 'CANCELLED') {
    const qty = result.released.reduce((s, a) => s + Number(a.quantity), 0);
    if (result.cancelledBy === 'BUYER') {
      await notifyFarm({
        farmId: order.farmId,
        type: 'ORDER_CANCELLED',
        title: `${order.buyerName} cancelled order #${order.id}`,
        body: `${qty}kg returned to available stock. Consider running Demand Recovery.`,
      });
    } else {
      await notifyBuyer({ buyerId: order.buyerId, farmId: order.farmId, type: 'ORDER_CANCELLED', title: `Order #${order.id} cancelled`, body: reason || 'Cancelled by the farm.' });
    }
  } else {
    await notifyBuyer({
      buyerId: order.buyerId, farmId: order.farmId, type: `ORDER_${status}`,
      title: `Order #${order.id} is ${status.toLowerCase()}`,
      body: `${order.farmName}: your order is now ${status.toLowerCase()}.`,
    });
  }
  return order;
}
