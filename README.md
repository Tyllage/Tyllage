# Tyllage

**From Harvest to Demand.**

## Overview

Tyllage is a local-farm demand and market-access platform. It is currently being developed as a **ComCrop-focused pilot**, while remaining architected for future **multi-farm expansion**.

> **Industry-wide opportunity, ComCrop-first validation.**
> All ComCrop data in this repository is **fictional DEMO / PILOT DATA**. It does not represent ComCrop's actual production, customers, prices, revenue, costs or commercial agreements.

### Problem

Singapore's local farms can grow quality produce yet still struggle commercially: demand is fragmented, upcoming demand is hard to see, produce has a short shelf life, buyers cancel at short notice, sales rely on a few channels, and B2B buyers are hard to reach. Produce ends up unsold, heavily discounted or wasted.

The question Tyllage addresses is **not** "how can farms grow more?" It is:

> How can farms better connect what they expect to harvest with suitable demand, before produce becomes unsold, heavily discounted or wasted?

### Solution: the MVP loop

```
Expected Harvest → Existing Demand → Demand Coverage → HarvestMatch → Farmer Approval
→ Allocation / Order → Remaining Produce → Demand Recovery → Rescue / Alternative Channel → Analytics
```

| Module | What it does |
|---|---|
| **Farm Dashboard** | Answers four questions: what are we harvesting, how much has demand, what may remain unsold, and what needs action. |
| **Demand Coverage** | `Confirmed Demand ÷ Expected Harvest × 100`, calculated live from real allocations. Rule-based risk: ≥80% LOW · 50–79% MEDIUM · <50% HIGH. |
| **HarvestMatch** | Transparent weighted scoring that ranks existing buyer demand against a batch, with reasons for every recommendation. Not machine learning. |
| **Allocations / Orders** | Approving a match creates order + order item + allocation in one transaction. Over-allocation is impossible. |
| **Demand Recovery** | Re-matches leftover produce after cancellations or surplus, excluding invalid demand, and suggests next steps for the farmer to approve. |
| **Tyllage Rescue** | An alternative channel for produce the farm has itself judged suitable for sale. |
| **Tyllage Connect** | OpenAI-assisted outreach copy, built only from backend-approved facts. The farm reviews, edits and approves it. |
| **WhatsApp** | Cloud API integration with a full mock mode. |
| **Analytics** | Every metric is derived from database records. Where data is thin, the UI says "Not enough data yet". |

### ComCrop-first validation strategy

The MVP validates one question: *can Tyllage help ComCrop gain better visibility of demand and match expected harvest with suitable buyers before produce becomes commercially at risk?*

- The UX is optimised for a ComCrop-style urban vegetable farm, using pilot demo data.
- The backend is multi-farm from day one. Every farm-owned record carries `farm_id`, every farm-sensitive route checks access server-side, and a second demo farm ("Farm B") is seeded to prove isolation.
- Nothing is hard-coded to ComCrop. A platform admin can onboard Farm B, Farm C, and so on from **Platform → Farms**.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, JavaScript, React Router 7, native Fetch |
| Backend | Node.js (≥ 22.9), Express 5, REST |
| Database | PostgreSQL (raw parameterised SQL via `pg`, plain SQL migrations) |
| Auth | JWT, bcrypt (`bcryptjs`, 12 rounds), role-based access control |
| Validation | zod (server-side) |
| Security | helmet, CORS allow-list, express-rate-limit, centralised error handling, audit log |
| Integrations | OpenAI Chat Completions API (optional), WhatsApp Cloud API (optional) |
| Tests | `node:test` + supertest against a real PostgreSQL test database |
| Deployment | Railway (single service: Express serves the API and the built client) |

No Python in the MVP. A Python AI/ML microservice is planned for later phases (see roadmap).

## Architecture

```
 Browser (React SPA)
   │  fetch /api/*  (JWT bearer)
   ▼
 Express app ── helmet · CORS · rate-limit · JSON 100kb
   ├─ routes/        URL → middleware (verifyToken, requireRole, requireFarmAccess) → controller
   ├─ controllers/   thin: parse params, call a service, shape { success, data }
   ├─ services/      business logic and authorisation on loaded records
   │    harvestMatchService (pure scoring + persistence) · allocationService (locked transactions)
   │    recoveryService · rescueService · analyticsService · riskService · campaignService
   │    openaiService (copy only) · whatsappService (mock/live) · auditService · notificationService
   ├─ models/        shared batch queries + DTOs (public DTO hides minimum price)
   └─ config/        env, pg pool, transparent business rules (rules.js)
   ▼
 PostgreSQL ── tables + views: batch_stock (single source of truth for stock), rescue_stock
```

