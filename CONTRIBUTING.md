# Contributing to Tyllage

Thanks for helping build Tyllage: a commercial-intelligence platform that helps local farms decide where upcoming harvest should go.

## Before you start

- Read the [README](README.md) for the product, architecture and local setup.
- For anything larger than a small fix, **open an issue first** so the approach can be agreed before you write code.
- Security problems must **not** go in public issues. Follow [SECURITY.md](SECURITY.md).
- By contributing you agree that your work is released under the [MIT License](LICENSE). You also agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local setup (short version)

```bash
npm run install:all
```

```bash
cp .env.example server/.env
```

Edit `server/.env` (database URLs, `JWT_SECRET`). Then migrate and seed the fictional demo data:

```bash
npm run migrate
```

```bash
npm run seed
```

Run the API and the client in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

## Making a change

1. Create a branch from `main`, for example `feat/route-score-tooltip` or `fix/settings-overflow`.
2. Keep each pull request focused on one change.
3. **Follow the existing structure:**
   - routes → controllers → services → models;
   - business rules belong in `server/src/config/rules.js` or platform policies, not hard-coded in services;
   - every farm-sensitive query checks farm access on the server;
   - farm-private fields (minimum price, production cost, margins, fulfilment cost) must never reach buyer or public responses.
4. **Database changes** go in a new numbered file in `server/src/db/migrations/`. Never edit a migration that has already been applied.
5. **Add or update tests** in `server/tests/` for any change in behaviour.
6. Make sure everything passes:

```bash
npm test
```

```bash
npm run build
```

7. If you changed the UI, check it at phone (375px), tablet (768px) and desktop widths.

## Commit messages

Use a short imperative subject line (about 70 characters or fewer), for example `Add route tooltip to MarketRoute card`. Explain the *why* in the body when it is not obvious.

## Pull requests

Use the pull request template. Describe what changed and why, and how you tested it. Add screenshots for UI changes.

A maintainer reviews every pull request. Changes to authentication, access control or data exposure need extra care and may take longer.

## Demo data

All seeded data is **fictional pilot data**. Do not add real farm, buyer, price or customer information to seeds, tests, issues or screenshots.
