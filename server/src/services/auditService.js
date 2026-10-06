import { query } from '../config/db.js';

/**
 * Records a farm-sensitive action. Pass `client` to write inside the caller's transaction
 * so the log is only kept if the action commits.
 */
export async function logAudit({ farmId = null, userId = null, action, entityType, entityId = null, details = {}, ip = null }, client) {
  const runner = client || { query };
  await runner.query(
    `INSERT INTO audit_logs (farm_id, user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [farmId, userId, action, entityType, entityId, JSON.stringify(details), ip]
  );
}

export async function listAuditLogs(farmId, limit = 50) {
  const { rows } = await query(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
            u.full_name AS user_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
      WHERE al.farm_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2`,
    [farmId, limit]
  );
  return rows.map((r) => ({
    id: r.id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, details: r.details,
    createdAt: r.created_at, userName: r.user_name,
  }));
}

/** Platform-wide audit trail (platform admins): security and cross-farm activity. */
export async function listPlatformAuditLogs(limit = 100) {
  const { rows } = await query(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at, al.ip_address,
            u.full_name AS user_name, u.email AS user_email, f.name AS farm_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN farms f ON f.id = al.farm_id
      ORDER BY al.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, details: r.details,
    createdAt: r.created_at, ipAddress: r.ip_address, userName: r.user_name, userEmail: r.user_email, farmName: r.farm_name,
  }));
}