**Stock integrity.** Remaining stock is never stored as a counter. It is derived by the `batch_stock` view from ACTIVE allocations and Rescue listings. Every allocation runs inside a transaction that first locks the batch row (`SELECT … FOR UPDATE`) and then re-reads stock, so concurrent approvals cannot over-allocate. A test proves this. Cancelling an order releases its allocations and restores availability and demand fulfilment.

## Project structure

```
tyllage/
├── client/                     React + Vite SPA
│   └── src/
│       ├── components/         ui.jsx, domain.jsx (risk/coverage/score), Icons.jsx, farm/ (HarvestMatch, Recovery, Rescue forms)
│       ├── context/            Auth, active Farm, Toast
│       ├── hooks/              useApi
│       ├── layouts/            AppShell (role-based navigation), AuthLayout
│       ├── pages/              auth/, farm/, buyer/, consumer/, admin/
│       ├── services/api.js     fetch wrapper (VITE_API_URL aware)
│       ├── styles/global.css   design tokens and components
│       └── utils/format.js
├── server/
│   ├── src/
│   │   ├── config/             env.js, db.js, rules.js
│   │   ├── controllers/        index.js
│   │   ├── db/                 migrate.js, migrations/001_init.sql
│   │   ├── middleware/         auth.js (verifyToken, requireRole, requireFarmAccess), errorHandler.js
│   │   ├── models/             harvestModel.js
│   │   ├── routes/             one router per API group
│   │   ├── seed/seed.js        ComCrop pilot DEMO data
│   │   ├── services/           business logic (see above)
│   │   ├── utils/
│   │   ├── app.js              Express app factory
│   │   └── server.js           boot: migrations, then listen on PORT
│   └── tests/                  node:test suites
├── .env.example
├── docker-compose.yml          optional local Postgres
├── railway.json
└── package.json                root scripts for Railway / convenience
```

---

## Local setup

### Prerequisites

- Node.js **22.9+** (`.nvmrc` provided)
- PostgreSQL 14+ (local install, or `docker compose up -d`)

### 1. Install

```bash
npm run install:all
```

### 2. Database

Create two databases: one for the app and one disposable database for tests.

```bash
createdb tyllage
```

```bash
createdb tyllage_test
```

With Docker instead: `docker compose up -d` starts Postgres on port 5432 with user/password `tyllage` and creates both databases.

### 3. Environment variables

```bash
cp .env.example server/.env
```

Then edit `server/.env`:

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | – | `development` / `production` / `test` |
| `PORT` | – | Default 4000; Railway injects it |
| `DATABASE_URL` | **yes (prod)** | Postgres connection string |
| `DATABASE_SSL` | – | `true` if your Postgres requires SSL |
| `TEST_DATABASE_URL` | for tests | **Wiped on every test run** |
| `JWT_SECRET` | **yes (prod)** | ≥ 32 random chars in production (the server refuses to start otherwise) |
| `JWT_EXPIRES_IN` | – | Default `8h` |
| `OPENAI_API_KEY` | – | Absent: deterministic template copy (mock mode) |
| `OPENAI_MODEL` | – | Default `gpt-4.1-mini` |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | – | Absent: mock mode (payloads logged with masked numbers, never sent) |
| `WHATSAPP_VERIFY_TOKEN` | – | For the Meta webhook verification handshake |
| `CLIENT_URL` | – | CORS allow-list (comma-separated). Not needed when Express serves the client |
| `APP_TIMEZONE` | – | Default `Asia/Singapore`; business dates are Singapore calendar days |

Never commit `.env` files. They are git-ignored.

### 4. Migrate and seed the pilot demo

```bash
npm run migrate
```

```bash
npm run seed
```

`npm run seed` only seeds an empty database. To wipe and reseed, run `npm run seed --prefix server -- --force`, or reset everything with `npm run db:reset --prefix server`. Seeding refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.

