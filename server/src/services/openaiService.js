/**
 * Tyllage Connect copywriting. OpenAI ONLY writes message copy from backend-approved context.
 * It never modifies inventory, prices, discounts, allocations, permissions or recipients.
 *
 * Without OPENAI_API_KEY (or if the API call fails) deterministic mock copy is produced so
 * development and demos keep working.
 */
import env from '../config/env.js';

const SYSTEM_PROMPT = `You write short outreach messages for a local Singapore farm, sent via WhatsApp.
Rules:
- Use ONLY the facts in the JSON context. Never invent prices, quantities, dates, discounts or farm claims.
- Never make food-safety, health or nutrition claims.
- If the context includes a "disclaimer", include it verbatim.
- Plain text, friendly and professional, at most 2 emoji, under 600 characters.
- End with a clear next step (e.g. "Reply to reserve" or "Order on Tyllage").`;

export const isOpenAIConfigured = () => Boolean(env.OPENAI_API_KEY);

const money = (v) => (v === undefined || v === null ? '' : `$${Number(v).toFixed(2)}`);

function formatDeadline(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Deterministic template copy used when OpenAI is not configured or unavailable. */
export function mockCopy(ctx) {
  const unit = ctx.unit || 'kg';
  switch (ctx.campaignType) {
    case 'RESCUE_ALERT':
      return [
        `🌱 Tyllage Rescue: ${ctx.produce} from ${ctx.farm}`,
        `${ctx.quantity}${unit} available at ${money(ctx.rescuePrice)}/${unit} (usually ${money(ctx.originalPrice)}).`,
        `Reason: ${ctx.reasonLabel}.`,
        `Collect before ${formatDeadline(ctx.collectionDeadline)}.`,
        ctx.disclaimer,
        'Reserve on Tyllage while stock lasts.',
      ].filter(Boolean).join('\n');
    case 'B2B_AVAILABILITY':
      return [
        `Hello from ${ctx.farm}.`,
        `We have ${ctx.quantity}${unit} of ${ctx.grade ? `${ctx.grade.toLowerCase()}-grade ` : ''}${ctx.produce} harvesting on ${ctx.harvestDate}, at ${money(ctx.price)}/${unit}.`,
        'Reply or submit demand on Tyllage to secure supply for your kitchen.',
      ].join('\n');
    case 'DEMAND_RECOVERY':
      return [
        `${ctx.farm}: fresh ${ctx.produce} now available.`,
        `${ctx.quantity}${unit} freshly harvested on ${ctx.harvestDate} at ${money(ctx.price)}/${unit}.`,
        'Reply today to add it to your next order.',
      ].join('\n');
    case 'COMMUNITY_DROP':
      return [
        `📍 Community Drop — ${ctx.community}`,
        `${ctx.farm} will be at ${ctx.collectionPoint} on ${ctx.dropDate}, ${ctx.windowStart}–${ctx.windowEnd}.`,
        'Add your order to this drop on Tyllage and collect with your neighbours.',
      ].join('\n');
    case 'CUSTOMER_RECOMMENDATION':
      return [
        `Fresh this week from ${ctx.farm}:`,
        ...(ctx.items || []).map((i) => `• ${i.produce} — ${money(i.price)}/${i.unit} (${i.quantity}${i.unit} available)`),
        'Order on Tyllage.',
      ].join('\n');
    case 'HARVEST_ANNOUNCEMENT':
    default:
      return [
        `🥬 Harvest update from ${ctx.farm}`,
        `${ctx.produce} harvesting on ${ctx.harvestDate}: ${ctx.quantity}${unit} available at ${money(ctx.price)}/${unit}.`,
        'Register your interest on Tyllage.',
      ].join('\n');
  }
}

/**
 * Flags dollar amounts in generated copy that don't appear in the approved context, so the farm admin
 * can catch any invented price before approving.
 */
export function findUnapprovedPrices(content, ctx) {
  const allowed = new Set();
  const collect = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') allowed.add(Number(v).toFixed(2));
    else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) allowed.add(Number(v).toFixed(2));
    else if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(ctx);
  const found = [...String(content).matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]).toFixed(2));
  return [...new Set(found.filter((p) => !allowed.has(p)))];
}

export async function generateCampaignCopy(ctx) {
  if (!isOpenAIConfigured()) {
    return { content: mockCopy(ctx), mode: 'MOCK', warnings: [] };
  }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.6,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Write a ${ctx.campaignType} message using this approved context:\n${JSON.stringify(ctx, null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!res.ok || !content) throw new Error(data?.error?.message || `HTTP ${res.status}`);

    const unapproved = findUnapprovedPrices(content, ctx);
    const warnings = unapproved.length
      ? [`Generated copy mentions price(s) not in the approved context: ${unapproved.map((p) => `$${p}`).join(', ')}. Edit before approving.`]
      : [];
    return { content, mode: 'OPENAI', warnings };
  } catch (err) {
    if (!env.isTest) console.error('[openai] generation failed, using mock copy:', err.message);
    return { content: mockCopy(ctx), mode: 'MOCK', warnings: ['OpenAI was unavailable, so template copy was used.'] };
  }
}
