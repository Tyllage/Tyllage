-- Features from the Tyllage proposal documents:
-- Chef Pack grade, Margin Guard, minimum order quantities, Dynamic Routing (shelf life + dispositions),
-- FarmPool, DemandPool, disputes, platform policies, pilot baselines and direct ordering.

-- Grade segments: Premium / Everyday / Rescue / Chef Pack.
ALTER TABLE harvest_batches DROP CONSTRAINT harvest_batches_grade_check;
ALTER TABLE harvest_batches ADD CONSTRAINT harvest_batches_grade_check
  CHECK (grade IN ('PREMIUM', 'EVERYDAY', 'RESCUE_ELIGIBLE', 'CHEF_PACK'));

-- Margin Guard: farm-private production cost per unit (never exposed to buyers).
ALTER TABLE harvest_batches ADD COLUMN production_cost NUMERIC(10, 2)
  CHECK (production_cost IS NULL OR production_cost >= 0);
ALTER TABLE farms ADD COLUMN min_margin_pct NUMERIC(5, 2) NOT NULL DEFAULT 15
  CHECK (min_margin_pct >= 0 AND min_margin_pct < 100);

-- Farm minimum order quantity and shelf life (Dynamic Routing windows) per produce.
ALTER TABLE produce ADD COLUMN min_order_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (min_order_quantity >= 0);
ALTER TABLE produce ADD COLUMN shelf_life_days INTEGER CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 1 AND 60);

-- Buyer minimum acceptable delivery, and FarmPool opt-in (several farms may fulfil one request).
ALTER TABLE demand_requests ADD COLUMN min_quantity NUMERIC(10, 2) CHECK (min_quantity IS NULL OR min_quantity > 0);
ALTER TABLE demand_requests ADD COLUMN allow_pooling BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE orders DROP CONSTRAINT orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check
  CHECK (source IN ('HARVESTMATCH', 'RECOVERY', 'RESCUE', 'DIRECT', 'FARMPOOL', 'DEMANDPOOL'));

-- Final routing stage: donation or alternative use (and honest recording of waste).
CREATE TABLE batch_dispositions (
  id                 SERIAL PRIMARY KEY,
  farm_id            INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  harvest_batch_id   INTEGER NOT NULL REFERENCES harvest_batches(id) ON DELETE CASCADE,
  disposition_type   VARCHAR(20) NOT NULL CHECK (disposition_type IN ('DONATION', 'ALTERNATIVE_USE', 'WASTE')),
  quantity           NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  recipient          VARCHAR(150),
  notes              TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX batch_dispositions_batch_idx ON batch_dispositions (harvest_batch_id);

-- Stock view now also subtracts dispositions (new column appended, as CREATE OR REPLACE VIEW requires).
CREATE OR REPLACE VIEW batch_stock AS
SELECT hb.id AS harvest_batch_id,
       COALESCE(hb.actual_quantity, hb.expected_quantity) AS harvest_quantity,
       COALESCE(alloc.qty, 0) AS allocated_quantity,
       COALESCE(resc.qty, 0) AS rescue_quantity,
       COALESCE(resc.sold, 0) AS rescue_sold_quantity,
       COALESCE(hb.actual_quantity, hb.expected_quantity) - COALESCE(alloc.qty, 0) - COALESCE(resc.qty, 0) - COALESCE(disp.qty, 0)
         AS remaining_quantity,
       COALESCE(disp.qty, 0) AS disposed_quantity
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
  ) resc ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(d.quantity) AS qty FROM batch_dispositions d WHERE d.harvest_batch_id = hb.id
  ) disp ON TRUE;

-- DemandPool: several small buyer requests served together as one viable farm order.
CREATE TABLE demand_pools (
  id                 SERIAL PRIMARY KEY,
  farm_id            INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  harvest_batch_id   INTEGER NOT NULL REFERENCES harvest_batches(id) ON DELETE CASCADE,
  community_drop_id  INTEGER REFERENCES community_drops(id) ON DELETE SET NULL,
  total_quantity     NUMERIC(10, 2) NOT NULL CHECK (total_quantity > 0),
  status             VARCHAR(12) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  created_by         INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE demand_pool_members (
  pool_id            INTEGER NOT NULL REFERENCES demand_pools(id) ON DELETE CASCADE,
  demand_request_id  INTEGER NOT NULL REFERENCES demand_requests(id) ON DELETE CASCADE,
  order_id           INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  quantity           NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (pool_id, demand_request_id)
);

-- Order disputes, resolved by a platform admin.
CREATE TABLE order_disputes (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  farm_id           INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  raised_by         INTEGER REFERENCES users(id),
  raised_by_party   VARCHAR(10) NOT NULL CHECK (raised_by_party IN ('BUYER', 'FARM')),
  reason            VARCHAR(20) NOT NULL CHECK (reason IN ('QUALITY', 'QUANTITY', 'LATE', 'NO_SHOW', 'PRICING', 'OTHER')),
  description       TEXT NOT NULL,
  status            VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'REJECTED')),
  resolution        TEXT,
  resolved_by       INTEGER REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX order_disputes_status_idx ON order_disputes (status, created_at DESC);

-- Platform policies (business rules editable by a platform admin; code defaults apply when absent).
CREATE TABLE platform_policies (
  key          VARCHAR(60) PRIMARY KEY,
  value        JSONB NOT NULL,
  updated_by   INTEGER REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pilot success framework: baseline figures recorded before the pilot, compared with live results.
CREATE TABLE pilot_baselines (
  id               SERIAL PRIMARY KEY,
  farm_id          INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  metric_key       VARCHAR(40) NOT NULL,
  baseline_value   NUMERIC(12, 2),
  period_label     VARCHAR(80),
  notes            TEXT,
  recorded_by      INTEGER REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (farm_id, metric_key)
);
