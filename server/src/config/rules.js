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

/** Groups buyer types into the channels shown in Demand Recovery. */
export function buyerChannel(buyerType) {
  if (buyerType === 'CONSUMER') return 'CONSUMER';
  if (buyerType === 'COMMUNITY') return 'COMMUNITY';
  return 'BUSINESS';
}
