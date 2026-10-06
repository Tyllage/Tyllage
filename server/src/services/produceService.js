import { z } from 'zod';
import { query } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelize, camelizeAll } from '../utils/case.js';
import { notFound, badRequest } from '../utils/errors.js';
import { assertFarmAccess, assertFarmAdmin } from './farmAccessService.js';
import { logAudit } from './auditService.js';

export const PRODUCE_CATEGORIES = ['HERBS', 'LEAFY_GREENS', 'MICROGREENS', 'FRUITING', 'OTHER'];

const produceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(PRODUCE_CATEGORIES),
  unit: z.string().trim().min(1).max(20).default('kg'),
  defaultPrice: z.coerce.number().min(0).max(100000),
  isActive: z.boolean().default(true),
  // Farm minimum order quantity (MOQ); smaller requests can still be served via DemandPool.
  minOrderQuantity: z.coerce.number().min(0).max(100000).default(0),
  // Shelf life drives the Dynamic Routing windows for this crop (null = platform default).
  shelfLifeDays: z.coerce.number().int().min(1).max(60).nullable().optional(),
});

export async function listProduce(farmId, { activeOnly = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM produce WHERE farm_id = $1 ${activeOnly ? 'AND is_active' : ''} ORDER BY name`,
    [farmId]
  );
  return camelizeAll(rows);
}

async function loadProduce(id) {
  const { rows } = await query('SELECT * FROM produce WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Produce not found');
  return rows[0];
}

export async function getProduce(user, id) {
  const row = await loadProduce(id);
  assertFarmAccess(user, row.farm_id);
  return camelize(row);
}

export async function createProduce(user, farmId, input) {
  assertFarmAdmin(user, farmId);
  const d = validate(produceSchema, input);
  const { rows } = await query(
    `INSERT INTO produce (farm_id, name, category, unit, default_price, is_active, min_order_quantity, shelf_life_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [farmId, d.name, d.category, d.unit, d.defaultPrice, d.isActive, d.minOrderQuantity, d.shelfLifeDays ?? null]
  );
  await logAudit({ farmId, userId: user.id, action: 'PRODUCE_CREATED', entityType: 'produce', entityId: rows[0].id, details: d });
  return camelize(rows[0]);
}

export async function updateProduce(user, id, input) {
  const existing = await loadProduce(id);
  assertFarmAdmin(user, existing.farm_id);
  // No defaults on update: only supplied fields change.
  const d = validate(produceSchema.partial().extend({ isActive: z.boolean().optional(), minOrderQuantity: z.coerce.number().min(0).max(100000).optional() }), input);
  const merged = {
    name: d.name ?? existing.name,
    category: d.category ?? existing.category,
    unit: d.unit ?? existing.unit,
    defaultPrice: d.defaultPrice ?? existing.default_price,
    isActive: d.isActive ?? existing.is_active,
    minOrderQuantity: d.minOrderQuantity ?? existing.min_order_quantity,
    shelfLifeDays: d.shelfLifeDays !== undefined ? d.shelfLifeDays : existing.shelf_life_days,
  };
  const { rows } = await query(
    `UPDATE produce SET name = $1, category = $2, unit = $3, default_price = $4, is_active = $5,
            min_order_quantity = $6, shelf_life_days = $7, updated_at = NOW()
      WHERE id = $8 RETURNING *`,
    [merged.name, merged.category, merged.unit, merged.defaultPrice, merged.isActive, merged.minOrderQuantity, merged.shelfLifeDays, id]
  );
  await logAudit({ farmId: existing.farm_id, userId: user.id, action: 'PRODUCE_UPDATED', entityType: 'produce', entityId: id, details: d });
  return camelize(rows[0]);
}

/** Ensures a produce record belongs to the farm and is active — used by harvest creation. */
export async function assertProduceBelongsToFarm(produceId, farmId, client) {
  const runner = client || { query };
  const { rows } = await runner.query('SELECT id, farm_id, is_active, default_price FROM produce WHERE id = $1', [produceId]);
  const row = rows[0];
  if (!row || row.farm_id !== Number(farmId)) {
    throw badRequest('Produce must belong to this farm', 'PRODUCE_FARM_MISMATCH');
  }
  if (!row.is_active) throw badRequest('Produce is inactive', 'PRODUCE_INACTIVE');
  return row;
}
