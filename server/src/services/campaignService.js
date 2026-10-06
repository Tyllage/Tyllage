/**
 * Tyllage Connect campaigns: backend builds approved context from DB records → AI (or mock) writes copy
 * → farm admin reviews/edits → approves → sends. Recipients are always selected by the backend.
 */
import { z } from 'zod';
import { query } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { camelize, camelizeAll } from '../utils/case.js';
import { notFound, badRequest, conflict } from '../utils/errors.js';
import { round2 } from '../utils/numbers.js';
import { BUSINESS_BUYER_TYPES } from '../config/rules.js';
import { findBatchById } from '../models/harvestModel.js';
import { assertFarmAdmin, assertFarmAccess } from './farmAccessService.js';
import { generateCampaignCopy, findUnapprovedPrices } from './openaiService.js';
import { sendWhatsApp } from './notificationService.js';
import { logAudit } from './auditService.js';
import { RESCUE_DISCLAIMER } from './rescueService.js';

export const CAMPAIGN_TYPES = ['HARVEST_ANNOUNCEMENT', 'RESCUE_ALERT', 'B2B_AVAILABILITY', 'COMMUNITY_DROP', 'DEMAND_RECOVERY', 'CUSTOMER_RECOMMENDATION'];
export const AUDIENCES = ['ALL_BUYERS', 'BUSINESS_BUYERS', 'CONSUMERS', 'COMMUNITY'];
const DEFAULT_AUDIENCE = {
  HARVEST_ANNOUNCEMENT: 'ALL_BUYERS',
  RESCUE_ALERT: 'CONSUMERS',
  B2B_AVAILABILITY: 'BUSINESS_BUYERS',
  COMMUNITY_DROP: 'COMMUNITY',
  DEMAND_RECOVERY: 'BUSINESS_BUYERS',
  CUSTOMER_RECOMMENDATION: 'CONSUMERS',
};
const REASON_LABELS = {
  COSMETIC_IMPERFECTION: 'Cosmetic imperfection',
  SURPLUS: 'Surplus harvest',
  SHORT_DATED: 'Short-dated',
  IRREGULAR_SIZE: 'Irregular size',
  OTHER: 'Other',
};

const generateSchema = z.object({
  campaignType: z.enum(CAMPAIGN_TYPES),
  audience: z.enum(AUDIENCES).optional(),
  harvestBatchId: z.coerce.number().int().positive().optional(),
  rescueListingId: z.coerce.number().int().positive().optional(),
  communityDropId: z.coerce.number().int().positive().optional(),
});
const updateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  finalContent: z.string().trim().min(10).max(4096).optional(),
});

