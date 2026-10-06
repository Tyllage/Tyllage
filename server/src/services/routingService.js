/**
 * Dynamic Perishable Inventory Routing — recommends which sales route unallocated produce should take
 * as it ages: premium sale → community promotion → Rescue pricing → B2B clearance → donation/alternative use.
 * Stage windows are a % of the produce's shelf life (configurable per crop and per farm, and by policy).
 * Recommendations only — nothing moves without farmer approval.
 */
import { getPolicy } from './policyService.js';
import { addDays, daysBetween, todayISO } from '../utils/dates.js';

const STAGE_ACTION = {
  PRE_HARVEST: { action: 'RUN_HARVESTMATCH', advice: 'Match with B2B and recurring buyers before harvest' },
  PREMIUM: { action: 'RUN_HARVESTMATCH', advice: 'Sell at full price to B2B and direct buyers' },
  COMMUNITY: { action: 'COMMUNITY_PROMOTION', advice: 'Promote to community buyers or group into a Community Drop / DemandPool' },
  RESCUE: { action: 'MOVE_TO_RESCUE', advice: 'Offer through Tyllage Rescue at a lower price' },
  CLEARANCE: { action: 'B2B_CLEARANCE', advice: 'Clear remaining stock to wholesale or chef-pack buyers' },
  DONATION: { action: 'RECORD_DISPOSITION', advice: 'Donate or put to alternative use, and record it' },
};
const URGENCY = { PRE_HARVEST: 'LOW', PREMIUM: 'LOW', COMMUNITY: 'MEDIUM', RESCUE: 'HIGH', CLEARANCE: 'HIGH', DONATION: 'CRITICAL' };

export function routingFor(batch, today = todayISO()) {
  const policy = getPolicy();
  const shelfLifeDays = Number(batch.shelf_life_days) || policy.defaultShelfLifeDays;
  const day = daysBetween(batch.harvest_date, today);
  const stages = policy.routingStages;

  let stage;
  let nextStage = null;
  let nextStageOn = null;
  if (day < 0) {
    stage = { key: 'PRE_HARVEST', label: 'Pre-harvest planning' };
    nextStage = stages[0];
    nextStageOn = batch.harvest_date;
  } else {
    const pctElapsed = (day / shelfLifeDays) * 100;
    const idx = stages.findIndex((s) => s.upToPct === null || pctElapsed <= s.upToPct);
    stage = stages[idx];
    if (stage.upToPct !== null) {
      nextStage = stages[idx + 1];
      nextStageOn = addDays(batch.harvest_date, Math.floor((stage.upToPct / 100) * shelfLifeDays) + 1);
    }
  }

  return {
    stage: stage.key,
    label: stage.label,
    urgency: URGENCY[stage.key],
    daysSinceHarvest: day,
    shelfLifeDays,
    nextStage: nextStage ? { key: nextStage.key, label: nextStage.label, on: nextStageOn } : null,
    ...STAGE_ACTION[stage.key],
  };
}
