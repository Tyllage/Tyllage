import { z } from 'zod';
import { withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { notFound, badRequest, conflict } from '../utils/errors.js';
import { query } from '../config/db.js';
import { camelizeAll } from '../utils/case.js';
import { round2 } from '../utils/numbers.js';
import { assertFarmAccess, assertFarmAdmin } from './farmAccessService.js';
import { assertProduceBelongsToFarm } from './produceService.js';
import { logAudit } from './auditService.js';
import { findBatchById, listBatches, lockBatch, syncBatchStatus, toBatchDTO } from '../models/harvestModel.js';
import { ROUTE_KEYS } from '../config/rules.js';

export const GRADES = ['PREMIUM', 'EVERYDAY', 'RESCUE_ELIGIBLE', 'CHEF_PACK'];
export const DISPOSITION_TYPES = ['DONATION', 'ALTERNATIVE_USE', 'WASTE'];
const cost = z.coerce.number().min(0).max(100000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const positiveQty = z.coerce.number().positive('must be greater than 0').max(1000000);
const price = z.coerce.number().positive('must be greater than 0').max(100000);
// Commercial constraint: the routes this batch may be sold through (null/empty = any route).
const allowedRoutes = z.array(z.enum(ROUTE_KEYS)).max(ROUTE_KEYS.length).nullable().optional()
  .transform((v) => (v === undefined ? undefined : v && v.length ? [...new Set(v)] : null));

const createSchema = z
  .object({
    produceId: z.coerce.number().int().positive(),
    expectedQuantity: positiveQty,
    actualQuantity: positiveQty.nullable().optional(),
    harvestDate: isoDate,
    grade: z.enum(GRADES).default('EVERYDAY'),
    preferredPrice: price,
    minPrice: price,
    productionCost: cost.nullable().optional(),
    allowedRoutes,
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((d) => d.minPrice <= d.preferredPrice, {
    message: 'Minimum price cannot exceed preferred price',
    path: ['minPrice'],
  });

// Staff may update operational fields; pricing changes are admin-only.
const updateSchema = z.object({
  expectedQuantity: positiveQty.optional(),
  actualQuantity: positiveQty.nullable().optional(),
  harvestDate: isoDate.optional(),
  grade: z.enum(GRADES).optional(),
  preferredPrice: price.optional(),
  minPrice: price.optional(),
  productionCost: cost.nullable().optional(),
  allowedRoutes,
  notes: z.string().trim().max(2000).nullable().optional(),
});
// Pricing and commercial constraints are admin-only.
const PRICE_FIELDS = ['preferredPrice', 'minPrice', 'productionCost', 'allowedRoutes'];

const dispositionSchema = z.object({
  dispositionType: z.enum(DISPOSITION_TYPES),
  quantity: positiveQty,
  recipient: z.string().trim().max(150).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

async function loadBatchForUser(user, id) {
  const row = await findBatchById(id);
  if (!row) throw notFound('Harvest batch not found');
  assertFarmAccess(user, row.farm_id);
  return row;
}

export async function listHarvests(farmId, { includeClosed } = {}) {
  const rows = await listBatches(farmId, { includeClosed });
  return rows.map(toBatchDTO);
}

export async function getHarvest(user, id) {
  return toBatchDTO(await loadBatchForUser(user, id));
}

export async function createHarvest(user, farmId, input, ip) {
  assertFarmAccess(user, farmId);
  const d = validate(createSchema, input);
  return withTransaction(async (client) => {
    await assertProduceBelongsToFarm(d.produceId, farmId, client);
    const { rows } = await client.query(
      `INSERT INTO harvest_batches (farm_id, produce_id, expected_quantity, actual_quantity, harvest_date, grade,
                                    preferred_price, min_price, production_cost, notes, created_by, allowed_routes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [farmId, d.produceId, d.expectedQuantity, d.actualQuantity ?? null, d.harvestDate, d.grade,
        d.preferredPrice, d.minPrice, d.productionCost ?? null, d.notes ?? null, user.id, d.allowedRoutes ?? null]
    );
    const id = rows[0].id;
    await logAudit({ farmId, userId: user.id, action: 'HARVEST_CREATED', entityType: 'harvest_batch', entityId: id, details: d, ip }, client);
    return toBatchDTO(await syncBatchStatus(id, client));
  });
}

export async function updateHarvest(user, id, input, ip) {
  const d = validate(updateSchema, input);
  if (!Object.keys(d).length) throw badRequest('No changes supplied');

  return withTransaction(async (client) => {
    const row = await lockBatch(id, client);
    if (!row) throw notFound('Harvest batch not found');
    if (PRICE_FIELDS.some((f) => d[f] !== undefined)) assertFarmAdmin(user, row.farm_id);
    else assertFarmAccess(user, row.farm_id);
    if (row.status === 'CLOSED') throw conflict('Closed batches cannot be edited', 'BATCH_CLOSED');

    const merged = {
      expected_quantity: d.expectedQuantity ?? row.expected_quantity,
      actual_quantity: d.actualQuantity !== undefined ? d.actualQuantity : row.actual_quantity,
      harvest_date: d.harvestDate ?? row.harvest_date,
      grade: d.grade ?? row.grade,
      preferred_price: d.preferredPrice ?? row.preferred_price,
      min_price: d.minPrice ?? row.min_price,
      production_cost: d.productionCost !== undefined ? d.productionCost : row.production_cost,
      notes: d.notes !== undefined ? d.notes : row.notes,
      allowed_routes: d.allowedRoutes !== undefined ? d.allowedRoutes : row.allowed_routes,
    };
    if (merged.min_price > merged.preferred_price) {
      throw badRequest('Minimum price cannot exceed preferred price', 'VALIDATION_ERROR');
    }
    // Quantity can't drop below what is already committed to buyers or Rescue.
    const committed = round2(Number(row.allocated_quantity) + Number(row.rescue_quantity) + Number(row.disposed_quantity || 0));
    const newHarvestQty = merged.actual_quantity ?? merged.expected_quantity;
    if (newHarvestQty < committed) {
      throw conflict(
        `Quantity cannot be reduced below the ${committed}${row.unit} already allocated or listed for Rescue`,
        'QUANTITY_BELOW_COMMITTED'
      );
    }

    await client.query(
      `UPDATE harvest_batches
          SET expected_quantity = $1, actual_quantity = $2, harvest_date = $3, grade = $4,
              preferred_price = $5, min_price = $6, notes = $7, production_cost = $8, allowed_routes = $9, updated_at = NOW()
        WHERE id = $10`,
      [merged.expected_quantity, merged.actual_quantity, merged.harvest_date, merged.grade,
        merged.preferred_price, merged.min_price, merged.notes, merged.production_cost, merged.allowed_routes, id]
    );
    await logAudit({ farmId: row.farm_id, userId: user.id, action: 'HARVEST_UPDATED', entityType: 'harvest_batch', entityId: id, details: d, ip }, client);
    return toBatchDTO(await syncBatchStatus(id, client));
  });
}

export async function markAvailable(user, id, ip) {
  return withTransaction(async (client) => {
    const row = await lockBatch(id, client);
    if (!row) throw notFound('Harvest batch not found');
    assertFarmAccess(user, row.farm_id);
    if (row.status === 'CLOSED') throw conflict('Closed batches cannot be changed', 'BATCH_CLOSED');
    await client.query('UPDATE harvest_batches SET marked_available = TRUE, updated_at = NOW() WHERE id = $1', [id]);
    await logAudit({ farmId: row.farm_id, userId: user.id, action: 'HARVEST_MARKED_AVAILABLE', entityType: 'harvest_batch', entityId: id, ip }, client);
    return toBatchDTO(await syncBatchStatus(id, client));
  });
}

export async function closeHarvest(user, id, ip) {
  return withTransaction(async (client) => {
    const row = await lockBatch(id, client);
    if (!row) throw notFound('Harvest batch not found');
    assertFarmAdmin(user, row.farm_id);
    if (row.status === 'CLOSED') return toBatchDTO(row);
    await client.query("UPDATE harvest_batches SET status = 'CLOSED', updated_at = NOW() WHERE id = $1", [id]);
    // Outstanding suggestions are no longer actionable.
    await client.query(
      "UPDATE harvest_matches SET status = 'SUPERSEDED' WHERE harvest_batch_id = $1 AND status = 'SUGGESTED'",
      [id]
    );
    await logAudit({ farmId: row.farm_id, userId: user.id, action: 'HARVEST_CLOSED', entityType: 'harvest_batch', entityId: id, ip }, client);
    return toBatchDTO(await findBatchById(id, client));
  });
}

/**
 * Final routing stage: record produce donated, put to alternative use, or (honestly) wasted.
 * Removes the quantity from unallocated stock.
 */
export async function recordDisposition(user, id, input, ip) {
  const d = validate(dispositionSchema, input);
  return withTransaction(async (client) => {
    const row = await lockBatch(id, client);
    if (!row) throw notFound('Harvest batch not found');
    assertFarmAdmin(user, row.farm_id);
    if (row.status === 'CLOSED') throw conflict('Closed batches cannot be changed', 'BATCH_CLOSED');
    if (d.quantity > Number(row.remaining_quantity)) {
      throw conflict(`Only ${Math.max(0, row.remaining_quantity)}${row.unit} is unallocated`, 'OVER_ALLOCATION');
    }
    const { rows } = await client.query(
      `INSERT INTO batch_dispositions (farm_id, harvest_batch_id, disposition_type, quantity, recipient, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [row.farm_id, id, d.dispositionType, d.quantity, d.recipient ?? null, d.notes ?? null, user.id]
    );
    await logAudit({ farmId: row.farm_id, userId: user.id, action: 'DISPOSITION_RECORDED', entityType: 'harvest_batch', entityId: id, details: { ...d, dispositionId: rows[0].id }, ip }, client);
    return toBatchDTO(await syncBatchStatus(id, client));
  });
}

export async function listDispositions(user, id) {
  await loadBatchForUser(user, id);
  const { rows } = await query(
    `SELECT d.*, u.full_name AS created_by_name FROM batch_dispositions d LEFT JOIN users u ON u.id = d.created_by
      WHERE d.harvest_batch_id = $1 ORDER BY d.created_at DESC`,
    [id]
  );
  return camelizeAll(rows);
}
