import { query } from '../config/db.js';
import { camelizeAll, camelize } from '../utils/case.js';
import { badRequest, notFound } from '../utils/errors.js';
import { logAudit } from './auditService.js';

/** Platform admin: all users with their farm memberships. */
export async function listUsers() {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.last_login_at, u.created_at,
            COALESCE((SELECT json_agg(f.name) FROM farm_staff fs JOIN farms f ON f.id = fs.farm_id WHERE fs.user_id = u.id), '[]') AS farms,
            bp.organisation_name, bp.buyer_type
       FROM users u LEFT JOIN buyer_profiles bp ON bp.user_id = u.id
      ORDER BY u.created_at ASC`
  );
  return camelizeAll(rows);
}

export async function setActive(actor, userId, isActive) {
  if (typeof isActive !== 'boolean') throw badRequest('isActive must be true or false', 'VALIDATION_ERROR');
  if (actor.id === userId) throw badRequest('You cannot change your own account status', 'SELF_UPDATE');
  const { rows } = await query(
    'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, full_name, role, is_active',
    [isActive, userId]
  );
  if (!rows[0]) throw notFound('User not found');
  await logAudit({ userId: actor.id, action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'user', entityId: userId });
  return camelize(rows[0]);
}
