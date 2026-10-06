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

  const farmMoq = Number(batch.min_order_quantity || 0);
  if (p.demandRequestId) {
    const demand = await lockDemand(client, p.demandRequestId);
    if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(demand.status)) {
      throw conflict('This demand request is no longer open', 'DEMAND_NOT_OPEN');
    }
    const demandRemaining = round2(demand.quantity - demand.fulfilled_quantity);
    if (quantity > demandRemaining) {
      throw conflict(`Buyer only needs ${demandRemaining}${demand.unit} more`, 'DEMAND_EXCEEDED');
    }
    // Minimum order quantities (a final top-up that completes the request is always allowed).
    if (demand.min_quantity && quantity < Number(demand.min_quantity) && quantity < demandRemaining) {
      throw conflict(`Buyer's minimum delivery is ${demand.min_quantity}${demand.unit}`, 'BELOW_BUYER_MINIMUM');
    }
    if (p.enforceFarmMoq !== false && farmMoq > 0 && quantity < farmMoq && quantity < demandRemaining) {
      throw conflict(`Below the farm minimum order of ${farmMoq}${batch.unit} (use DemandPool to combine small requests)`, 'BELOW_FARM_MINIMUM');
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
 * Direct (bulk) order from available supply: several lines from one farm in one order, status PENDING
 * until the farm confirms. Each line reserves stock immediately, so it can never be oversold; any
 * failing line rolls back the whole order.
 */
export async function createMultiLineOrder(client, { buyerId, lines, collectionMethod, notes, userId }) {
  if (!lines.length) throw badRequest('Add at least one item', 'VALIDATION_ERROR');
  const ids = [...new Set(lines.map((l) => l.batchId))].sort((a, b) => a - b);
  if (ids.length !== lines.length) throw badRequest('Each batch can appear only once per order', 'VALIDATION_ERROR');

  const batches = new Map();
  for (const id of ids) {
    const b = await lockBatch(id, client); // locked in id order to avoid deadlocks
    if (!b) throw notFound(`Harvest batch ${id} not found`);
    if (b.status === 'CLOSED') throw conflict(`${b.produce_name} is no longer available`, 'BATCH_CLOSED');
    batches.set(id, b);
  }
  const farmIds = new Set([...batches.values()].map((b) => b.farm_id));
  if (farmIds.size !== 1) throw badRequest('A single order can only contain produce from one farm', 'MULTI_FARM_ORDER');
  const farmId = [...farmIds][0];
  const method = collectionMethod || 'FARM_PICKUP';
  const offered = [...batches.values()][0].fulfilment_methods || [];
  if (!offered.includes(method)) {
    throw badRequest(`This farm does not offer ${method.toLowerCase().replace('_', ' ')}`, 'COLLECTION_METHOD_UNAVAILABLE');
  }

  let total = 0;
  const priced = lines.map((l) => {
    const b = batches.get(l.batchId);
    const quantity = round2(l.quantity);
    if (!(quantity > 0)) throw badRequest('Quantity must be greater than 0', 'VALIDATION_ERROR');
    if (quantity > Number(b.remaining_quantity)) {
      throw conflict(`Only ${Math.max(0, b.remaining_quantity)}${b.unit} of ${b.produce_name} is available`, 'OVER_ALLOCATION');
    }
    const moq = Number(b.min_order_quantity || 0);
    if (moq > 0 && quantity < moq) {
      throw conflict(`Minimum order for ${b.produce_name} is ${moq}${b.unit}`, 'BELOW_FARM_MINIMUM');
    }
    const lineTotal = round2(quantity * Number(b.preferred_price));
    total = round2(total + lineTotal);
    return { b, quantity, unitPrice: Number(b.preferred_price), lineTotal };
  });

  const scheduled = priced.map((x) => x.b.harvest_date).sort().at(-1);
  const order = await client.query(
    `INSERT INTO orders (farm_id, buyer_id, status, source, collection_method, scheduled_date, total_amount, notes, created_by)
     VALUES ($1, $2, 'PENDING', 'DIRECT', $3, $4, $5, $6, $7) RETURNING *`,
    [farmId, buyerId, collectionMethod || 'FARM_PICKUP', scheduled, total, notes || null, userId]
  );
  for (const x of priced) {
    const item = await client.query(
      `INSERT INTO order_items (order_id, produce_id, harvest_batch_id, quantity, unit_price, line_total)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [order.rows[0].id, x.b.produce_id, x.b.id, x.quantity, x.unitPrice, x.lineTotal]
    );
    await client.query(
      'INSERT INTO allocations (farm_id, harvest_batch_id, order_item_id, quantity) VALUES ($1, $2, $3, $4)',
      [farmId, x.b.id, item.rows[0].id, x.quantity]
    );
    await syncBatchStatus(x.b.id, client);
  }
  return order.rows[0];
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
