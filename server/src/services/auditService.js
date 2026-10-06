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
  return rows;
}
