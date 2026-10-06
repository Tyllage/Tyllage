// Transparent, rule-based business configuration. None of this is "AI".

// Demand Coverage -> risk level thresholds (percent).
export const RISK_THRESHOLDS = {
  LOW: 80, // coverage >= 80%
  MEDIUM: 50, // 50% <= coverage < 80%
  // below 50% = HIGH
};

// A HIGH-risk batch harvesting within this many days is flagged AT_RISK.
export const AT_RISK_WINDOW_DAYS = 3;

// HarvestMatch factor weights (sum = 100).
export const MATCH_WEIGHTS = {
  produce: 30,
  date: 20,
  price: 20,
  quantity: 10,
  reliability: 10,
  location: 10,
};

// Leafy greens/herbs: days after harvest that produce is still considered fresh for supply.
export const FRESHNESS_WINDOW_DAYS = 7;

// Neutral score used when a buyer does not have enough order history.
export const NEUTRAL_RELIABILITY_SCORE = 60;
export const MIN_ORDERS_FOR_RELIABILITY = 2;

// Matches at or above this score count as "strong" demand during recovery.
export const STRONG_MATCH_THRESHOLD = 70;

export const BUSINESS_BUYER_TYPES = ['RESTAURANT', 'CAFE', 'HOTEL', 'CATERER', 'RETAILER', 'WHOLESALER'];
export const BUYER_TYPES = [...BUSINESS_BUYER_TYPES, 'CONSUMER', 'COMMUNITY'];

export const REGIONS = ['CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST'];
export const COLLECTION_METHODS = ['FARM_PICKUP', 'DELIVERY', 'COMMUNITY_DROP'];

// Neighbouring Singapore regions, used for location compatibility.
export const ADJACENT_REGIONS = {
  CENTRAL: ['NORTH', 'NORTH_EAST', 'EAST', 'WEST'],
  NORTH: ['CENTRAL', 'NORTH_EAST', 'WEST'],
  NORTH_EAST: ['CENTRAL', 'NORTH', 'EAST'],
  EAST: ['CENTRAL', 'NORTH_EAST'],
  WEST: ['CENTRAL', 'NORTH'],
};

// Rescue guard-rails.
export const RESCUE_MAX_DEADLINE_DAYS = 14;
export const RESCUE_MAX_DISCOUNT_PCT = 70;

// Dynamic Perishable Inventory Routing: stages as a % of the produce's shelf life since harvest.
export const DEFAULT_SHELF_LIFE_DAYS = 7;
export const ROUTING_STAGES = [
  { key: 'PREMIUM', label: 'Premium sale — B2B & direct', upToPct: 30 },
  { key: 'COMMUNITY', label: 'Community promotion', upToPct: 55 },
  { key: 'RESCUE', label: 'Rescue pricing', upToPct: 80 },
  { key: 'CLEARANCE', label: 'B2B clearance', upToPct: 100 },
  { key: 'DONATION', label: 'Donation / alternative use', upToPct: null },
];

// DemandPool: smallest combined quantity worth fulfilling as one pooled farm order.
export const DEMANDPOOL_MIN_VIABLE_KG = 5;

// Demand Recovery / analytics channels (matches the proposal's recovery allocation table).
export const CHANNELS = {
  RESTAURANT_NETWORK: 'Restaurant network',
  HOTEL: 'Hotel buyers',
  RETAIL_WHOLESALE: 'Retail & wholesale',
  COMMUNITY: 'Community / Community Drops',
  CONSUMER: 'Consumers',
};

/** Groups buyer types into channels. */
export function buyerChannel(buyerType) {
  if (['RESTAURANT', 'CAFE', 'CATERER'].includes(buyerType)) return 'RESTAURANT_NETWORK';
  if (buyerType === 'HOTEL') return 'HOTEL';
  if (['RETAILER', 'WHOLESALER'].includes(buyerType)) return 'RETAIL_WHOLESALE';
  if (buyerType === 'COMMUNITY') return 'COMMUNITY';
  return 'CONSUMER';
}

export const emptyChannelTotals = () => Object.fromEntries(Object.keys(CHANNELS).map((k) => [k, 0]));