/** Builds the approved business context for the AI strictly from the farm's own records. */
async function buildContext(farmId, d) {
  const farm = (await query('SELECT name FROM farms WHERE id = $1', [farmId])).rows[0];
  const base = { campaignType: d.campaignType, farm: farm.name };

  if (d.campaignType === 'RESCUE_ALERT') {
    if (!d.rescueListingId) throw badRequest('rescueListingId is required for a Rescue alert', 'VALIDATION_ERROR');
    const { rows } = await query(
      `SELECT rl.*, rs.available_quantity, p.name AS produce, p.unit FROM rescue_listings rl
         JOIN rescue_stock rs ON rs.rescue_listing_id = rl.id
         JOIN harvest_batches hb ON hb.id = rl.harvest_batch_id JOIN produce p ON p.id = hb.produce_id
        WHERE rl.id = $1 AND rl.farm_id = $2`,
      [d.rescueListingId, farmId]
    );
    const r = rows[0];
    if (!r) throw notFound('Rescue listing not found for this farm');
    if (r.status !== 'ACTIVE') throw conflict('Rescue listing is not active', 'RESCUE_NOT_ACTIVE');
    return {
      context: {
        ...base, produce: r.produce, unit: r.unit, quantity: round2(r.available_quantity),
        originalPrice: r.original_price, rescuePrice: r.rescue_price, reason: r.reason, reasonLabel: REASON_LABELS[r.reason],
        collectionDeadline: new Date(r.collection_deadline).toISOString(), disclaimer: RESCUE_DISCLAIMER,
      },
      title: `Rescue: ${r.produce}`,
      refs: { rescueListingId: r.id, harvestBatchId: r.harvest_batch_id },
    };
  }

  if (d.campaignType === 'COMMUNITY_DROP') {
    if (!d.communityDropId) throw badRequest('communityDropId is required for a Community Drop message', 'VALIDATION_ERROR');
    const { rows } = await query('SELECT * FROM community_drops WHERE id = $1 AND farm_id = $2', [d.communityDropId, farmId]);
    const c = rows[0];
    if (!c) throw notFound('Community Drop not found for this farm');
    return {
      context: {
        ...base, community: c.community_name, collectionPoint: c.collection_point, dropDate: c.drop_date,
        windowStart: c.window_start.slice(0, 5), windowEnd: c.window_end.slice(0, 5),
      },
      title: `Community Drop: ${c.community_name}`,
      refs: { communityDropId: c.id },
    };
  }

  if (d.campaignType === 'CUSTOMER_RECOMMENDATION') {
    const { rows } = await query(
      `SELECT p.name AS produce, p.unit, hb.preferred_price AS price, bs.remaining_quantity AS quantity
         FROM harvest_batches hb JOIN produce p ON p.id = hb.produce_id JOIN batch_stock bs ON bs.harvest_batch_id = hb.id
        WHERE hb.farm_id = $1 AND hb.status <> 'CLOSED' AND bs.remaining_quantity > 0
        ORDER BY hb.harvest_date ASC LIMIT 4`,
      [farmId]
    );
    if (!rows.length) throw conflict('No unallocated produce to recommend', 'NOTHING_AVAILABLE');
    return {
      context: { ...base, items: rows.map((r) => ({ ...r, quantity: round2(r.quantity) })) },
      title: 'Fresh this week',
      refs: {},
    };
  }

  // Batch-based messages.
  if (!d.harvestBatchId) throw badRequest('harvestBatchId is required for this campaign type', 'VALIDATION_ERROR');
  const b = await findBatchById(d.harvestBatchId);
  if (!b || b.farm_id !== farmId) throw notFound('Harvest batch not found for this farm');
  const remaining = round2(Math.max(0, b.remaining_quantity));
  if (remaining <= 0) throw conflict('This batch has no unallocated produce to promote', 'NOTHING_AVAILABLE');
  const titles = { B2B_AVAILABILITY: 'B2B availability', DEMAND_RECOVERY: 'Demand recovery', HARVEST_ANNOUNCEMENT: 'Harvest announcement' };
  return {
    context: {
      ...base, produce: b.produce_name, unit: b.unit, quantity: remaining, harvestDate: b.harvest_date,
      price: b.preferred_price, grade: b.grade,
    },
    title: `${titles[d.campaignType]}: ${b.produce_name}`,
    refs: { harvestBatchId: b.id },
  };
}

export async function generateCampaign(user, farmId, input, ip) {
  assertFarmAdmin(user, farmId);
  const d = validate(generateSchema, input);
  const { context, title, refs } = await buildContext(farmId, d);
  const ai = await generateCampaignCopy(context);
  const audience = d.audience || DEFAULT_AUDIENCE[d.campaignType];

  const { rows } = await query(
    `INSERT INTO campaigns (farm_id, campaign_type, audience, title, context, generated_content, final_content, generation_mode,
                            harvest_batch_id, rescue_listing_id, community_drop_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [farmId, d.campaignType, audience, title, JSON.stringify(context), ai.content, ai.mode,
      refs.harvestBatchId ?? null, refs.rescueListingId ?? null, refs.communityDropId ?? null, user.id]
  );
  await logAudit({ farmId, userId: user.id, action: 'CAMPAIGN_GENERATED', entityType: 'campaign', entityId: rows[0].id, details: { type: d.campaignType, mode: ai.mode }, ip });
  const recipients = await resolveRecipients(farmId, audience);
  return { ...camelize(rows[0]), warnings: ai.warnings, recipientsPreview: recipients.length };
}

async function loadCampaign(id) {
  const { rows } = await query(
    `SELECT c.*, u.full_name AS approved_by_name FROM campaigns c LEFT JOIN users u ON u.id = c.approved_by WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) throw notFound('Campaign not found');
  return rows[0];
}

export async function listCampaigns(farmId) {
  const { rows } = await query(
    `SELECT c.*, u.full_name AS approved_by_name FROM campaigns c LEFT JOIN users u ON u.id = c.approved_by
      WHERE c.farm_id = $1 ORDER BY c.created_at DESC`,
    [farmId]
  );
  return camelizeAll(rows);
}

export async function getCampaign(user, id) {
  const c = await loadCampaign(id);
  assertFarmAccess(user, c.farm_id);
  const recipients = await resolveRecipients(c.farm_id, c.audience);
  // Re-check on every read so edits that introduce an unapproved price are flagged too.
  const unapproved = findUnapprovedPrices(c.final_content, c.context);
  const warnings = unapproved.length
    ? [`Message mentions price(s) not in the approved context: ${unapproved.map((p) => `$${p}`).join(', ')}. Check before approving.`]
    : [];
  return { ...camelize(c), recipientsPreview: recipients.length, warnings };
}

