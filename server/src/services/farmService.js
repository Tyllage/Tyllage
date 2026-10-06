import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelize, camelizeAll } from '../utils/case.js';
import { notFound, conflict, badRequest } from '../utils/errors.js';
import { REGIONS, COLLECTION_METHODS } from '../config/rules.js';
import { hashPassword } from './authService.js';
import { logAudit } from './auditService.js';

const farmFields = {
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(2000).nullable().optional(),
  region: z.enum(REGIONS).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  fulfilmentMethods: z.array(z.enum(COLLECTION_METHODS)).min(1).optional(),
};

const createFarmSchema = z.object({
  ...farmFields,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,80}$/, 'use lowercase letters, numbers and dashes'),
});
const updateFarmSchema = z.object(farmFields).partial();

const farmUserSchema = z.object({
  email: z.email().transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(2).max(150),
  password: z.string().min(8).max(128),
  role: z.enum(['farm_admin', 'farm_staff']),
  phone: z.string().trim().max(40).optional(),
});

/** Farms visible to the user: all for platform admins, memberships for farm users. */
export async function listFarmsForUser(user) {
  if (user.role === 'platform_admin') {
    const { rows } = await query('SELECT * FROM farms ORDER BY created_at ASC');
    return camelizeAll(rows);
  }
  if (!user.farmIds.length) return [];
  const { rows } = await query('SELECT * FROM farms WHERE id = ANY($1::int[]) ORDER BY created_at ASC', [user.farmIds]);
  return camelizeAll(rows);
}

export async function getFarm(farmId) {
  const { rows } = await query('SELECT * FROM farms WHERE id = $1', [farmId]);
  if (!rows[0]) throw notFound('Farm not found');
  return camelize(rows[0]);
}

export async function createFarm(user, input) {
  const d = validate(createFarmSchema, input);
  const { rows } = await query(
    `INSERT INTO farms (name, slug, description, region, address, contact_email, contact_phone, fulfilment_methods)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [d.name, d.slug, d.description ?? null, d.region ?? null, d.address ?? null, d.contactEmail ?? null,
      d.contactPhone ?? null, d.fulfilmentMethods || ['FARM_PICKUP']]
  );
  await logAudit({ farmId: rows[0].id, userId: user.id, action: 'FARM_CREATED', entityType: 'farm', entityId: rows[0].id });
  return camelize(rows[0]);
}

export async function updateFarm(user, farmId, input) {
  const d = validate(updateFarmSchema, input);
  const map = {
    name: 'name', description: 'description', region: 'region', address: 'address',
    contactEmail: 'contact_email', contactPhone: 'contact_phone', fulfilmentMethods: 'fulfilment_methods',
  };
  const sets = [];
  const values = [];
  for (const [key, col] of Object.entries(map)) {
    if (d[key] !== undefined) {
      values.push(d[key]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (!sets.length) throw badRequest('No changes supplied');
  values.push(farmId);
  const { rows } = await query(
    `UPDATE farms SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) throw notFound('Farm not found');
  await logAudit({ farmId, userId: user.id, action: 'FARM_UPDATED', entityType: 'farm', entityId: farmId, details: d });
  return camelize(rows[0]);
}

export async function listFarmTeam(farmId) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.role, u.phone, u.is_active, fs.staff_role, u.last_login_at
       FROM farm_staff fs JOIN users u ON u.id = fs.user_id
      WHERE fs.farm_id = $1 ORDER BY fs.staff_role, u.full_name`,
    [farmId]
  );
  return camelizeAll(rows);
}

/** Platform admin provisions a farm-side account and links it to the farm. */
export async function createFarmUser(actor, farmId, input) {
  const d = validate(farmUserSchema, input);
  await getFarm(farmId);
  const existing = await query('SELECT 1 FROM users WHERE LOWER(email) = $1', [d.email]);
  if (existing.rowCount) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
  const hash = await hashPassword(d.password);

  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role, phone, is_active`,
      [d.email, hash, d.fullName, d.role, d.phone || null]
    );
    await client.query('INSERT INTO farm_staff (farm_id, user_id, staff_role) VALUES ($1, $2, $3)', [
      farmId, rows[0].id, d.role === 'farm_admin' ? 'ADMIN' : 'STAFF',
    ]);
    await logAudit(
      { farmId, userId: actor.id, action: 'FARM_USER_CREATED', entityType: 'user', entityId: rows[0].id, details: { role: d.role } },
      client
    );
    return rows[0];
  });
  return camelize(user);
}
