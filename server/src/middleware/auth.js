import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { query } from '../config/db.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import { assertFarmAccess } from '../services/farmAccessService.js';
import { idParam } from '../utils/validate.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

/** Loads the current user with farm memberships and buyer profile. Role comes from the DB, never the token alone. */
export async function loadAuthUser(userId) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.role, u.phone, u.is_active,
            bp.id AS buyer_id,
            COALESCE(
              (SELECT json_agg(json_build_object('farmId', fs.farm_id, 'staffRole', fs.staff_role))
                 FROM farm_staff fs WHERE fs.user_id = u.id), '[]'::json) AS farms
       FROM users u
       LEFT JOIN buyer_profiles bp ON bp.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone,
    isActive: row.is_active,
    buyerId: row.buyer_id,
    farms: row.farms,
    farmIds: row.farms.map((f) => f.farmId),
  };
}

export async function verifyToken(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw unauthorized('Session expired or invalid. Please sign in again.', 'INVALID_TOKEN');
  }

  const user = await loadAuthUser(payload.sub);
  if (!user || !user.isActive) throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

/**
 * Verifies the user may access the farm named in the request (route param, query or body).
 * Sets req.farmId to the validated id. Never trusts the client-supplied id without this check.
 */
export function requireFarmAccess(req, _res, next) {
  const raw = req.params.farmId ?? req.query.farmId ?? req.body?.farmId;
  const farmId = idParam(raw, 'farmId');
  assertFarmAccess(req.user, farmId);
  req.farmId = farmId;
  next();
}

/**
 * For endpoints shared by farm and buyer users (e.g. GET /api/orders): farm-side users must name a
 * farm they can access; buyers get their own records (req.farmId stays undefined).
 */
export function farmScopeForFarmUsers(req, res, next) {
  if (['platform_admin', 'farm_admin', 'farm_staff'].includes(req.user.role)) {
    return requireFarmAccess(req, res, next);
  }
  next();
}

export const FARM_ROLES =['platform_admin', 'farm_admin', 'farm_staff'];
export const FARM_ADMIN_ROLES = ['platform_admin', 'farm_admin'];
export const BUYER_ROLES = ['business_buyer', 'consumer'];
