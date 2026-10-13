# The Eliminator’s Gambit

A party game of strategy and risk. Two teams take turns eliminating options on screen, trying to leave the single
worst item (e.g. the lowest-rated movie) for last. Eliminate the target yourself and your team takes the hit.

**Scoring:** +1 for every safe elimination, −4 for eliminating the target (which ends the round). If only the target
is left, nobody fell for it and the round is a tie. A match is 1–10 rounds; the higher total wins.

**Round types**

| Type     | Target                         | Extra                                     |
|----------|--------------------------------|-------------------------------------------|
| Rated    | the item with the lowest rating | rating is revealed on elimination          |
| Manual   | marked by the host              | hidden info is revealed on elimination     |
| Carousel | marked by the host              | every item is a picture card               |

Rounds are authored in the built-in editor and stored per **game set** — a private space protected by a PIN.
Rounds can be exported to / imported from a JSON file (images included).

## Stack

Everything runs on Cloudflare’s free tier:

- **Cloudflare Workers** — the API (`src/`, TypeScript, no framework) and static assets (`public/`, vanilla ES modules, no build step)
- **D1** (SQLite) — game sets, sessions, rounds, matches and images (`migrations/`)
- A daily cron cleans up expired sessions, old matches and orphaned images

```
src/
  index.ts      router, security headers, cron
  game.ts       pure game rules (unit-tested)
  auth.ts       game sets, PIN hashing (PBKDF2), sessions, lockout
  templates.ts  round editor CRUD
  matches.ts    match flow, server-side scoring
  images.ts     image upload/serving (content-addressed)
public/         index.html, styles.css, js/*.js
test/           Vitest tests that run inside the Workers runtime
e2e/smoke.mjs   Playwright smoke test against a running server
```

## Local development

```bash
npm install
npm run dev            # applies migrations to a local D1 and starts http://localhost:8787
npm run check          # typecheck + tests
BASE_URL=http://localhost:8787 npm run e2e   # browser smoke test (needs Playwright's Chromium)
```

## Deploying

Production: https://app.eliminatorsgambit.com — Cloudflare Worker `eliminators-gambit` + D1 database
`eliminators-gambit` (ids in `wrangler.jsonc`). Deploys are manual from a logged-in machine (`npx wrangler login`):

```bash
git am patches/<change>.patch   # if the change came as a patch (patches/ is git-ignored)
npm ci
npm run check                   # typecheck + tests
npm run deploy                  # applies pending D1 migrations, then deploys the Worker
git push origin main
```

CI (`.github/workflows/ci.yml`) only runs typecheck and tests on pushes and PRs; it does not deploy.

## API (all JSON, `Authorization: Bearer <token>` except auth and image GET)

| Method | Path | |
|---|---|---|
| GET  | `/api/game-sets/:name` | does a game set exist / have a PIN |
| POST | `/api/auth/login` | `{name, pin, create?}` → `{token}` |
| POST | `/api/auth/logout`, `/api/auth/pin` | log out / change PIN |
| GET/POST | `/api/templates` | list / create rounds |
| GET/PUT/DELETE | `/api/templates/:id` | read / update / delete a round |
| POST | `/api/images` | raw image body → `{id, url}` |
| GET  | `/api/images/:id` | image bytes (immutable cache) |
| GET  | `/api/builtins` | built-in round sources |
| POST | `/api/matches` | `{team1, team2, plan: ["template:<id>" \| "builtin:movies", …]}` |
| GET  | `/api/matches/current`, `/api/matches/:id` | resume a match |
| POST | `/api/matches/:id/eliminate` | `{item_id}` |
| POST | `/api/matches/:id/next`, `/api/matches/:id/end` | advance / stop |
