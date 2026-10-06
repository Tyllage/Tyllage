/**
 * AI assistant (OpenAI) for explanations, demand-insight summaries and campaign variations.
 *
 * Every call builds the exact prompt that would be sent to OpenAI from backend-approved data.
 *  - With OPENAI_API_KEY: the prompt is sent to OpenAI (mode "OPENAI").
 *  - Without a key (or on failure): a deterministic SIMULATED response is produced from the same data,
 *    and clearly labelled, so the pilot can demonstrate how the feature would work.
 * The AI only writes text. It never changes stock, prices, allocations, permissions or recipients.
 */
import env from '../config/env.js';
import { query } from '../config/db.js';
import { notFound, conflict } from '../utils/errors.js';
import { isOpenAIConfigured, callOpenAI, mockCopy } from './openaiService.js';
import { MATCH_SELECT } from './harvestMatchService.js';
import { findBatchById, toBatchDTO } from '../models/harvestModel.js';
import { assertFarmAccess, assertFarmAdmin } from './farmAccessService.js';
import { getDashboard } from './dashboardService.js';
import { marginGuard } from './marginService.js';
import { camelize } from '../utils/case.js';

const SIMULATION_NOTE = 'Simulated response — no OpenAI API key is configured. With a key, this exact prompt is sent to OpenAI.';
const SAFETY = 'Use ONLY the facts in the JSON. Do not invent numbers, buyers, prices or claims. Do not recommend actions the farmer has not been offered. Plain text.';

async function run(kind, prompt, simulate) {
  const base = { kind, prompt, model: env.OPENAI_MODEL };
  if (isOpenAIConfigured()) {
    try {
      return { ...base, mode: 'OPENAI', output: await callOpenAI(prompt) };
    } catch (err) {
      return { ...base, mode: 'SIMULATED', output: simulate(), note: `OpenAI call failed (${err.message}); simulated response shown.` };
    }
  }
  return { ...base, mode: 'SIMULATED', output: simulate(), note: SIMULATION_NOTE };
}

export const aiStatus = () => ({
  mode: isOpenAIConfigured() ? 'OPENAI' : 'SIMULATED',
  model: env.OPENAI_MODEL,
  note: isOpenAIConfigured() ? 'Live OpenAI responses' : SIMULATION_NOTE,
});

// ---------------------------------------------------------------- explain a HarvestMatch recommendation

export async function explainMatch(user, matchId) {
  const { rows } = await query(`${MATCH_SELECT} WHERE hm.id = $1`, [matchId]);
  const m = rows[0] && camelize(rows[0]);
  if (!m) throw notFound('Match not found');
  assertFarmAccess(user, m.farmId);
  const batch = toBatchDTO(await findBatchById(m.harvestBatchId));
  const qty = Number(m.approvedQuantity ?? m.recommendedQuantity);
  const margin = marginGuard({ unitPrice: m.unitPrice, cost: batch.productionCost, minMarginPct: batch.minMarginPct ?? 0, quantity: qty });

  const context = {
    batch: { produce: batch.produceName, harvestDate: batch.harvestDate, unallocated: batch.unallocatedQuantity, unit: batch.unit, routingStage: batch.routing?.label },
    buyer: { name: m.buyerName, type: m.buyerType, requested: m.demandQuantity, requiredDate: m.requiredDate, recurrence: m.recurrence },
    recommendation: { matchScore: m.matchScore, quantity: qty, unitPrice: m.unitPrice, expectedRevenue: Math.round(qty * m.unitPrice * 100) / 100 },
    factorScores: m.scoreBreakdown,
    reasons: m.reasons,
    warnings: m.warnings,
    margin: margin.known ? { perUnit: margin.perUnit, pct: margin.pct, status: margin.status } : 'unknown',
  };
  const prompt = {
    system: `You explain HarvestMatch recommendations to a farm manager in 3-4 short sentences. ${SAFETY} Mention the strongest factor, the weakest factor, and any warning.`,
    user: JSON.stringify(context, null, 2),
  };

  return run('EXPLAIN_MATCH', prompt, () => {
    const factors = Object.entries(m.scoreBreakdown || {}).sort((a, b) => b[1].score - a[1].score);
    const label = { produce: 'produce fit', date: 'timing', price: 'price', quantity: 'quantity fit', reliability: 'buyer reliability', location: 'location' };
    const best = factors[0];
    const worst = factors[factors.length - 1];
    const lines = [
      `${m.buyerName} scores ${m.matchScore}% for ${batch.produceName}: ${qty}${batch.unit} at $${Number(m.unitPrice).toFixed(2)}/${batch.unit} would bring about $${context.recommendation.expectedRevenue.toFixed(2)}.`,
      best && `The strongest factor is ${label[best[0]]} (${best[1].score}/100)${worst && worst[0] !== best[0] ? `, while ${label[worst[0]]} is the weakest (${worst[1].score}/100)` : ''}.`,
      m.warnings?.length ? `Check before approving: ${m.warnings.join('; ')}.` : 'There are no warnings on this match.',
      margin.known ? `Margin Guard: ${margin.message}.` : 'Record a production cost to see the margin on this sale.',
    ];
    return lines.filter(Boolean).join(' ');
  });
}

