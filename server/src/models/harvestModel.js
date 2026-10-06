import { query } from '../config/db.js';
import { camelize } from '../utils/case.js';
import { batchMetrics, deriveBatchStatus } from '../services/riskService.js';
import { routingFor } from '../services/routingService.js';
import { batchMarginGuard } from '../services/marginService.js';

export const BATCH_SELECT = `
  SELECT hb.*, p.name AS produce_name, p.category, p.unit, p.shelf_life_days, p.min_order_quantity,
         f.name AS farm_name, f.region AS farm_region, f.fulfilment_methods, f.min_margin_pct, f.fulfilment_costs,
         bs.harvest_quantity, bs.allocated_quantity, bs.rescue_quantity,
         bs.rescue_sold_quantity, bs.remaining_quantity, bs.disposed_quantity,
         (SELECT COALESCE(SUM(oi.line_total), 0) FROM order_items oi
            JOIN allocations a ON a.order_item_id = oi.id AND a.status = 'ACTIVE'
           WHERE oi.harvest_batch_id = hb.id) AS committed_revenue
    FROM harvest_batches hb
    JOIN produce p ON p.id = hb.produce_id
    JOIN farms f ON f.id = hb.farm_id
    JOIN batch_stock bs ON bs.harvest_batch_id = hb.id`;

const runner = (client) => client || { query };

export async function findBatchById(id, client) {
  const { rows } = await runner(client).query(`${BATCH_SELECT} WHERE hb.id = $1`, [id]);
  return rows[0] || null;
}

/** Locks the batch row for the rest of the transaction, then returns it with fresh stock figures. */
export async function lockBatch(id, client) {
  const { rowCount } = await client.query('SELECT id FROM harvest_batches WHERE id = $1 FOR UPDATE', [id]);
  if (!rowCount) return null;
  return findBatchById(id, client);
}

export async function listBatches(farmId, { includeClosed = false } = {}) {
  const { rows } = await query(
    `${BATCH_SELECT}
      WHERE hb.farm_id = $1 ${includeClosed ? '' : "AND hb.status <> 'CLOSED'"}
      ORDER BY hb.harvest_date ASC, hb.id ASC`,
    [farmId]
  );
  return rows;
}

/** Re-derives and persists the batch status after any stock-changing operation. */
export async function syncBatchStatus(batchId, client) {
  const row = await findBatchById(batchId, client);
  if (!row) return null;
  const next = deriveBatchStatus(row);
  if (next !== row.status) {
    await runner(client).query('UPDATE harvest_batches SET status = $1, updated_at = NOW() WHERE id = $2', [next, batchId]);
    row.status = next;
  }
  return row;
}

/** API shape for a batch: camelCase fields plus live coverage/risk metrics. Hides nothing farm-side. */
export function toBatchDTO(row) {
  if (!row) return null;
  const metrics = batchMetrics(row);
  const dto = camelize(row);
  delete dto.markedAvailable;
  const routing = row.status === 'CLOSED' ? null : { ...routingFor(row), active: metrics.unallocatedQuantity > 0 };
  return { ...dto, markedAvailable: row.marked_available, ...metrics, routing, marginGuard: batchMarginGuard(row) };
}

/** Public/buyer-facing shape: never exposes the farm's minimum acceptable price or internal notes. */
export function toPublicBatchDTO(row) {
  return {
    id: row.id,
    farmId: row.farm_id,
    farmName: row.farm_name,
    produceId: row.produce_id,
    produceName: row.produce_name,
    category: row.category,
    unit: row.unit,
    harvestDate: row.harvest_date,
    grade: row.grade,
    price: row.preferred_price,
    availableQuantity: Math.max(0, Number(row.remaining_quantity)),
    minOrderQuantity: Number(row.min_order_quantity || 0),
    status: row.status,
  };
}
