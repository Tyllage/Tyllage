/**
 * Allocation core. All stock changes go through here, inside a transaction, with the harvest batch
 * row locked (SELECT ... FOR UPDATE). Remaining stock is always recomputed from the batch_stock view
 * after the lock, so concurrent approvals can never over-allocate.
 */
import { notFound, conflict, badRequest } from '../utils/errors.js';
import { round2 } from '../utils/numbers.js';
import { lockBatch, syncBatchStatus } from '../models/harvestModel.js';

async function lockDemand(client, demandId) {
  const { rows } = await client.query('SELECT * FROM demand_requests WHERE id = $1 FOR UPDATE', [demandId]);
  if (!rows[0]) throw notFound('Demand request not found');
  return rows[0];
}

function demandStatusFor(quantity, fulfilled, current) {
  if (['CANCELLED', 'EXPIRED'].includes(current)) return current;
  if (fulfilled <= 0) return 'OPEN';
  return fulfilled >= quantity ? 'FULFILLED' : 'PARTIALLY_FULFILLED';
}

/**
 * Creates order + order item + allocation for `quantity` of a batch.
 * Rejects with OVER_ALLOCATION if the quantity exceeds what is unallocated
 * (or what remains on the Rescue listing, for Rescue reservations).
 */
export async function createAllocatedOrder(client, p) {
  const quantity = round2(p.quantity);
  if (!(quantity > 0)) throw badRequest('Quantity must be greater than 0', 'VALIDATION_ERROR');

  const batch = await lockBatch(p.batchId, client);
  if (!batch) throw notFound('Harvest batch not found');
  if (batch.status === 'CLOSED') throw conflict('This harvest batch is closed', 'BATCH_CLOSED');

  if (p.rescueListingId) {
    await client.query('SELECT id FROM rescue_listings WHERE id = $1 FOR UPDATE', [p.rescueListingId]);
    const { rows } = await client.query(
      `SELECT rl.*, rs.available_quantity FROM rescue_listings rl
         JOIN rescue_stock rs ON rs.rescue_listing_id = rl.id
        WHERE rl.id = $1`,
      [p.rescueListingId]
    );
    const listing = rows[0];
    if (!listing || listing.harvest_batch_id !== batch.id) throw notFound('Rescue listing not found');
    if (listing.status !== 'ACTIVE' || new Date(listing.collection_deadline) <= new Date()) {
      throw conflict('This Rescue listing is no longer available', 'RESCUE_UNAVAILABLE');
    }
    if (quantity > Number(listing.available_quantity)) {
      throw conflict(`Only ${listing.available_quantity}${batch.unit} left on this Rescue listing`, 'OVER_ALLOCATION');
    }
  } else if (quantity > Number(batch.remaining_quantity)) {
    throw conflict(
      `Cannot allocate ${quantity}${batch.unit}: only ${Math.max(0, batch.remaining_quantity)}${batch.unit} of ${batch.produce_name} is unallocated`,
      'OVER_ALLOCATION'
    );
  }

  if (p.demandRequestId) {
    const demand = await lockDemand(client, p.demandRequestId);
    if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(demand.status)) {
      throw conflict('This demand request is no longer open', 'DEMAND_NOT_OPEN');
    }
    const demandRemaining = round2(demand.quantity - demand.fulfilled_quantity);
    if (quantity > demandRemaining) {
      throw conflict(`Buyer only needs ${demandRemaining}${demand.unit} more`, 'DEMAND_EXCEEDED');
    }
    const fulfilled = round2(Number(demand.fulfilled_quantity) + quantity);
    await client.query(
      'UPDATE demand_requests SET fulfilled_quantity = $1, status = $2, updated_at = NOW() WHERE id = $3',
      [fulfilled, demandStatusFor(Number(demand.quantity), fulfilled, demand.status), demand.id]
    );
  }

  const lineTotal = round2(quantity * p.unitPrice);
  const order = await client.query(
    `INSERT INTO orders (farm_id, buyer_id, status, source, collection_method, scheduled_date, total_amount, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [batch.farm_id, p.buyerId, p.status || 'CONFIRMED', p.source, p.collectionMethod || 'FARM_PICKUP',
      p.scheduledDate || batch.harvest_date, lineTotal, p.notes || null, p.userId]
  );
  const orderId = order.rows[0].id;
  const item = await client.query(
    `INSERT INTO order_items (order_id, produce_id, harvest_batch_id, demand_request_id, quantity, unit_price, line_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [orderId, batch.produce_id, batch.id, p.demandRequestId || null, quantity, p.unitPrice, lineTotal]
  );
  await client.query(
    `INSERT INTO allocations (farm_id, harvest_batch_id, order_item_id, rescue_listing_id, quantity)
     VALUES ($1, $2, $3, $4, $5)`,
    [batch.farm_id, batch.id, item.rows[0].id, p.rescueListingId || null, quantity]
  );

  if (p.rescueListingId) {
    await client.query(
      `UPDATE rescue_listings rl SET status = 'SOLD_OUT', updated_at = NOW()
         FROM rescue_stock rs WHERE rs.rescue_listing_id = rl.id AND rl.id = $1 AND rs.available_quantity <= 0`,
      [p.rescueListingId]
    );
  }
  await syncBatchStatus(batch.id, client);
  return { order: order.rows[0], batch };
}

/**
 * Releases every active allocation of an order (used on cancellation): stock returns to the batch,
 * demand fulfilment is reversed, and sold-out Rescue listings reopen if still within their deadline.
 */
export async function releaseOrderAllocations(client, orderId) {
  const { rows } = await client.query(
    `SELECT a.id, a.harvest_batch_id, a.rescue_listing_id, a.quantity, oi.demand_request_id
       FROM allocations a JOIN order_items oi ON oi.id = a.order_item_id
      WHERE oi.order_id = $1 AND a.status = 'ACTIVE'`,
    [orderId]
  );
  const released = [];
  for (const a of rows) {
    // Lock in batch-first order (same as createAllocatedOrder) to avoid deadlocks.
    await lockBatch(a.harvest_batch_id, client);
    await client.query("UPDATE allocations SET status = 'RELEASED', released_at = NOW() WHERE id = $1", [a.id]);
    if (a.demand_request_id) {
      const demand = await lockDemand(client, a.demand_request_id);
      const fulfilled = Math.max(0, round2(Number(demand.fulfilled_quantity) - Number(a.quantity)));
      await client.query(
        'UPDATE demand_requests SET fulfilled_quantity = $1, status = $2, updated_at = NOW() WHERE id = $3',
        [fulfilled, demandStatusFor(Number(demand.quantity), fulfilled, demand.status), demand.id]
      );
    }
    if (a.rescue_listing_id) {
      await client.query(
        `UPDATE rescue_listings SET status = 'ACTIVE', updated_at = NOW()
          WHERE id = $1 AND status = 'SOLD_OUT' AND collection_deadline > NOW()`,
        [a.rescue_listing_id]
      );
    }
    await syncBatchStatus(a.harvest_batch_id, client);
    released.push(a);
  }
  return released;
}
