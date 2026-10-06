import { forbidden } from '../utils/errors.js';

const FARM_SIDE_ROLES = ['farm_admin', 'farm_staff'];

/** True when the user can see/operate on the given farm's records. */
export function hasFarmAccess(user, farmId) {
  if (!user) return false;
  if (user.role === 'platform_admin') return true;
  if (!FARM_SIDE_ROLES.includes(user.role)) return false;
  return user.farmIds.includes(Number(farmId));
}

export function assertFarmAccess(user, farmId) {
  if (!hasFarmAccess(user, farmId)) {
    throw forbidden('You do not have access to this farm', 'FARM_ACCESS_DENIED');
  }
}

/** Farm admins (or platform admins) only — for approvals, pricing, recovery and campaigns. */
export function assertFarmAdmin(user, farmId) {
  assertFarmAccess(user, farmId);
  if (user.role === 'platform_admin') return;
  const membership = user.farms.find((f) => f.farmId === Number(farmId));
  if (user.role !== 'farm_admin' || membership?.staffRole !== 'ADMIN') {
    throw forbidden('Only farm administrators can perform this action', 'FARM_ADMIN_REQUIRED');
  }
}

export function isFarmSide(user) {
  return user && (user.role === 'platform_admin' || FARM_SIDE_ROLES.includes(user.role));
}
