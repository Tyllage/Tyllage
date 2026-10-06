export const kg = (n, unit = 'kg') => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
};

export const money = (n) => {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(Number.isInteger(Number(n)) ? 0 : 1)}%`);

export function date(iso, opts = {}) {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString('en-SG', { weekday: opts.weekday ? 'short' : undefined, day: 'numeric', month: 'short', year: opts.year ? 'numeric' : undefined });
}

export function dateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago". */
export function relativeDay(iso) {
  if (!iso) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDaysISO = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Value for <input type="datetime-local"> n days from now. */
export const localDateTimeInput = (daysAhead = 1, hour = 18) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const LABELS = {
  FARM_PICKUP: 'Farm pickup',
  DELIVERY: 'Delivery',
  COMMUNITY_DROP: 'Community Drop',
  PARTIALLY_ALLOCATED: 'Partially allocated',
  FULLY_ALLOCATED: 'Fully allocated',
  AT_RISK: 'At risk',
  PARTIALLY_FULFILLED: 'Partially fulfilled',
  RESCUE_ELIGIBLE: 'Rescue eligible',
  COSMETIC_IMPERFECTION: 'Cosmetic imperfection',
  SHORT_DATED: 'Short-dated',
  IRREGULAR_SIZE: 'Irregular size',
  LEAFY_GREENS: 'Leafy greens',
  NORTH_EAST: 'North-East',
  HARVESTMATCH: 'HarvestMatch',
  HARVEST_ANNOUNCEMENT: 'Harvest announcement',
  RESCUE_ALERT: 'Rescue alert',
  B2B_AVAILABILITY: 'B2B availability',
  DEMAND_RECOVERY: 'Demand recovery',
  CUSTOMER_RECOMMENDATION: 'Customer recommendation',
  ALL_BUYERS: 'All buyers',
  BUSINESS_BUYERS: 'Business buyers',
  MOCK_SENT: 'Sent (mock)',
  OPENAI: 'OpenAI',
  MOCK: 'Template (mock)',
  platform_admin: 'Platform admin',
  farm_admin: 'Farm admin',
  farm_staff: 'Farm staff',
  business_buyer: 'Business buyer',
  consumer: 'Consumer',
};

/** Human label for an enum value: explicit map first, else Title Case. */
export function label(v) {
  if (v === null || v === undefined) return '—';
  if (LABELS[v]) return LABELS[v];
  return String(v)
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
