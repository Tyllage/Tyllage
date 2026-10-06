/**
 * Platform policies: the transparent business rules (risk thresholds, HarvestMatch weights, Rescue
 * guard-rails, routing windows…) editable by a platform admin. Code defaults in config/rules.js apply
 * until overridden. Values are cached in memory so rule checks stay synchronous.
 */
import { z } from 'zod';
import { query } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { badRequest, conflict } from '../utils/errors.js';
import * as R from '../config/rules.js';
import { logAudit } from './auditService.js';

export const POLICY_DEFAULTS = Object.freeze({
  riskThresholds: R.RISK_THRESHOLDS,
  atRiskWindowDays: R.AT_RISK_WINDOW_DAYS,
  matchWeights: R.MATCH_WEIGHTS,
  freshnessWindowDays: R.FRESHNESS_WINDOW_DAYS,
  strongMatchThreshold: R.STRONG_MATCH_THRESHOLD,
  neutralReliabilityScore: R.NEUTRAL_RELIABILITY_SCORE,
  rescueMaxDeadlineDays: R.RESCUE_MAX_DEADLINE_DAYS,
  rescueMaxDiscountPct: R.RESCUE_MAX_DISCOUNT_PCT,
  defaultShelfLifeDays: R.DEFAULT_SHELF_LIFE_DAYS,
  routingStages: R.ROUTING_STAGES,
  demandPoolMinViableKg: R.DEMANDPOOL_MIN_VIABLE_KG,
  routeWeights: R.ROUTE_WEIGHTS,
  // FarmPool / DemandPool are Post-MVP (proposal v3 §10, Phase 3). Off until a platform admin enables the preview.
  networkFeaturesEnabled: false,
});

const pct = z.number().min(0).max(100);
const SCHEMAS = {
  riskThresholds: z.object({ LOW: pct, MEDIUM: pct }).refine((v) => v.LOW > v.MEDIUM, 'LOW threshold must be above MEDIUM'),
  atRiskWindowDays: z.number().int().min(0).max(30),
  matchWeights: z
    .object({ produce: pct, date: pct, price: pct, quantity: pct, reliability: pct, location: pct })
    .refine((w) => Object.values(w).reduce((s, x) => s + x, 0) === 100, 'Weights must add up to 100'),
  freshnessWindowDays: z.number().int().min(1).max(60),
  strongMatchThreshold: z.number().int().min(0).max(100),
  neutralReliabilityScore: z.number().int().min(0).max(100),
  rescueMaxDeadlineDays: z.number().int().min(1).max(60),
  rescueMaxDiscountPct: z.number().min(0).max(95),
  defaultShelfLifeDays: z.number().int().min(1).max(60),
  routingStages: z
    .array(z.object({ key: z.enum(['PREMIUM', 'COMMUNITY', 'RESCUE', 'CLEARANCE', 'DONATION']), label: z.string().min(2).max(60), upToPct: z.number().min(1).max(300).nullable() }))
    .length(5)
    .refine((s) => s[s.length - 1].upToPct === null && s.slice(0, -1).every((x, i, a) => x.upToPct !== null && (i === 0 || x.upToPct > a[i - 1].upToPct)), 'Stage limits must increase and the last stage must be open-ended'),
  demandPoolMinViableKg: z.number().min(0).max(1000),
  routeWeights: z
    .object({ demandFit: pct, price: pct, margin: pct, volume: pct, fulfilment: pct, reliability: pct, urgency: pct })
    .refine((w) => Object.values(w).reduce((s, x) => s + x, 0) === 100, 'Weights must add up to 100'),
  networkFeaturesEnabled: z.boolean(),
};

let cache = structuredClone(POLICY_DEFAULTS);

/** Current effective policies (synchronous; refreshed by loadPolicies / updatePolicies). */
export const getPolicy = () => cache;

/** Guards the Post-MVP network features (FarmPool, DemandPool). */
export function assertNetworkFeaturesEnabled() {
  if (!cache.networkFeaturesEnabled) {
    throw conflict('FarmPool and DemandPool are Phase 3 features. A platform admin can enable the preview in Policies.', 'FEATURE_NOT_ENABLED');
  }
}

export async function loadPolicies() {
  const next = structuredClone(POLICY_DEFAULTS);
  try {
    const { rows } = await query('SELECT key, value FROM platform_policies');
    for (const r of rows) if (r.key in SCHEMAS && SCHEMAS[r.key].safeParse(r.value).success) next[r.key] = r.value;
  } catch {
    // Table may not exist before migrations run; defaults apply.
  }
  cache = next;
  return cache;
}

export async function listPolicies() {
  await loadPolicies();
  const { rows } = await query(
    `SELECT p.key, p.updated_at, u.full_name AS updated_by_name FROM platform_policies p LEFT JOIN users u ON u.id = p.updated_by`
  );
  const meta = new Map(rows.map((r) => [r.key, r]));
  return Object.keys(POLICY_DEFAULTS).map((key) => ({
    key,
    value: cache[key],
    defaultValue: POLICY_DEFAULTS[key],
    isDefault: !meta.has(key),
    updatedAt: meta.get(key)?.updated_at || null,
    updatedByName: meta.get(key)?.updated_by_name || null,
  }));
}

/** Validates and saves policy overrides. `null` for a key resets it to the default. */
export async function updatePolicies(user, patch, ip) {
  if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) throw badRequest('No policy changes supplied');
  const changes = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in SCHEMAS)) throw badRequest(`Unknown policy: ${key}`, 'VALIDATION_ERROR');
    changes[key] = value === null ? null : validate(SCHEMAS[key], value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) await query('DELETE FROM platform_policies WHERE key = $1', [key]);
    else {
      await query(
        `INSERT INTO platform_policies (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, JSON.stringify(value), user.id]
      );
    }
  }
  await logAudit({ userId: user.id, action: 'POLICY_UPDATED', entityType: 'platform_policy', details: changes, ip });
  return listPolicies();
}