export async function updateCampaign(user, id, input) {
  const c = await loadCampaign(id);
  assertFarmAdmin(user, c.farm_id);
  if (c.status !== 'DRAFT') throw conflict('Only draft campaigns can be edited', 'CAMPAIGN_NOT_DRAFT');
  const d = validate(updateSchema, input);
  await query(
    'UPDATE campaigns SET title = COALESCE($1, title), final_content = COALESCE($2, final_content), updated_at = NOW() WHERE id = $3',
    [d.title ?? null, d.finalContent ?? null, id]
  );
  return getCampaign(user, id);
}

export async function approveCampaign(user, id, ip) {
  const c = await loadCampaign(id);
  assertFarmAdmin(user, c.farm_id);
  if (c.status !== 'DRAFT') throw conflict('Only draft campaigns can be approved', 'CAMPAIGN_NOT_DRAFT');
  await query(`UPDATE campaigns SET status = 'APPROVED', approved_by = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2`, [user.id, id]);
  await logAudit({ farmId: c.farm_id, userId: user.id, action: 'CAMPAIGN_APPROVED', entityType: 'campaign', entityId: id, ip });
  return getCampaign(user, id);
}

export async function cancelCampaign(user, id, ip) {
  const c = await loadCampaign(id);
  assertFarmAdmin(user, c.farm_id);
  if (!['DRAFT', 'APPROVED'].includes(c.status)) throw conflict('This campaign can no longer be cancelled', 'CAMPAIGN_SENT');
  await query(`UPDATE campaigns SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [id]);
  await logAudit({ farmId: c.farm_id, userId: user.id, action: 'CAMPAIGN_CANCELLED', entityType: 'campaign', entityId: id, ip });
  return getCampaign(user, id);
}

/**
 * Backend-only recipient selection: active, WhatsApp-opted-in buyers with a phone number,
 * filtered by audience and limited to buyers with a relationship to this farm.
 */
export async function resolveRecipients(farmId, audience) {
  const typeFilter = {
    ALL_BUYERS: null,
    BUSINESS_BUYERS: BUSINESS_BUYER_TYPES,
    CONSUMERS: ['CONSUMER'],
    COMMUNITY: ['COMMUNITY', 'CONSUMER'],
  }[audience];
  const { rows } = await query(
    `SELECT bp.id, bp.organisation_name, bp.contact_phone, bp.user_id FROM buyer_profiles bp
      WHERE bp.is_active AND bp.whatsapp_opt_in AND bp.contact_phone IS NOT NULL
        AND ($2::text[] IS NULL OR bp.buyer_type = ANY($2::text[]))
        AND (bp.managed_by_farm_id = $1
             OR EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = bp.id AND o.farm_id = $1)
             OR EXISTS (SELECT 1 FROM demand_requests dr WHERE dr.buyer_id = bp.id AND (dr.farm_id = $1 OR dr.farm_id IS NULL)))`,
    [farmId, typeFilter]
  );
  return rows;
}

/** Sends an APPROVED campaign via WhatsApp (mock mode without credentials). */
export async function sendCampaign(user, id, ip) {
  const c = await loadCampaign(id);
  assertFarmAdmin(user, c.farm_id);
  if (c.status !== 'APPROVED') throw conflict('Campaigns must be approved before sending', 'CAMPAIGN_NOT_APPROVED');

  // Claim the campaign first so a double-click can't send twice.
  const claim = await query(`UPDATE campaigns SET status = 'SENT', sent_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'APPROVED'`, [id]);
  if (!claim.rowCount) throw conflict('Campaign is already being sent', 'CAMPAIGN_NOT_APPROVED');

  const recipients = await resolveRecipients(c.farm_id, c.audience);
  const results = [];
  for (const r of recipients) {
    try {
      const res = await sendWhatsApp({
        farmId: c.farm_id, buyerId: r.id, campaignId: id, type: c.campaign_type, title: c.title, body: c.final_content, phone: r.contact_phone,
      });
      results.push(res.status);
    } catch {
      // One failed recipient must not abort the rest of the campaign.
      results.push('FAILED');
    }
  }
  await query('UPDATE campaigns SET recipients_count = $1 WHERE id = $2', [recipients.length, id]);
  await logAudit({ farmId: c.farm_id, userId: user.id, action: 'CAMPAIGN_SENT', entityType: 'campaign', entityId: id, details: { recipients: recipients.length }, ip });

  const summary = results.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {});
  return { campaign: await getCampaign(user, id), delivery: summary };
}
