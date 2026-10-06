-- Proposal v3: MarketRoute (commercial route comparison), fulfilment terms and cost per route/order,
-- route-scoped HarvestMatch, and the Primary → Alternative → Rescue → Final disposition recovery ladder.

-- Retail route covers retailers and wet markets.
ALTER TABLE buyer_profiles DROP CONSTRAINT buyer_profiles_buyer_type_check;
ALTER TABLE buyer_profiles ADD CONSTRAINT buyer_profiles_buyer_type_check
  CHECK (buyer_type IN ('CONSUMER', 'RESTAURANT', 'CAFE', 'HOTEL', 'CATERER', 'RETAILER', 'WET_MARKET', 'WHOLESALER', 'COMMUNITY'));

-- Fulfilment terms: buyer pickup, central drop (hub / wholesale market), collection point, farm delivery.
ALTER TABLE buyer_profiles DROP CONSTRAINT buyer_profiles_preferred_collection_method_check;
ALTER TABLE buyer_profiles ADD CONSTRAINT buyer_profiles_preferred_collection_method_check
  CHECK (preferred_collection_method IN ('FARM_PICKUP', 'CENTRAL_DROP', 'COMMUNITY_DROP', 'DELIVERY'));
ALTER TABLE orders DROP CONSTRAINT orders_collection_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_collection_method_check
  CHECK (collection_method IN ('FARM_PICKUP', 'CENTRAL_DROP', 'COMMUNITY_DROP', 'DELIVERY'));

-- Farm-private fulfilment cost estimates per method: { "DELIVERY": { "perOrder": 15, "perKg": 0.2 }, ... }.
-- Empty = platform defaults apply.
ALTER TABLE farms ADD COLUMN fulfilment_costs JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Estimated fulfilment cost recorded on each order when it is created (farm-private; never shown to buyers).
ALTER TABLE orders ADD COLUMN fulfilment_cost NUMERIC(10, 2) CHECK (fulfilment_cost IS NULL OR fulfilment_cost >= 0);

-- Commercial constraints per batch: routes the farm is willing to use (NULL = any route),
-- and the primary route the farm selected after comparing routes.
ALTER TABLE harvest_batches ADD COLUMN allowed_routes TEXT[];
ALTER TABLE harvest_batches ADD COLUMN primary_route VARCHAR(20);

-- HarvestMatch can run within one route; record which.
ALTER TABLE match_runs ADD COLUMN market_route VARCHAR(20);
ALTER TABLE harvest_matches ADD COLUMN market_route VARCHAR(20);

-- Every route decision, with the comparison the farm saw when making it (for audit and Insights).
CREATE TABLE route_selections (
  id                  SERIAL PRIMARY KEY,
  farm_id             INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  harvest_batch_id    INTEGER NOT NULL REFERENCES harvest_batches(id) ON DELETE CASCADE,
  route               VARCHAR(20) NOT NULL,
  recommended_route   VARCHAR(20),
  route_score         INTEGER,
  stage               VARCHAR(20) NOT NULL DEFAULT 'PRIMARY'
                      CHECK (stage IN ('PRIMARY', 'ALTERNATIVE', 'RESCUE')),
  remaining_quantity  NUMERIC(10, 2) NOT NULL,
  assessment          JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX route_selections_batch_idx ON route_selections (harvest_batch_id, created_at DESC);
