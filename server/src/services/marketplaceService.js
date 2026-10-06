/** Buyer/consumer-facing supply views. Uses public DTOs only (no minimum prices or internal notes). */
import { query } from '../config/db.js';
import { BATCH_SELECT, toPublicBatchDTO } from '../models/harvestModel.js';
import { addDays, todayISO } from '../utils/dates.js';
import { camelizeAll } from '../utils/case.js';

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