Seed dates are **relative to today**, so the demo always shows an at-risk Kale batch being harvested today.

### 5. Run

Backend (http://localhost:4000, auto-reload):

```bash
npm run dev:server
```

Frontend (http://localhost:5173, proxies `/api` to :4000):

```bash
npm run dev:client
```

Production-style single process (build the client, then let Express serve it on :4000):

```bash
npm run build && npm start
```

### Demo accounts

All demo accounts share the password **`TyllageDemo2026!`** (defined in `server/src/seed/seed.js`). This is demo-only. Never reuse it.

| Role | Email | Use it to… |
|---|---|---|
| farm_admin | `farmadmin@comcrop.demo` | Run the full demo story |
| farm_staff | `staff@comcrop.demo` | Update harvests and fulfilment (no approvals or pricing) |
| platform_admin | `admin@tyllage.demo` | Manage farms and users, switch between farms |
| farm_admin (Farm B) | `farmb@tyllage.demo` | Verify multi-farm isolation |
| business_buyer | `restaurant@tyllage.demo`, `hotel@tyllage.demo` | Register demand, see matches and orders |
| consumer | `consumer@tyllage.demo` | Browse and reserve Rescue produce, join Community Drops |

In development builds the login page also shows a one-click demo-account picker.

---

## The MVP demo story

1. Sign in as **farmadmin@comcrop.demo**. The dashboard shows **Kale: 70kg expected, 24kg confirmed, 34.3% coverage, HIGH risk, 46kg unallocated**.
2. Click **Run HarvestMatch**. Tyllage ranks Restaurant A (95%), Hotel B (82%) and Community Buyer C (77%), plus a weak Consumer G match (63%). Each comes with reasons and a factor breakdown. **Not recommended** explains the exclusions: Caterer E's price is below the farm minimum, and Wholesaler H cancelled an order on this batch.
3. Select the top three and click **Approve selected**. Orders are created and Kale becomes **70 expected / 65 allocated / 5 remaining** (92.9% coverage, LOW).
4. Click **Recover demand**. No strong normal-market demand remains, so Tyllage suggests **Move 5kg to Rescue**.
5. Create the Rescue listing. The farm must tick the suitability-for-sale confirmation.
6. Click **Generate Rescue campaign**. Tyllage Connect drafts the message. Review or edit it, then **Approve**. Sending is a separate, explicit step; in mock mode messages appear in **Campaigns → WhatsApp message log**.
7. Back on the dashboard, Demand Coverage, Rescue Quantity and remaining risk have updated. **Analytics** shows sell-through, conversion and the other metrics.

## Business rules (transparent, configurable in `server/src/config/rules.js`)

**HarvestMatch weights** (sum 100):

| Factor | Weight | Rule |
|---|---|---|
| Produce match | 30 | Exact = 100; close name (e.g. "Baby Kale" vs "Kale") = 75; otherwise excluded |
| Date | 20 | 0–2 days after harvest = 100; 3–4 = 75; 5–7 = 45 (with a warning); before harvest or beyond the 7-day freshness window = excluded. Recurring demand rolls forward to its next occurrence |
| Price | 20 | Buyer max ≥ preferred = 100; between min and preferred scales 50–100; no price = 70 with a warning; below the farm minimum = **excluded** |
| Quantity | 10 | Fits remaining supply = 100; partial supply scales down |
| Reliability | 10 | Completed ÷ (completed + buyer cancellations). **Neutral 60** with fewer than 2 past orders. No invented history |
| Location | 10 | Same region 100, neighbouring 75, distant 50, unknown 60; ×0.4 if the farm doesn't offer the buyer's collection method |

Recommended quantities are assigned greedily in score order, so their total never exceeds unallocated stock. Re-running supersedes unactioned suggestions.

**Exclusions** (HarvestMatch and Recovery): cancelled, fulfilled and expired demand; demand the farm already rejected for this batch; buyers who cancelled an order on this batch; incompatible price, date or produce. Recovery treats matches scoring ≥ 70 as "strong" demand.

**Analytics formulas** (`server/src/services/analyticsService.js`):

| Metric | Formula |
|---|---|
| Sell-through | Sold quantity (confirmed/ready/completed) ÷ actual harvest (batches harvested to date) × 100 |
| Demand coverage | Confirmed demand ÷ expected harvest (actual once recorded) × 100 |
| Rescue rate | Recovered at-risk produce ÷ total at-risk produce × 100. At-risk = unallocated quantity when Demand Recovery first ran on a batch; recovered = quantity allocated or reserved after that point |
| Channel concentration | Revenue from largest buyer ÷ total revenue × 100 |
| Repeat buyer rate | Buyers with 2+ non-cancelled orders ÷ buyers with 1+ × 100 |
| Match conversion | Approved matches ÷ generated matches (excluding superseded re-runs) × 100 |

## API summary

All responses use `{ "success": true, "data": … }` or `{ "success": false, "message": "…", "code": "ERROR_CODE" }`.

| Group | Endpoints |
|---|---|
| `/api/auth` | `POST /register` (buyer roles only) · `POST /login` · `GET /me` |
| `/api/farms` | `GET /` · `POST /` (platform admin) · `GET/PATCH /:farmId` · `GET /:farmId/dashboard` · `GET /:farmId/team` · `POST /:farmId/users` (platform admin) · `GET/POST /:farmId/buyers` · `GET /:farmId/audit-logs` · `GET /:farmId/whatsapp-log` |
| `/api/produce` | `GET ?farmId` · `POST` · `GET/PATCH /:id` |
| `/api/harvests` | `GET ?farmId` · `POST` · `GET/PATCH /:id` · `POST /:id/mark-available` · `POST /:id/close` · **`POST /:id/run-matching`** · **`GET /:id/matches`** |
| `/api/demand` | `GET` (farm: `?farmId`; buyer: own) · `POST` · `GET/PATCH /:id` · `POST /:id/cancel` |
| `/api/matches` | `GET` · `POST /:id/approve` `{ quantity? }` · `POST /:id/reject` `{ reason? }` |
| `/api/orders` | `GET` · `GET /:id` · `PATCH /:id/status` `{ status, reason? }` |
| `/api/recovery` | `GET ?farmId` (candidates and triggers) · `POST /harvests/:id/start` · `GET /harvests/:id` |
| `/api/rescue` | `GET /public` · `GET ?farmId` · `POST` · `PATCH /:id` · `POST /:id/cancel` · `POST /:id/reserve` |
| `/api/campaigns` | `GET ?farmId` · `POST /generate` · `GET/PATCH /:id` · `POST /:id/approve` · `POST /:id/send` · `POST /:id/cancel` |
| `/api/analytics` | `GET ?farmId` |
| `/api/community-drops` | `GET /upcoming` · `GET ?farmId` · `POST` · `PATCH /:id/status` · `POST /:id/join` |
| `/api/marketplace` | `GET /supply` · `GET /farms` (public; never exposes minimum prices) |
| `/api/users` | `GET` · `PATCH /:id/active` (platform admin) |
| `/api/farmpool` | `GET ?farmId` · `POST /:demandId/contribute` |
| `/api/demandpool` | `GET ?farmId` · `GET /suggestions?farmId` · `POST` |
| `/api/orders` (new) | `POST` direct/bulk order (buyers) · `POST /:id/disputes` |
| `/api/disputes` | `GET` (own/farm/all) · `PATCH /:id` (platform admin resolves) |
| `/api/harvests/:id/dispositions` | `GET` · `POST` (donation / alternative use / waste) |
| `/api/analytics` (new) | `GET /comparison?farmId` · `PUT /baselines` |
| `/api/ai` | `GET /status` · `POST /matches/:id/explain` · `POST /insights` · plus `POST /api/campaigns/:id/variations`, `GET /api/rescue/price-suggestion` |
| `/api/admin` | `GET/PATCH /policies` · `GET /audit-logs` (platform admin) |
| `/api/marketplace/farms/:id` | Public farm profile |
| misc | `GET /api/health` · `GET/PATCH /api/buyers/me` · `GET /api/notifications` · `POST /api/notifications/:id/read` · `GET/POST /api/whatsapp/webhook` |

### Roles

| Role | Can |
|---|---|
| `platform_admin` | Everything, on every farm; manage farms and users |
| `farm_admin` | Manage farm and produce, harvests, demand, run HarvestMatch, approve/reject, cancel orders, recovery, Rescue, campaigns, analytics |
| `farm_staff` | Create and update harvests (not prices), fulfil orders (confirm, ready, complete), view farm data. No approvals, cancellations, pricing or campaigns |
| `business_buyer` | Register demand, view supply, matches and own orders, cancel own pending/confirmed orders |
| `consumer` | Browse supply and Rescue, register interests, reserve Rescue, join Community Drops, own orders |

## Proposal feature coverage

Everything described in both proposal documents (`Tyllage_Final`, `Tyllage_Proposal`) is in the prototype, except the business model and the Phase 2–4 roadmap:

| Proposal item | Where in the prototype |
|---|---|
| Demand Radar (expected / confirmed / **potential** demand / risk) | Farm **Overview** — Potential Demand = open, unconfirmed demand whose produce and timing fit each batch |
| HarvestMatch incl. **minimum order quantity**, previous purchases, shelf life | Farm minimum order per produce (Settings → Produce) and buyer minimum delivery (`minQuantity`) are enforced in scoring and on approval |
| Proposal lens: margin, urgency, purchase likelihood | Shown on every match as decision-support chips. The official score stays the Final document's additive formula |
| Demand Recovery channels (restaurant network, hotel, existing customers, community, consumers, Rescue) | Recovery panel: five channels plus the existing-customer and subscriber split; DemandPool and donation suggestions |
| Rescue segments incl. **Chef Pack** | Harvest grade `CHEF_PACK` |
| **Margin Guard** | Farm-private production cost per batch and minimum margin per farm. Shown on batches, on matches and in the Rescue price check |
| **Dynamic Perishable Inventory Routing** | Shelf life per crop gives stages Premium → Community → Rescue → Clearance → Donation. Routing card on each batch, dashboard alerts, donation / alternative-use / waste records |
| **FarmPool** (many farms → one buyer) | Network → FarmPool. Buyers opt in with "Allow FarmPool"; each farm commits from its own batch; partner farms are anonymised |
| **DemandPool** (many buyers → one viable order) | Network → DemandPool. Small requests below the farm minimum are pooled atomically, optionally through a Community Drop |
| Bulk orders (business buyers) and purchases (consumers) | Available Supply cart (multi-line) and Buy on Available Now / Growing Soon. Orders start PENDING until the farm confirms |
| Farm Profiles | Marketplace → Farms (`/market/farms`) |
| Platform admin: policies, disputes, security | Admin → Policies (live-editable business rules), Disputes, Audit log (including sign-in events) |
| KPIs: **Demand Recovery Time**, **Waste Avoided**, **Average Margin per kg** | Analytics. Each shows "Not enough data yet" until real records exist |
| Pilot success framework (baseline vs pilot vs change) | Analytics → Pilot success framework. Baselines are entered by the farm, never invented |
| AI: explanations, demand-insight summaries, campaign variations, pricing support | "Explain with AI", the AI demand insights card and campaign variations. **Simulated without an OpenAI key**: the UI labels the output "Simulated" and shows the exact prompt that would be sent. Pricing support is rule-based and labelled as such |

## HTTP status codes

The client has a designed page for **every standard and common non-standard HTTP status code** (1xx–5xx, 67 codes):

- `/status` — a searchable reference of all codes, grouped by category, marking the 12 the Tyllage API returns and their machine-readable error `code` values.
- `/status/:code` — a preview of the page for any code (e.g. `/status/503`).
- Unknown URLs show the **404** page, role-restricted pages show an inline **403**, and failed page loads show the page for the API status they received (network failures show **503**).
- The API returns **413** `PAYLOAD_TOO_LARGE` for JSON bodies over 100kb and **415** `UNSUPPORTED_MEDIA_TYPE` for non-JSON write requests.

The catalog lives in `client/src/utils/httpStatus.js` and the page in `client/src/components/StatusPage.jsx`.

## Security

- bcrypt password hashing (12 rounds) and JWT bearer auth. The role is re-read from the database on every request, and deactivated users are rejected immediately.
- `verifyToken`, `requireRole` and `requireFarmAccess` on every protected route. A client-supplied `farmId` is always checked against the user's farm memberships. Resource routes (`/:id`) load the record and check its `farm_id` server-side.
- Parameterised SQL only. zod validation on every write. Database constraints back up the business rules (e.g. `min_price ≤ preferred_price`, `rescue_price ≤ original_price`, positive quantities).
- helmet, CORS allow-list, global plus stricter auth rate limits, a 100kb JSON body limit, and sanitised production errors.
- An audit log covers farm-sensitive actions (`HARVEST_CREATED`, `MATCH_APPROVED`, `ORDER_CANCELLED`, `RECOVERY_STARTED`, `RESCUE_CREATED`, `CAMPAIGN_APPROVED`, …), written inside the same transaction as the action.
- AI guard-rails: OpenAI only receives backend-built context and only returns copy. Generated text is scanned for prices that are not in the approved context, and these are flagged to the reviewer.
- Known MVP trade-offs: the JWT is stored in `localStorage` (move to httpOnly cookies before handling payments), and the WhatsApp webhook POST does not yet verify `X-Hub-Signature-256` (add this before processing inbound messages).

## Tests

```bash
npm test
```

This requires `TEST_DATABASE_URL`, a **disposable** database that is dropped and re-seeded per test file. The 98 tests cover:

- authentication and incorrect credentials
- RBAC and farm access isolation, including spoofed `farmId`
- harvest validation and the minimum-price rule
- demand creation
- HarvestMatch scoring, weights, incompatible-price rejection and the greedy supply cap
- over-allocation protection, including **concurrent approvals**
- cancelled-allocation restoration
- recovery exclusions
- Rescue validation and suitability confirmation
- analytics formulas and "not enough data" handling
- the campaign approve-before-send workflow in mock mode
- the health endpoint
- HTTP 400/413/415 handling
- proposal features: Dynamic Routing, Margin Guard, minimum order quantities, DemandPool, FarmPool (with partner anonymity), bulk orders, dispositions, the new KPIs, baselines, disputes, platform policies and the AI simulation

## Railway deployment

The repo deploys as **one Railway service** plus a **Railway PostgreSQL** database:

1. Create a Railway project and add **PostgreSQL**.
2. Add a service from this repo (root directory). `railway.json` sets:
   - build: `npm run build:railway` (installs server production deps and the client, then builds the client)
   - start: `npm start` (the server applies pending migrations on boot, then serves the API and `client/dist`)
   - health check: `GET /api/health`
3. Set variables on the service:
   - `NODE_ENV=production`
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `JWT_SECRET` (≥ 32 random characters)
   - optionally `OPENAI_API_KEY`, `WHATSAPP_*`
   - `CLIENT_URL` only if the client is hosted elsewhere
4. Optional demo data: set `SEED_DEMO_ON_START=true`. The server seeds the fictional pilot data on boot only when the database has no farms, so restarts never reseed. Set `VITE_SHOW_DEMO_ACCOUNTS=true` to show the demo-account picker on the login page; it is read at build time, so redeploy after setting it.

The frontend never assumes localhost. It calls same-origin `/api`, or `VITE_API_URL` when built for a separate host. Set `RUN_MIGRATIONS_ON_START=false` if you prefer to run `npm run migrate` as a separate release step.

---

## Current MVP scope

**Built (P0):** auth + RBAC, farm dashboard, produce, harvests, buyers and demand, Demand Coverage and risk, HarvestMatch, allocations and orders, Demand Recovery, Tyllage Rescue, analytics.
**Built (P1):** Tyllage Connect (OpenAI/mock), WhatsApp Cloud API service (mock/live), Community Drops, buyer portal, consumer portal, platform admin.

**Deliberately not built:** ML forecasting, IoT, drones, computer vision, robotic harvesting, FarmPool/DemandPool, a payment gateway, route optimisation, a native mobile app, blockchain, a digital twin, and pricing AI.

## Future roadmap

**Phase 2 — Analytics expansion:** richer commercial analytics, channel performance, price-response analysis, customer segmentation.

**Phase 3 — Predictive intelligence:** a separate Python AI/ML service for demand forecasting, surplus prediction, buyer probability, channel optimisation and pricing recommendations. Node remains the main backend.

**Phase 4 — Multi-farm network:** FarmPool, DemandPool, cross-farm fulfilment, self-serve farm onboarding, buyer sourcing across farms.

**Phase 5 — Farm intelligence:** IoT and environmental sensors, computer vision, yield prediction, digital twins, drones.

```
Predicted Farm Supply  +  Predicted Buyer Demand
                 ↓
            HarvestMatch
                 ↓
   Optimal Commercial Allocation
```
