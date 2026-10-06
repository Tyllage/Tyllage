/** Buyer/consumer-facing supply views. Uses public DTOs only (no minimum prices or internal notes). */
import { query } from '../config/db.js';
import { BATCH_SELECT, toPublicBatchDTO } from '../models/harvestModel.js';
import { addDays, todayISO } from '../utils/dates.js';
import { camelizeAll } from '../utils/case.js';
import { notFound } from '../utils/errors.js';

const AVAILABLE_NOW_DAYS = 3;

export async function getSupply() {
  const today = todayISO();
  const { rows } = await query(
    `${BATCH_SELECT}
      WHERE hb.status <> 'CLOSED' AND f.is_active AND bs.remaining_quantity > 0 AND hb.harvest_date >= $1
      ORDER BY hb.harvest_date ASC, p.name ASC`,
    [addDays(today, -2)]
  );
  const items = rows.map(toPublicBatchDTO);
  const cutoff = addDays(today, AVAILABLE_NOW_DAYS);
  return {
    availableNow: items.filter((b, i) => b.harvestDate <= cutoff || rows[i].marked_available),
    growingSoon: items.filter((b, i) => !(b.harvestDate <= cutoff || rows[i].marked_available)),
  };
}

export async function listPublicFarms() {
  const { rows } = await query(
    `SELECT f.id, f.name, f.slug, f.description, f.region, f.is_demo,
            COALESCE((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'category', p.category) ORDER BY p.name)
                        FROM produce p WHERE p.farm_id = f.id AND p.is_active), '[]'::json) AS produce
       FROM farms f WHERE f.is_active ORDER BY f.name`
  );
  return camelizeAll(rows);
}

/** Public farm profile: who the farm is, what it grows, what's available, Rescue offers and Community Drops. */
export async function getFarmProfile(farmId) {
  const { rows } = await query(
    `SELECT id, name, slug, description, region, fulfilment_methods, is_demo, created_at FROM farms WHERE id = $1 AND is_active`,
    [farmId]
  );
  if (!rows[0]) throw notFound('Farm not found');
  const today = todayISO();
  const [produce, supply, rescue, drops] = await Promise.all([
    query('SELECT id, name, category, unit, default_price, min_order_quantity FROM produce WHERE farm_id = $1 AND is_active ORDER BY name', [farmId]),
    query(
      `${BATCH_SELECT} WHERE hb.farm_id = $1 AND hb.status <> 'CLOSED' AND bs.remaining_quantity > 0 AND hb.harvest_date >= $2
        ORDER BY hb.harvest_date`,
      [farmId, addDays(today, -2)]
    ),
    query(
      `SELECT rl.id, p.name AS produce_name, p.unit, rl.original_price, rl.rescue_price, rl.reason, rs.available_quantity, rl.collection_deadline
         FROM rescue_listings rl JOIN rescue_stock rs ON rs.rescue_listing_id = rl.id
         JOIN harvest_batches hb ON hb.id = rl.harvest_batch_id JOIN produce p ON p.id = hb.produce_id
        WHERE rl.farm_id = $1 AND rl.status = 'ACTIVE' AND rl.collection_deadline > NOW() AND rs.available_quantity > 0`,
      [farmId]
    ),
    query(
      `SELECT id, community_name, collection_point, drop_date, window_start, window_end FROM community_drops
        WHERE farm_id = $1 AND status = 'SCHEDULED' AND drop_date >= $2 ORDER BY drop_date`,
      [farmId, today]
    ),
  ]);
  return {
    ...camelizeAll(rows)[0],
    produce: camelizeAll(produce.rows),
    supply: supply.rows.map(toPublicBatchDTO),
    rescue: camelizeAll(rescue.rows),
    communityDrops: camelizeAll(drops.rows),
  };
}
