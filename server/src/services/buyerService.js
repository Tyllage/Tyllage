import { z } from 'zod';
import { query } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelize, camelizeAll } from '../utils/case.js';
import { notFound, badRequest } from '../utils/errors.js';
import { BUYER_TYPES, REGIONS, COLLECTION_METHODS, MIN_ORDERS_FOR_RELIABILITY } from '../config/rules.js';
import { assertFarmAdmin } from './farmAccessService.js';
import { logAudit } from './auditService.js';

const profileFields = {
  organisationName: z.string().trim().min(2).max(150),
  contactName: z.string().trim().max(150).nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  whatsappOptIn: z.boolean().optional(),
  region: z.enum(REGIONS).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  preferredCollectionMethod: z.enum(COLLECTION_METHODS).optional(),
};
const managedBuyerSchema = z.object({ ...profileFields, buyerType: z.enum(BUYER_TYPES) });
const updateProfileSchema = z.object(profileFields).partial();

const COLUMN_MAP = {
  organisationName: 'organisation_name', contactName: 'contact_name', contactEmail: 'contact_email',
  contactPhone: 'contact_phone', whatsappOptIn: 'whatsapp_opt_in', region: 'region', address: 'address',
  preferredCollectionMethod: 'preferred_collection_method',
};

export async function getMyProfile(user) {
  if (!user.buyerId) throw notFound('No buyer profile for this account');
  const { rows } = await query('SELECT * FROM buyer_profiles WHERE id = $1', [user.buyerId]);
  return camelize(rows[0]);
}

export async function updateMyProfile(user, input) {
  if (!user.buyerId) throw notFound('No buyer profile for this account');
  const d = validate(updateProfileSchema, input);
  const sets = [];
  const values = [];
  for (const [key, col] of Object.entries(COLUMN_MAP)) {
    if (d[key] !== undefined) {
      values.push(d[key]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (!sets.length) throw badRequest('No changes supplied');
  values.push(user.buyerId);
  const { rows } = await query(
    `UPDATE buyer_profiles SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );
  return camelize(rows[0]);
}

/**
 * Buyers relevant to a farm: buyers the farm manages, buyers with open/directed demand the farm
 * can see, and buyers who have ordered from the farm. Includes order history for context.
 */
export async function listBuyersForFarm(farmId) {
  const { rows } = await query(
    `SELECT bp.id, bp.organisation_name, bp.buyer_type, bp.contact_name, bp.contact_phone, bp.contact_email,
            bp.whatsapp_opt_in, bp.region, bp.preferred_collection_method, bp.is_active,
            (bp.managed_by_farm_id = $1) AS managed_by_farm,
            COUNT(DISTINCT o.id) FILTER (WHERE o.status <> 'CANCELLED') AS order_count,
            COALESCE(SUM(o.total_amount) FILTER (WHERE o.status IN ('CONFIRMED','READY','COMPLETED')), 0) AS revenue
       FROM buyer_profiles bp
       LEFT JOIN orders o ON o.buyer_id = bp.id AND o.farm_id = $1
      WHERE bp.managed_by_farm_id = $1
         OR EXISTS (SELECT 1 FROM orders o2 WHERE o2.buyer_id = bp.id AND o2.farm_id = $1)
         OR EXISTS (SELECT 1 FROM demand_requests dr WHERE dr.buyer_id = bp.id AND (dr.farm_id = $1 OR dr.farm_id IS NULL))
      GROUP BY bp.id
      ORDER BY bp.organisation_name`,
    [farmId]
  );
  return camelizeAll(rows);
}

/** Farm admin records an offline buyer (e.g. an existing phone/WhatsApp customer without an account). */
export async function createManagedBuyer(user, farmId, input) {
  assertFarmAdmin(user, farmId);
  const d = validate(managedBuyerSchema, input);
  const { rows } = await query(
    `INSERT INTO buyer_profiles (organisation_name, buyer_type, contact_name, contact_email, contact_phone,
                                 whatsapp_opt_in, region, address, preferred_collection_method, managed_by_farm_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [d.organisationName, d.buyerType, d.contactName ?? null, d.contactEmail ?? null, d.contactPhone ?? null,
      d.whatsappOptIn ?? false, d.region ?? null, d.address ?? null, d.preferredCollectionMethod || 'FARM_PICKUP', farmId]
  );
  await logAudit({ farmId, userId: user.id, action: 'BUYER_CREATED', entityType: 'buyer_profile', entityId: rows[0].id });
  return camelize(rows[0]);
}

/**
 * Real order history per buyer for HarvestMatch reliability. Only buyer-initiated cancellations
 * count against a buyer. Returns null stats when history is insufficient (neutral score applies).
 */
export async function getReliabilityStats(buyerIds, client) {
  if (!buyerIds.length) return new Map();
  const runner = client || { query };
  const { rows } = await runner.query(
    `SELECT buyer_id,
            COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
            COUNT(*) FILTER (WHERE status = 'CANCELLED' AND cancelled_by_party = 'BUYER') AS cancelled
       FROM orders WHERE buyer_id = ANY($1::int[]) GROUP BY buyer_id`,
    [buyerIds]
  );
  const map = new Map();
  for (const r of rows) {
    const total = r.completed + r.cancelled;
    map.set(r.buyer_id, total >= MIN_ORDERS_FOR_RELIABILITY ? { completed: r.completed, total } : null);
  }
  return map;
}
