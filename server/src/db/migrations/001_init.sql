-- Tyllage baseline schema
-- Multi-farm ready: every farm-owned record carries farm_id.

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(150) NOT NULL,
  role            VARCHAR(30)  NOT NULL
                  CHECK (role IN ('platform_admin', 'farm_admin', 'farm_staff', 'business_buyer', 'consumer')),
  phone           VARCHAR(40),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_unique ON users (LOWER(email));

CREATE TABLE farms (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(150) NOT NULL,
  slug                 VARCHAR(80)  NOT NULL UNIQUE,
  description          TEXT,
  region               VARCHAR(20)
                       CHECK (region IN ('CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST')),
  address              VARCHAR(255),
  contact_email        VARCHAR(255),
  contact_phone        VARCHAR(40),
  fulfilment_methods   TEXT[] NOT NULL DEFAULT ARRAY['FARM_PICKUP']::TEXT[],
  is_demo              BOOLEAN NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Links farm-side users (farm_admin / farm_staff) to the farms they may access.
CREATE TABLE farm_staff (
  id          SERIAL PRIMARY KEY,
  farm_id     INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_role  VARCHAR(20) NOT NULL CHECK (staff_role IN ('ADMIN', 'STAFF')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (farm_id, user_id)
);
CREATE INDEX farm_staff_user_idx ON farm_staff (user_id);

CREATE TABLE produce (
  id             SERIAL PRIMARY KEY,
  farm_id        INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name           VARCHAR(120) NOT NULL,
  category       VARCHAR(40)  NOT NULL,
  unit           VARCHAR(20)  NOT NULL DEFAULT 'kg',
  default_price  NUMERIC(10, 2) NOT NULL CHECK (default_price >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX produce_farm_name_unique ON produce (farm_id, LOWER(name));

CREATE TABLE harvest_batches (
  id                  SERIAL PRIMARY KEY,
  farm_id             INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  produce_id          INTEGER NOT NULL REFERENCES produce(id),
  expected_quantity   NUMERIC(10, 2) NOT NULL CHECK (expected_quantity > 0),
  actual_quantity     NUMERIC(10, 2) CHECK (actual_quantity IS NULL OR actual_quantity > 0),
  harvest_date        DATE NOT NULL,
  grade               VARCHAR(20) NOT NULL DEFAULT 'EVERYDAY'
                      CHECK (grade IN ('PREMIUM', 'EVERYDAY', 'RESCUE_ELIGIBLE')),
  preferred_price     NUMERIC(10, 2) NOT NULL CHECK (preferred_price > 0),
  min_price           NUMERIC(10, 2) NOT NULL CHECK (min_price > 0),
  notes               TEXT,
  status              VARCHAR(25) NOT NULL DEFAULT 'PLANNED'
                      CHECK (status IN ('PLANNED', 'AVAILABLE', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 'AT_RISK', 'CLOSED')),
  marked_available    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harvest_min_le_preferred CHECK (min_price <= preferred_price)
);
CREATE INDEX harvest_batches_farm_idx ON harvest_batches (farm_id, harvest_date);
CREATE INDEX harvest_batches_produce_idx ON harvest_batches (produce_id);

CREATE TABLE buyer_profiles (
  id                           SERIAL PRIMARY KEY,
  user_id                      INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  organisation_name            VARCHAR(150) NOT NULL,
  buyer_type                   VARCHAR(20) NOT NULL
                               CHECK (buyer_type IN ('CONSUMER', 'RESTAURANT', 'CAFE', 'HOTEL', 'CATERER', 'RETAILER', 'WHOLESALER', 'COMMUNITY')),
  contact_name                 VARCHAR(150),
  contact_email                VARCHAR(255),
  contact_phone                VARCHAR(40),
  whatsapp_opt_in              BOOLEAN NOT NULL DEFAULT FALSE,
  region                       VARCHAR(20)
                               CHECK (region IN ('CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST')),
  address                      VARCHAR(255),
  preferred_collection_method  VARCHAR(20) NOT NULL DEFAULT 'FARM_PICKUP'
                               CHECK (preferred_collection_method IN ('FARM_PICKUP', 'DELIVERY', 'COMMUNITY_DROP')),
  -- Buyers added manually by a farm (e.g. an existing WhatsApp customer without an account).
  managed_by_farm_id           INTEGER REFERENCES farms(id) ON DELETE SET NULL,
  is_active                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX buyer_profiles_type_idx ON buyer_profiles (buyer_type);

-- Demand can be directed to one farm (farm_id set) or open to any farm (farm_id NULL).
CREATE TABLE demand_requests (
  id                   SERIAL PRIMARY KEY,
  buyer_id             INTEGER NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
  farm_id              INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  produce_id           INTEGER REFERENCES produce(id) ON DELETE SET NULL,
  produce_name         VARCHAR(120) NOT NULL,
  category             VARCHAR(40),
  quantity             NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  fulfilled_quantity   NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  unit                 VARCHAR(20) NOT NULL DEFAULT 'kg',
  required_date        DATE NOT NULL,
  max_price            NUMERIC(10, 2) CHECK (max_price IS NULL OR max_price > 0),
  recurrence           VARCHAR(10) NOT NULL DEFAULT 'NONE'
                       CHECK (recurrence IN ('NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY')),
  notes                TEXT,
  status               VARCHAR(25) NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'EXPIRED')),
  created_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX demand_requests_status_idx ON demand_requests (status, required_date);
CREATE INDEX demand_requests_buyer_idx ON demand_requests (buyer_id);
CREATE INDEX demand_requests_farm_idx ON demand_requests (farm_id);

-- One row per HarvestMatch or Demand Recovery invocation.
CREATE TABLE match_runs (
  id                   SERIAL PRIMARY KEY,
  farm_id              INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  harvest_batch_id     INTEGER NOT NULL REFERENCES harvest_batches(id) ON DELETE CASCADE,
  run_type             VARCHAR(15) NOT NULL CHECK (run_type IN ('HARVESTMATCH', 'RECOVERY')),
  trigger_reason       VARCHAR(40),
  remaining_quantity   NUMERIC(10, 2) NOT NULL,
  candidates_count     INTEGER NOT NULL DEFAULT 0,
  excluded             JSONB NOT NULL DEFAULT '[]'::JSONB,
  summary              JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX match_runs_batch_idx ON match_runs (harvest_batch_id, created_at DESC);

CREATE TABLE orders (
  id                  SERIAL PRIMARY KEY,
  farm_id             INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  buyer_id            INTEGER NOT NULL REFERENCES buyer_profiles(id),
  status              VARCHAR(15) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'CONFIRMED', 'READY', 'COMPLETED', 'CANCELLED')),
  source              VARCHAR(15) NOT NULL
                      CHECK (source IN ('HARVESTMATCH', 'RECOVERY', 'RESCUE', 'DIRECT')),
  collection_method   VARCHAR(20) NOT NULL DEFAULT 'FARM_PICKUP'
                      CHECK (collection_method IN ('FARM_PICKUP', 'DELIVERY', 'COMMUNITY_DROP')),
  community_drop_id   INTEGER,
  scheduled_date      DATE,
  total_amount        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  notes               TEXT,
  cancelled_reason    TEXT,
  cancelled_by_party  VARCHAR(10) CHECK (cancelled_by_party IN ('BUYER', 'FARM')),
  cancelled_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX orders_farm_idx ON orders (farm_id, status);
CREATE INDEX orders_buyer_idx ON orders (buyer_id);

CREATE TABLE order_items (
  id                  SERIAL PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  produce_id          INTEGER NOT NULL REFERENCES produce(id),
  harvest_batch_id    INTEGER REFERENCES harvest_batches(id),
  demand_request_id   INTEGER REFERENCES demand_requests(id) ON DELETE SET NULL,
  quantity            NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  line_total          NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_batch_idx ON order_items (harvest_batch_id);

CREATE TABLE rescue_listings (
  id                    SERIAL PRIMARY KEY,
  farm_id               INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  harvest_batch_id      INTEGER NOT NULL REFERENCES harvest_batches(id) ON DELETE CASCADE,
  quantity              NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  original_price        NUMERIC(10, 2) NOT NULL CHECK (original_price > 0),
  rescue_price          NUMERIC(10, 2) NOT NULL CHECK (rescue_price > 0),
  reason                VARCHAR(30) NOT NULL
                        CHECK (reason IN ('COSMETIC_IMPERFECTION', 'SURPLUS', 'SHORT_DATED', 'IRREGULAR_SIZE', 'OTHER')),
  reason_details        TEXT,
  collection_deadline   TIMESTAMPTZ NOT NULL,
  suitability_confirmed_by INTEGER NOT NULL REFERENCES users(id),
  suitability_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                VARCHAR(15) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'SOLD_OUT', 'EXPIRED', 'CANCELLED')),
  created_by            INTEGER REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rescue_price_le_original CHECK (rescue_price <= original_price)
);
CREATE INDEX rescue_listings_farm_idx ON rescue_listings (farm_id, status);
CREATE INDEX rescue_listings_batch_idx ON rescue_listings (harvest_batch_id);

-- Stock reservations against a harvest batch. ACTIVE allocations reduce available stock;
-- RELEASED allocations (cancelled orders) restore it.
CREATE TABLE allocations (
  id                  SERIAL PRIMARY KEY,
  farm_id             INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  harvest_batch_id    INTEGER NOT NULL REFERENCES harvest_batches(id) ON DELETE CASCADE,
  order_item_id       INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  rescue_listing_id   INTEGER REFERENCES rescue_listings(id) ON DELETE SET NULL,
  quantity            NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  released_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX allocations_batch_idx ON allocations (harvest_batch_id, status);
CREATE INDEX allocations_rescue_idx ON allocations (rescue_listing_id);

CREATE TABLE harvest_matches (
  id                    SERIAL PRIMARY KEY,
  farm_id               INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  run_id                INTEGER REFERENCES match_runs(id) ON DELETE SET NULL,
  harvest_batch_id      INTEGER NOT NULL REFERENCES harvest_batches(id) ON DELETE CASCADE,
  demand_request_id     INTEGER NOT NULL REFERENCES demand_requests(id) ON DELETE CASCADE,
  buyer_id              INTEGER NOT NULL REFERENCES buyer_profiles(id),
  source                VARCHAR(15) NOT NULL DEFAULT 'HARVESTMATCH' CHECK (source IN ('HARVESTMATCH', 'RECOVERY')),
  match_score           INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  score_breakdown       JSONB NOT NULL DEFAULT '{}'::JSONB,
  reasons               JSONB NOT NULL DEFAULT '[]'::JSONB,
  warnings              JSONB NOT NULL DEFAULT '[]'::JSONB,
  recommended_quantity  NUMERIC(10, 2) NOT NULL CHECK (recommended_quantity >= 0),
  approved_quantity     NUMERIC(10, 2) CHECK (approved_quantity IS NULL OR approved_quantity > 0),
  unit_price            NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  expected_revenue      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status                VARCHAR(15) NOT NULL DEFAULT 'SUGGESTED'
                        CHECK (status IN ('SUGGESTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  order_id              INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  decision_note         TEXT,
  decided_by            INTEGER REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX harvest_matches_batch_idx ON harvest_matches (harvest_batch_id, status);
CREATE INDEX harvest_matches_demand_idx ON harvest_matches (demand_request_id);

CREATE TABLE community_drops (
  id                SERIAL PRIMARY KEY,
  farm_id           INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  community_name    VARCHAR(120) NOT NULL,
  collection_point  VARCHAR(200) NOT NULL,
  region            VARCHAR(20)
                    CHECK (region IN ('CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST')),
  drop_date         DATE NOT NULL,
  window_start      TIME NOT NULL,
  window_end        TIME NOT NULL,
  status            VARCHAR(15) NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
  notes             TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT drop_window_valid CHECK (window_end > window_start)
);
CREATE INDEX community_drops_farm_idx ON community_drops (farm_id, drop_date);

ALTER TABLE orders
  ADD CONSTRAINT orders_community_drop_fk
  FOREIGN KEY (community_drop_id) REFERENCES community_drops(id) ON DELETE SET NULL;

CREATE TABLE campaigns (
  id                  SERIAL PRIMARY KEY,
  farm_id             INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  campaign_type       VARCHAR(30) NOT NULL
                      CHECK (campaign_type IN ('HARVEST_ANNOUNCEMENT', 'RESCUE_ALERT', 'B2B_AVAILABILITY', 'COMMUNITY_DROP', 'DEMAND_RECOVERY', 'CUSTOMER_RECOMMENDATION')),
  audience            VARCHAR(20) NOT NULL
                      CHECK (audience IN ('ALL_BUYERS', 'BUSINESS_BUYERS', 'CONSUMERS', 'COMMUNITY')),
  title               VARCHAR(200) NOT NULL,
  context             JSONB NOT NULL DEFAULT '{}'::JSONB,
  generated_content   TEXT NOT NULL,
  final_content       TEXT NOT NULL,
  generation_mode     VARCHAR(10) NOT NULL CHECK (generation_mode IN ('OPENAI', 'MOCK')),
  status              VARCHAR(15) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'APPROVED', 'SENT', 'CANCELLED')),
  harvest_batch_id    INTEGER REFERENCES harvest_batches(id) ON DELETE SET NULL,
  rescue_listing_id   INTEGER REFERENCES rescue_listings(id) ON DELETE SET NULL,
  community_drop_id   INTEGER REFERENCES community_drops(id) ON DELETE SET NULL,
  recipients_count    INTEGER NOT NULL DEFAULT 0,
  created_by          INTEGER REFERENCES users(id),
  approved_by         INTEGER REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX campaigns_farm_idx ON campaigns (farm_id, status);

CREATE TABLE notifications (
  id                    SERIAL PRIMARY KEY,
  farm_id               INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  user_id               INTEGER REFERENCES users(id) ON DELETE CASCADE,
  buyer_id              INTEGER REFERENCES buyer_profiles(id) ON DELETE CASCADE,
  campaign_id           INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  channel               VARCHAR(10) NOT NULL CHECK (channel IN ('IN_APP', 'WHATSAPP')),
  notification_type     VARCHAR(30) NOT NULL,
  title                 VARCHAR(200) NOT NULL,
  body                  TEXT NOT NULL,
  status                VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SENT', 'MOCK_SENT', 'FAILED', 'READ')),
  provider_message_id   VARCHAR(120),
  error                 TEXT,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, status);
CREATE INDEX notifications_farm_idx ON notifications (farm_id, created_at DESC);

CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  farm_id       INTEGER REFERENCES farms(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action        VARCHAR(40) NOT NULL,
  entity_type   VARCHAR(40) NOT NULL,
  entity_id     INTEGER,
  details       JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address    VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_farm_idx ON audit_logs (farm_id, created_at DESC);

-- Single source of truth for batch stock. Derived from allocations and rescue listings,
-- never stored as a counter, so it cannot drift.
--   harvest_quantity   = actual quantity once recorded, otherwise expected quantity
--   allocated_quantity = ACTIVE allocations from normal orders (confirmed demand)
--   rescue_quantity    = quantity committed to Rescue (a cancelled listing keeps only what it sold)
--   remaining_quantity = what is still unallocated
CREATE VIEW batch_stock AS
SELECT hb.id AS harvest_batch_id,
       COALESCE(hb.actual_quantity, hb.expected_quantity) AS harvest_quantity,
       COALESCE(alloc.qty, 0) AS allocated_quantity,
       COALESCE(resc.qty, 0) AS rescue_quantity,
       COALESCE(resc.sold, 0) AS rescue_sold_quantity,
       COALESCE(hb.actual_quantity, hb.expected_quantity) - COALESCE(alloc.qty, 0) - COALESCE(resc.qty, 0)
         AS remaining_quantity
  FROM harvest_batches hb
  LEFT JOIN LATERAL (
    SELECT SUM(a.quantity) AS qty
      FROM allocations a
     WHERE a.harvest_batch_id = hb.id AND a.status = 'ACTIVE' AND a.rescue_listing_id IS NULL
  ) alloc ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN rl.status = 'CANCELLED' THEN COALESCE(s.sold, 0) ELSE rl.quantity END) AS qty,
           SUM(COALESCE(s.sold, 0)) AS sold
      FROM rescue_listings rl
      LEFT JOIN LATERAL (
        SELECT SUM(a.quantity) AS sold
          FROM allocations a
         WHERE a.rescue_listing_id = rl.id AND a.status = 'ACTIVE'
      ) s ON TRUE
     WHERE rl.harvest_batch_id = hb.id
  ) resc ON TRUE;

CREATE VIEW rescue_stock AS
SELECT rl.id AS rescue_listing_id,
       COALESCE(s.sold, 0) AS sold_quantity,
       rl.quantity - COALESCE(s.sold, 0) AS available_quantity
  FROM rescue_listings rl
  LEFT JOIN LATERAL (
    SELECT SUM(a.quantity) AS sold
      FROM allocations a
     WHERE a.rescue_listing_id = rl.id AND a.status = 'ACTIVE'
  ) s ON TRUE;
