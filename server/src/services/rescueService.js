/**
 * Tyllage Rescue — alternative-channel sale of produce the FARM has determined is suitable for sale
 * (surplus, short-dated, cosmetic imperfections). Tyllage never assesses food safety itself; the farm
 * must explicitly confirm suitability when creating a listing.
 */
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelize, camelizeAll } from '../utils/case.js';
import { notFound, badRequest, conflict, forbidden } from '../utils/errors.js';
import { round2 } from '../utils/numbers.js';
import { lockBatch, syncBatchStatus, toBatchDTO, findBatchById } from '../models/harvestModel.js';
import { assertFarmAdmin, hasFarmAccess } from './farmAccessService.js';
import { createAllocatedOrder } from './allocationService.js';
import { logAudit } from './auditService.js';
import { notifyFarm } from './notificationService.js';
import { COLLECTION_METHODS } from '../config/rules.js';

export const RESCUE_REASONS = ['COSMETIC_IMPERFECTION', 'SURPLUS', 'SHORT_DATED', 'IRREGULAR_SIZE', 'OTHER'];
export const RESCUE_DISCLAIMER =
  'Rescue produce has been assessed as suitable for sale by the farm. Tyllage does not inspect produce.';
const MAX_DEADLINE_DAYS = 14;

const createSchema = z.object({
  harvestBatchId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('must be greater than 0').max(100000),
  rescuePrice: z.coerce.number().positive('must be greater than 0').max(100000),
  reason: z.enum(RESCUE_REASONS),
  reasonDetails: z.string().trim().max(500).nullable().optional(),
  collectionDeadline: z.iso.datetime({ offset: true, message: 'must be an ISO date-time' }),
  suitabilityConfirmed: z.literal(true, {
    message: 'The farm must confirm this produce is suitable for sale',
  }),
});
const updateSchema = z.object({
  rescuePrice: z.coerce.number().positive().max(100000).optional(),
  collectionDeadline: z.iso.datetime({ offset: true }).optional(),
});
const reserveSchema = z.object({
  quantity: z.coerce.number().positive('must be greater than 0').max(1000),
  collectionMethod: z.enum(COLLECTION_METHODS).optional(),
});

const LISTING_SELECT = `
  SELECT rl.*, rs.sold_quantity, rs.available_quantity, p.name AS produce_name, p.unit, p.category,
         f.name AS farm_name, f.is_demo AS farm_is_demo, hb.harvest_date, hb.grade
    FROM rescue_listings rl
    JOIN rescue_stock rs ON rs.rescue_listing_id = rl.id
    JOIN harvest_batches hb ON hb.id = rl.harvest_batch_id
    JOIN produce p ON p.id = hb.produce_id
    JOIN farms f ON f.id = rl.farm_id`;

export async function expireListings() {
  await query(`UPDATE rescue_listings SET status = 'EXPIRED', updated_at = NOW() WHERE status = 'ACTIVE' AND collection_deadline <= NOW()`);
}

function validateDeadline(iso) {
  const deadline = new Date(iso);
  const now = Date.now();
  if (deadline.getTime() <= now) throw badRequest('Collection deadline must be in the future', 'VALIDATION_ERROR');
  if (deadline.getTime() > now + MAX_DEADLINE_DAYS * 86400000) {
    throw badRequest(`Collection deadline must be within ${MAX_DEADLINE_DAYS} days`, 'VALIDATION_ERROR');
  }
}

export async function createListing(user, input, ip) {
  const d = validate(createSchema, input);
  validateDeadline(d.collectionDeadline);

  const id = await withTransaction(async (client) => {
    const batch = await lockBatch(d.harvestBatchId, client);
    if (!batch) throw notFound('Harvest batch not found');
    assertFarmAdmin(user, batch.farm_id);
    if (batch.status === 'CLOSED') throw conflict('This harvest batch is closed', 'BATCH_CLOSED');
    const quantity = round2(d.quantity);
    if (quantity > Number(batch.remaining_quantity)) {
      throw conflict(
        `Only ${Math.max(0, batch.remaining_quantity)}${batch.unit} of ${batch.produce_name} is unallocated`,
        'OVER_ALLOCATION'
      );
    }
    const originalPrice = Number(batch.preferred_price);
    if (d.rescuePrice > originalPrice) {
      throw badRequest(`Rescue price cannot exceed the original price ($${originalPrice.toFixed(2)})`, 'VALIDATION_ERROR');
    }

    const { rows } = await client.query(
      `INSERT INTO rescue_listings (farm_id, harvest_batch_id, quantity, original_price, rescue_price, reason, reason_details,
                                    collection_deadline, suitability_confirmed_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
      [batch.farm_id, batch.id, quantity, originalPrice, d.rescuePrice, d.reason, d.reasonDetails ?? null, d.collectionDeadline, user.id]
    );
    await syncBatchStatus(batch.id, client);
    await logAudit(
      { farmId: batch.farm_id, userId: user.id, action: 'RESCUE_CREATED', entityType: 'rescue_listing', entityId: rows[0].id,
        details: { harvestBatchId: batch.id, quantity, rescuePrice: d.rescuePrice, reason: d.reason, suitabilityConfirmed: true }, ip },
      client
    );
    return rows[0].id;
  });
  return getListingById(id);
}

async function getListingById(id) {
  const { rows } = await query(`${LISTING_SELECT} WHERE rl.id = $1`, [id]);
  if (!rows[0]) throw notFound('Rescue listing not found');
  return camelize(rows[0]);
}

export async function listForFarm(farmId) {
  await expireListings();
  const { rows } = await query(`${LISTING_SELECT} WHERE rl.farm_id = $1 ORDER BY rl.created_at DESC`, [farmId]);
  return camelizeAll(rows);
}

/** Consumer-facing listings: active, in date, with stock left. Never exposes farm cost/minimum price. */
export async function listPublic() {
  await expireListings();
  const { rows } = await query(
    `${LISTING_SELECT}
      WHERE rl.status = 'ACTIVE' AND rl.collection_deadline > NOW() AND rs.available_quantity > 0 AND f.is_active
      ORDER BY rl.collection_deadline ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    farmId: r.farm_id,
    farmName: r.farm_name,
    produceName: r.produce_name,
    unit: r.unit,
    originalPrice: r.original_price,
    rescuePrice: r.rescue_price,
    reason: r.reason,
    reasonDetails: r.reason_details,
    availableQuantity: r.available_quantity,
    collectionDeadline: r.collection_deadline,
    harvestDate: r.harvest_date,
    disclaimer: RESCUE_DISCLAIMER,
  }));
}

