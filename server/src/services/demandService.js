import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelizeAll, camelize } from '../utils/case.js';
import { notFound, badRequest, forbidden, conflict } from '../utils/errors.js';
import { todayISO } from '../utils/dates.js';
import { hasFarmAccess, isFarmSide, assertFarmAccess } from './farmAccessService.js';
import { logAudit } from './auditService.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');

const demandSchema = z
  .object({
    buyerId: z.coerce.number().int().positive().optional(), // farm-side only
    farmId: z.coerce.number().int().positive().nullable().optional(),
    produceId: z.coerce.number().int().positive().nullable().optional(),
    produceName: z.string().trim().min(2).max(120).optional(),
    category: z.string().trim().max(40).nullable().optional(),
    quantity: z.coerce.number().positive('must be greater than 0').max(100000),
    unit: z.string().trim().max(20).default('kg'),
    requiredDate: isoDate,
    maxPrice: z.coerce.number().positive().max(100000).nullable().optional(),
    recurrence: z.enum(['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).default('NONE'),
    notes: z.string().trim().max(2000).nullable().optional(),
    // Smallest partial delivery the buyer will accept (minimum order quantity).
    minQuantity: z.coerce.number().positive().max(100000).nullable().optional(),
    // FarmPool: let several farms fulfil this request together (open-market demand only).
    allowPooling: z.boolean().optional(),
  })
  .refine((d) => d.produceId || d.produceName, { message: 'Choose a produce item or enter a produce name', path: ['produceName'] })
  .refine((d) => !d.minQuantity || d.minQuantity <= d.quantity, { message: 'Minimum cannot exceed the requested quantity', path: ['minQuantity'] });

const updateSchema = z.object({
  quantity: z.coerce.number().positive().max(100000).optional(),
  requiredDate: isoDate.optional(),
  maxPrice: z.coerce.number().positive().max(100000).nullable().optional(),
  recurrence: z.enum(['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const DEMAND_SELECT = `
  SELECT dr.*, (dr.quantity - dr.fulfilled_quantity) AS remaining_quantity,
         (SELECT COUNT(DISTINCT o.farm_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE oi.demand_request_id = dr.id AND o.status <> 'CANCELLED') AS supplying_farms,
         bp.organisation_name AS buyer_name, bp.buyer_type, bp.region AS buyer_region,
         f.name AS farm_name
    FROM demand_requests dr
    JOIN buyer_profiles bp ON bp.id = dr.buyer_id
    LEFT JOIN farms f ON f.id = dr.farm_id`;

/** Lazily expire non-recurring demand whose required date has passed. */
async function expireStaleDemand() {
  await query(
    `UPDATE demand_requests SET status = 'EXPIRED', updated_at = NOW()
      WHERE status IN ('OPEN', 'PARTIALLY_FULFILLED') AND recurrence = 'NONE' AND required_date < $1`,
    [todayISO()]
  );
}

export async function listForFarm(farmId, { status } = {}) {
  await expireStaleDemand();
  const params = [farmId];
  let where = '(dr.farm_id = $1 OR dr.farm_id IS NULL)';
  if (status) {
    params.push(status.split(','));
    where += ` AND dr.status = ANY($${params.length}::text[])`;
  }
  const { rows } = await query(`${DEMAND_SELECT} WHERE ${where} ORDER BY dr.required_date ASC, dr.id ASC`, params);
  return camelizeAll(rows);
}

export async function listForBuyer(user) {
  if (!user.buyerId) return [];
  await expireStaleDemand();
  const { rows } = await query(`${DEMAND_SELECT} WHERE dr.buyer_id = $1 ORDER BY dr.created_at DESC`, [user.buyerId]);
  return camelizeAll(rows);
}

async function loadDemand(id, client) {
  const runner = client || { query };
  const { rows } = await runner.query(`${DEMAND_SELECT} WHERE dr.id = $1`, [id]);
  if (!rows[0]) throw notFound('Demand request not found');
  return rows[0];
}

function canManageDemand(user, row) {
  if (user.buyerId && row.buyer_id === user.buyerId) return true;
  if (isFarmSide(user) && row.farm_id && hasFarmAccess(user, row.farm_id)) return true;
  return user.role === 'platform_admin';
}

export async function getDemand(user, id) {
  const row = await loadDemand(id);
  const visibleToFarm = isFarmSide(user) && (row.farm_id === null || hasFarmAccess(user, row.farm_id));
  if (!canManageDemand(user, row) && !visibleToFarm) throw forbidden();
  return camelize(row);
}

export async function createDemand(user, input, ip) {
  const d = validate(demandSchema, input);
  if (d.requiredDate < todayISO()) throw badRequest('Required date cannot be in the past', 'VALIDATION_ERROR');

  let buyerId;
  let farmId = d.farmId ?? null;
  if (isFarmSide(user)) {
    // Farm staff record demand on behalf of a buyer, directed to their own farm.
    if (!d.buyerId) throw badRequest('buyerId is required', 'VALIDATION_ERROR');
    if (!farmId) throw badRequest('farmId is required', 'VALIDATION_ERROR');
    assertFarmAccess(user, farmId);
    buyerId = d.buyerId;
  } else {
    if (!user.buyerId) throw forbidden('A buyer profile is required to register demand');
    buyerId = user.buyerId;
  }

  const buyer = await query('SELECT id, is_active FROM buyer_profiles WHERE id = $1', [buyerId]);
  if (!buyer.rows[0]?.is_active) throw badRequest('Buyer not found or inactive', 'INVALID_BUYER');

  let produceName = d.produceName;
  let category = d.category ?? null;
  let unit = d.unit;
  if (d.produceId) {
    const { rows } = await query('SELECT id, farm_id, name, category, unit, is_active FROM produce WHERE id = $1', [d.produceId]);
    const p = rows[0];
    if (!p || !p.is_active) throw badRequest('Produce not found or inactive', 'INVALID_PRODUCE');
    if (farmId && p.farm_id !== farmId) throw badRequest('Produce does not belong to the selected farm', 'PRODUCE_FARM_MISMATCH');
    farmId = p.farm_id;
    produceName = p.name;
    category = p.category;
    unit = p.unit;
  }
  if (farmId) {
    const farm = await query('SELECT 1 FROM farms WHERE id = $1 AND is_active', [farmId]);
    if (!farm.rowCount) throw badRequest('Farm not found', 'INVALID_FARM');
  }

  if (d.allowPooling && farmId) {
    throw badRequest('FarmPool requests must be open to any farm (do not pick a specific farm)', 'VALIDATION_ERROR');
  }

  const { rows } = await query(
    `INSERT INTO demand_requests (buyer_id, farm_id, produce_id, produce_name, category, quantity, unit,
                                  required_date, max_price, recurrence, notes, created_by, min_quantity, allow_pooling)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [buyerId, farmId, d.produceId ?? null, produceName, category, d.quantity, unit, d.requiredDate,
      d.maxPrice ?? null, d.recurrence, d.notes ?? null, user.id, d.minQuantity ?? null, d.allowPooling ?? false]
  );
  await logAudit({ farmId, userId: user.id, action: 'DEMAND_CREATED', entityType: 'demand_request', entityId: rows[0].id, details: { buyerId, produceName, quantity: d.quantity }, ip });
  return camelize(await loadDemand(rows[0].id));
}

export async function updateDemand(user, id, input) {
  const row = await loadDemand(id);
  if (!canManageDemand(user, row)) throw forbidden();
  if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(row.status)) throw conflict('Only open demand can be edited', 'DEMAND_NOT_OPEN');
  const d = validate(updateSchema, input);
  const quantity = d.quantity ?? row.quantity;
  if (quantity < row.fulfilled_quantity) {
    throw badRequest(`Quantity cannot be below the ${row.fulfilled_quantity}${row.unit} already fulfilled`, 'VALIDATION_ERROR');
  }
  await query(
    `UPDATE demand_requests SET quantity = $1, required_date = $2, max_price = $3, recurrence = $4, notes = $5, updated_at = NOW()
      WHERE id = $6`,
    [quantity, d.requiredDate ?? row.required_date, d.maxPrice !== undefined ? d.maxPrice : row.max_price,
      d.recurrence ?? row.recurrence, d.notes !== undefined ? d.notes : row.notes, id]
  );
  return camelize(await loadDemand(id));
}

export async function cancelDemand(user, id, ip) {
  const row = await loadDemand(id);
  if (!canManageDemand(user, row)) throw forbidden();
  if (['CANCELLED', 'FULFILLED'].includes(row.status)) throw conflict('This demand can no longer be cancelled', 'DEMAND_NOT_OPEN');
  await withTransaction(async (client) => {
    await client.query("UPDATE demand_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1", [id]);
    await client.query("UPDATE harvest_matches SET status = 'SUPERSEDED' WHERE demand_request_id = $1 AND status = 'SUGGESTED'", [id]);
    await logAudit({ farmId: row.farm_id, userId: user.id, action: 'DEMAND_CANCELLED', entityType: 'demand_request', entityId: id, ip }, client);
  });
  return camelize(await loadDemand(id));
}
