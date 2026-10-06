import { query } from '../config/db.js';
import { camelizeAll } from '../utils/case.js';
import { notFound } from '../utils/errors.js';
import { sendTextMessage } from './whatsappService.js';
import env from '../config/env.js';

async function insertNotification(n) {
  const { rows } = await query(
    `INSERT INTO notifications (farm_id, user_id, buyer_id, campaign_id, channel, notification_type, title, body, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [n.farmId ?? null, n.userId ?? null, n.buyerId ?? null, n.campaignId ?? null, n.channel, n.type, n.title, n.body, n.status || 'PENDING']
  );
  return rows[0].id;
}

/** Sends a WhatsApp message and records the outcome (MOCK_SENT / SENT / FAILED) as a notification row. */
export async function sendWhatsApp({ farmId, buyerId, campaignId, type, title, body, phone }) {
  const id = await insertNotification({ farmId, buyerId, campaignId, channel: 'WHATSAPP', type, title, body });
  const result = await sendTextMessage({ to: phone, body });
  await query(
    `UPDATE notifications SET status = $1::varchar, provider_message_id = $2, error = $3,
            sent_at = CASE WHEN $1::varchar IN ('SENT', 'MOCK_SENT') THEN NOW() ELSE NULL END
      WHERE id = $4`,
    [result.status, result.providerMessageId || null, result.error || null, id]
  );
  return { id, ...result };
}

/**
 * Notifies a buyer in-app (when they have an account) and via WhatsApp when they opted in.
 * Called after the business transaction commits; failures never roll back business data.
 */
export async function notifyBuyer({ buyerId, farmId, type, title, body }) {
  try {
    const { rows } = await query('SELECT user_id, contact_phone, whatsapp_opt_in FROM buyer_profiles WHERE id = $1', [buyerId]);
    const buyer = rows[0];
    if (!buyer) return;
    if (buyer.user_id) {
      await insertNotification({ farmId, userId: buyer.user_id, buyerId, channel: 'IN_APP', type, title, body, status: 'SENT' });
    }
    if (buyer.whatsapp_opt_in && buyer.contact_phone) {
      await sendWhatsApp({ farmId, buyerId, type, title, body: `${title}\n\n${body}`, phone: buyer.contact_phone });
    }
  } catch (err) {
    if (!env.isTest) console.error('[notifications] buyer notification failed:', err.message);
  }
}

/** Farm-wide in-app alert (visible to all of the farm's users). */
export async function notifyFarm({ farmId, type, title, body }) {
  try {
    await insertNotification({ farmId, channel: 'IN_APP', type, title, body, status: 'SENT' });
  } catch (err) {
    if (!env.isTest) console.error('[notifications] farm notification failed:', err.message);
  }
}

export async function listForUser(user, { limit = 30 } = {}) {
  const farmIds = user.role === 'platform_admin' || user.farmIds.length ? user.farmIds : [];
  const { rows } = await query(
    `SELECT id, farm_id, channel, notification_type, title, body, status, created_at
       FROM notifications
      WHERE channel = 'IN_APP'
        AND (user_id = $1 OR (user_id IS NULL AND buyer_id IS NULL AND farm_id = ANY($2::int[])))
      ORDER BY created_at DESC LIMIT $3`,
    [user.id, farmIds, limit]
  );
  return camelizeAll(rows);
}

export async function markRead(user, id) {
  const { rowCount } = await query(
    `UPDATE notifications SET status = 'READ'
      WHERE id = $1 AND channel = 'IN_APP'
        AND (user_id = $2 OR (user_id IS NULL AND buyer_id IS NULL AND farm_id = ANY($3::int[])))`,
    [id, user.id, user.farmIds]
  );
  if (!rowCount) throw notFound('Notification not found');
}

/** Outbound WhatsApp log for a farm (development visibility of mock/live message status). */
export async function listWhatsAppLog(farmId, limit = 50) {
  const { rows } = await query(
    `SELECT n.id, n.notification_type, n.title, n.body, n.status, n.provider_message_id, n.error, n.sent_at, n.created_at,
            n.campaign_id, bp.organisation_name AS buyer_name
       FROM notifications n LEFT JOIN buyer_profiles bp ON bp.id = n.buyer_id
      WHERE n.farm_id = $1 AND n.channel = 'WHATSAPP'
      ORDER BY n.created_at DESC LIMIT $2`,
    [farmId, limit]
  );
  return camelizeAll(rows);
}