export async function updateListing(user, id, input, ip) {
  const d = validate(updateSchema, input);
  const listing = await getListingById(id);
  assertFarmAdmin(user, listing.farmId);
  if (listing.status !== 'ACTIVE') throw conflict('Only active listings can be edited', 'RESCUE_NOT_ACTIVE');
  if (d.rescuePrice && d.rescuePrice > listing.originalPrice) {
    throw badRequest('Rescue price cannot exceed the original price', 'VALIDATION_ERROR');
  }
  if (d.collectionDeadline) validateDeadline(d.collectionDeadline);
  await query(
    `UPDATE rescue_listings SET rescue_price = COALESCE($1, rescue_price), collection_deadline = COALESCE($2, collection_deadline),
            updated_at = NOW() WHERE id = $3`,
    [d.rescuePrice ?? null, d.collectionDeadline ?? null, id]
  );
  await logAudit({ farmId: listing.farmId, userId: user.id, action: 'RESCUE_UPDATED', entityType: 'rescue_listing', entityId: id, details: d, ip });
  return getListingById(id);
}

/** Cancels a listing; any unsold quantity returns to the batch (sold reservations stay). */
export async function cancelListing(user, id, ip) {
  const listing = await getListingById(id);
  assertFarmAdmin(user, listing.farmId);
  if (['CANCELLED'].includes(listing.status)) throw conflict('Listing is already cancelled', 'RESCUE_NOT_ACTIVE');
  await withTransaction(async (client) => {
    await lockBatch(listing.harvestBatchId, client);
    await client.query(`UPDATE rescue_listings SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [id]);
    await syncBatchStatus(listing.harvestBatchId, client);
    await logAudit({ farmId: listing.farmId, userId: user.id, action: 'RESCUE_CANCELLED', entityType: 'rescue_listing', entityId: id, ip }, client);
  });
  return getListingById(id);
}

/** A buyer/consumer reserves Rescue produce: creates a PENDING order for the farm to confirm. */
export async function reserve(user, id, input, ip) {
  if (!user.buyerId) throw forbidden('A buyer account is required to reserve Rescue produce');
  const d = validate(reserveSchema, input);
  const listing = await getListingById(id);

  const result = await withTransaction(async (client) => {
    const { order } = await createAllocatedOrder(client, {
      batchId: listing.harvestBatchId,
      buyerId: user.buyerId,
      rescueListingId: id,
      quantity: d.quantity,
      unitPrice: Number(listing.rescuePrice),
      source: 'RESCUE',
      status: 'PENDING',
      collectionMethod: d.collectionMethod || 'FARM_PICKUP',
      userId: user.id,
    });
    await logAudit(
      { farmId: listing.farmId, userId: user.id, action: 'RESCUE_RESERVED', entityType: 'rescue_listing', entityId: id,
        details: { orderId: order.id, quantity: d.quantity }, ip },
      client
    );
    return order;
  });

  await notifyFarm({
    farmId: listing.farmId,
    type: 'RESCUE_RESERVED',
    title: `Rescue reservation: ${d.quantity}${listing.unit} ${listing.produceName}`,
    body: `Order #${result.id} is pending your confirmation.`,
  });
  return { orderId: result.id, listing: await getListingById(id) };
}

/** Farm-side helper for the Rescue form: batch summary with remaining stock. */
export async function getBatchForRescue(user, batchId) {
  const row = await findBatchById(batchId);
  if (!row || !hasFarmAccess(user, row.farm_id)) throw notFound('Harvest batch not found');
  return toBatchDTO(row);
}
