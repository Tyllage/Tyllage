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

export const BUSINESS_BUYER_TYPES = ['RESTAURANT', 'CAFE', 'HOTEL', 'CATERER', 'RETAILER', 'WET_MARKET', 'WHOLESALER'];
export const BUYER_TYPES = [...BUSINESS_BUYER_TYPES, 'CONSUMER', 'COMMUNITY'];

export const REGIONS = ['CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST'];
// Fulfilment terms (proposal §8.2): who moves the produce, and therefore who carries the logistics cost.
//   FARM_PICKUP    — buyer collects at the farm (buyer's logistics)
//   CENTRAL_DROP   — farm drops at a central hub / wholesale market; the partner distributes onward
//   COMMUNITY_DROP — farm brings many small orders to one collection point
//   DELIVERY       — farm delivers to the buyer's door
export const COLLECTION_METHODS = ['FARM_PICKUP', 'CENTRAL_DROP', 'COMMUNITY_DROP', 'DELIVERY'];
export const LOGISTICS_RESPONSIBILITY = {
  FARM_PICKUP: 'BUYER',
  CENTRAL_DROP: 'SHARED',
  COMMUNITY_DROP: 'FARM',
  DELIVERY: 'FARM',
};

// Default fulfilment cost estimates (S$) per method, used until a farm records its own in Settings.
// DEMO ASSUMPTIONS — not ComCrop figures. perOrder = cost of one run/handover; perKg = handling and packaging.
export const DEFAULT_FULFILMENT_COSTS = {
  FARM_PICKUP: { perOrder: 0, perKg: 0 },
  CENTRAL_DROP: { perOrder: 8, perKg: 0.3 },
  COMMUNITY_DROP: { perOrder: 3, perKg: 0.2 },
  DELIVERY: { perOrder: 15, perKg: 0.2 },
};

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

// ---------------------------------------------------------------- MarketRoute

/**
 * Commercial routes compared by MarketRoute (proposal §8.2). Each route groups buyer types and carries
 * a transparent profile used only when the route has no live demand to read from:
 *   priceIndex   — typical price as a share of the farm's preferred price
 *   typicalKg    — typical order size (drives the number of fulfilment runs)
 *   leadDays     — typical days from offer to sale
 *   method       — default fulfilment terms for the route
 * Rescue is the farm-approved alternative route for surplus / imperfect / short-dated produce.
 */
export const MARKET_ROUTES = {
  RESTAURANT: { label: 'Restaurants & cafés', buyerTypes: ['RESTAURANT', 'CAFE'], priceIndex: 1, typicalKg: 8, leadDays: 2, method: 'FARM_PICKUP' },
  INSTITUTIONAL: { label: 'Hotels & caterers', buyerTypes: ['HOTEL', 'CATERER'], priceIndex: 0.95, typicalKg: 20, leadDays: 3, method: 'DELIVERY' },
  WHOLESALE: { label: 'Wholesale', buyerTypes: ['WHOLESALER'], priceIndex: 0.75, typicalKg: 40, leadDays: 1, method: 'CENTRAL_DROP' },
  RETAIL: { label: 'Retail & wet markets', buyerTypes: ['RETAILER', 'WET_MARKET'], priceIndex: 0.85, typicalKg: 15, leadDays: 2, method: 'DELIVERY' },
  COMMUNITY_D2C: { label: 'Community & D2C', buyerTypes: ['COMMUNITY', 'CONSUMER'], priceIndex: 1, typicalKg: 1.5, leadDays: 3, method: 'COMMUNITY_DROP' },
  RESCUE: { label: 'Tyllage Rescue', buyerTypes: [], priceIndex: 0.6, typicalKg: 2, leadDays: 1, method: 'FARM_PICKUP' },
};
export const ROUTE_KEYS = Object.keys(MARKET_ROUTES);
export const DEMAND_ROUTE_KEYS = ROUTE_KEYS.filter((k) => k !== 'RESCUE');

// Commercial Route Score factor weights (sum = 100).
export const ROUTE_WEIGHTS = {
  demandFit: 25,
  price: 15,
  margin: 20,
  volume: 10,
  fulfilment: 10,
  reliability: 10,
  urgency: 10,
};

// Logistics score by fulfilment terms: the less the farm has to move, the better.
export const LOGISTICS_SCORE = { FARM_PICKUP: 100, CENTRAL_DROP: 75, COMMUNITY_DROP: 65, DELIVERY: 50 };

// Average order size that earns a full volume score (fewer, larger orders = fewer fulfilment runs).
export const ROUTE_VOLUME_REFERENCE_KG = 20;

// Rescue has no buyer requests to read; its demand fit is this fixed, conservative score, so a fallback
// with uncertain sell-through does not outrank routes with real demand while produce is fresh.
export const RESCUE_DEMAND_FIT = 20;

/** Route for a buyer type. Rescue sales are identified by order source, not buyer type. */
export function buyerRoute(buyerType) {
  for (const [key, r] of Object.entries(MARKET_ROUTES)) if (r.buyerTypes.includes(buyerType)) return key;
  return 'COMMUNITY_D2C';
}

/** Route of a sale: Rescue reservations count as the Rescue route whoever bought them. */
export const orderRoute = (source, buyerType) => (source === 'RESCUE' ? 'RESCUE' : buyerRoute(buyerType));

export const emptyRouteTotals = () => Object.fromEntries(ROUTE_KEYS.map((k) => [k, 0]));
export const ROUTE_LABELS = Object.fromEntries(Object.entries(MARKET_ROUTES).map(([k, r]) => [k, r.label]));

// Recovery stages (proposal §8.5): primary route → alternative route → Rescue → final disposition record.
export const RECOVERY_STAGES = ['PRIMARY', 'ALTERNATIVE', 'RESCUE', 'FINAL_DISPOSITION'];