// ---------------------------------------------------------------- demand-insight summary for a farm

export async function demandInsights(user, farmId) {
  assertFarmAccess(user, farmId);
  const dash = await getDashboard(farmId);
  const context = {
    totals: dash.kpis,
    batches: dash.upcomingHarvest.map((b) => ({
      produce: b.produceName,
      harvestDate: b.harvestDate,
      coverage: b.demandCoverage,
      risk: b.riskLevel,
      unallocated: b.unallocatedQuantity,
      potentialDemand: b.potentialDemand?.quantity ?? 0,
      routingStage: b.routing?.label,
    })),
    actions: dash.actions.map((a) => a.message),
  };
  const prompt = {
    system: `You write a short weekly demand briefing for a farm manager: 3-5 bullet points, most urgent first. ${SAFETY}`,
    user: JSON.stringify(context, null, 2),
  };

  return run('DEMAND_INSIGHTS', prompt, () => {
    const b = context.batches.filter((x) => x.unallocated > 0).sort((x, y) => y.unallocated - x.unallocated);
    const bullets = [];
    bullets.push(`• Overall demand coverage is ${dash.kpis.demandCoverage ?? 0}% (${dash.kpis.confirmedDemand}kg confirmed of ${dash.kpis.expectedHarvest}kg expected).`);
    for (const x of b.slice(0, 3)) {
      const gap = x.potentialDemand >= x.unallocated ? 'enough open demand exists to cover it — run HarvestMatch' : x.potentialDemand > 0 ? `only ${x.potentialDemand}kg of open demand fits — plan recovery or Rescue` : 'no open demand fits — consider outreach, DemandPool or Rescue';
      bullets.push(`• ${x.produce}: ${x.unallocated}kg unallocated (${x.risk || '—'} risk, ${x.routingStage}); ${gap}.`);
    }
    if (!b.length) bullets.push('• Every open batch is fully allocated.');
    if (dash.kpis.rescueQuantity > 0) bullets.push(`• ${dash.kpis.rescueQuantity}kg is committed to Rescue — check reservations before the collection deadlines.`);
    return bullets.join('\n');
  });
}

// ---------------------------------------------------------------- campaign variations

const VARIATIONS = [
  { tone: 'Concise', transform: (t) => t.split('\n').filter(Boolean).slice(0, 3).join('\n') },
  { tone: 'Friendly', transform: (t) => `Hi there! 👋\n${t}\nThank you for supporting local farms.` },
  { tone: 'Urgent', transform: (t) => `⏰ Limited quantity — first come, first served.\n${t}` },
];

export async function campaignVariations(user, campaignId) {
  const { rows } = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
  const c = rows[0];
  if (!c) throw notFound('Campaign not found');
  assertFarmAdmin(user, c.farm_id);
  if (c.status !== 'DRAFT') throw conflict('Variations can only be generated for draft campaigns', 'CAMPAIGN_NOT_DRAFT');

  const prompt = {
    system: `Write 3 variations (concise, friendly, urgent) of a WhatsApp message for a local farm. ${SAFETY} Keep every price, quantity and date exactly as given. Separate variations with "---".`,
    user: JSON.stringify(c.context, null, 2),
  };
  const result = await run('CAMPAIGN_VARIATIONS', prompt, () => {
    const base = mockCopy(c.context);
    return VARIATIONS.map((v) => v.transform(base)).join('\n---\n');
  });
  const texts = result.output.split(/\n?---\n?/).map((t) => t.trim()).filter(Boolean);
  return { ...result, variations: texts.map((text, i) => ({ tone: VARIATIONS[i]?.tone || `Option ${i + 1}`, text })) };
}
