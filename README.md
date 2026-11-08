# Feud Night

Live survey-style party battles for 2–12 people. Create a private lobby, share its six-character code, and optionally open its spare seats to public players.

## Play modes

- **Free-for-all** — everyone guesses at once. The first player to claim an answer wins its points. Three misses sit that player out until the next round.
- **Team showdown** — teammates take turns. Three strikes give the other team one attempt to steal the round’s bank.

Hosts choose a category and three or five rounds. Readiness, scoring, timers, room membership, and hidden answer boards are enforced on the server. Disconnected players can refresh their tab to return. An active player inherits hosting after the host has been offline for 90 seconds.

## Local development

Use Node.js 22.13 or later. Node.js 22.18 or later is required for the TypeScript test runner.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_handy_wither.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_faithful_caretaker.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_striped_barracuda.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_question_bank_metadata.sql
npm run dev
```

Use separate browser profiles for separate players. A room link contains its six-character code. Reopen it in the same browser profile to recover your saved seat after a refresh, closed tab, or connection drop. A shared room link never includes your player credential.

## Codex Cloud

The intended private Cloud work environment is `famfeud`, containing both `nimalp123/famfeud` and the private `nimalp123/nimz-lifebase` repository as sibling checkouts. Locate the actual private checkout, read its `AGENTS.md` and referenced session protocol in place, and keep its private content out of this public repository. Configure Node.js 24 and run `npm ci` from the game checkout. Development and tests need no production credentials. Run the same checks as CI:

```sh
npm run build:vercel
npm run typecheck
npm test
```

For a playable local backend, use the local development sequence above: build Vinext, apply the four migrations to local D1, and run `npm run dev`. Keep Cloud work on task branches; pushing `main` or `staging` invokes the deployment workflow.

Start every task with the Lifebase context protocol for exact query `project:famfeud` and `max_chars: 262144`, following [AGENTS.md](AGENTS.md). Use the exposed connector when available; otherwise follow the private checkout's README and `skills/lifebase-context` Git-only fallback. Preserve the actual pinned commit, `portable-as-of` boundary and coverage; newer unpublished work remains unknown. Report an incomplete Lifebase start only when neither supported context path succeeds. Scoped milestone records, final handoffs and readback must state their actual persistence boundary; Cloud-local writes do not imply Mac synchronization. Keep private Lifebase material in its private checkout, outside public game history. Do not add production keys to Cloud development.

## Stored question bank

The game uses 2,000 authored survey-style rounds stored in InsForge Postgres, with an optional Cloudflare D1 fallback. Each has six ranked answers with spelling and synonym aliases, for 12,000 answers total. The five categories have 400 rounds each. “Anything goes” mixes all 2,000. The shared public counts live in `lib/constants.ts`; the client only imports that metadata.

Prompts and rankings are written for people born from 2004 through 2010. The boards draw on everyday experiences and current media habits reported in [Pew’s teen platform research](https://www.pewresearch.org/internet/2026/04/15/teens-experiences-on-tiktok-instagram-and-snapchat/) and [young-adult social media data](https://www.pewresearch.org/internet/fact-sheet/social-media/). The server accepts board aliases, common paraphrases, and small spelling mistakes, including swapped letters, when they identify a single answer.

The 25 JSON sources are in `data/question-bank/`. The server validates exactly 2,000 distinct boards, the category totals, six ranked answers, unambiguous aliases, and 100 points per board. The D1 deployment compares a SHA-256 content revision with database metadata on first use. A changed revision is seeded with ten 200-row statements plus its revision marker, in one atomic D1 batch. Matching revisions skip all seed writes, including after server restarts. Apply the schema migrations before starting the app. Request handlers do not create or alter tables.

On D1, source corrections update stored rows when the content revision changes. InsForge uses the explicit bank import described below. Active matches keep their original fixed boards. A room remembers used questions across rematches and exhausts its selected category before recycling questions. Full boards and hidden answers remain on the server; round selection reuses only the bank's ID/category index before reading selected boards from the configured database. Points are estimated game weights and sum to 100 per board.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The test suite covers both modes, matching, hidden-answer protection, simultaneous claims, lobby authorization, host succession, the full 2,000-question cycle, category cycles, and rate limits. API tests run production SQL against SQLite with a D1-compatible adapter. Browser and Cloudflare runtime checks are separate.

## Hosting

### Vercel and InsForge

The native Next.js build is published through InsForge's managed Vercel hosting. Pushes to `main` update production at [nimalp123.com/feud](https://nimalp123.com/feud). Pushes to `staging` update the separate staging game at [nimalp123.com/s-feud](https://nimalp123.com/s-feud). Each environment has its own Free InsForge project and database.

The `Check and deploy` GitHub Actions workflow builds Next.js, runs the type checker and tests, and deploys the checked commit. Pull requests run checks only. Deployments are serialized per branch. A queued run skips publication when a newer branch commit is available.

Create GitHub environments named `production` and `staging`. Each needs environment-scoped secrets `INSFORGE_URL` and `INSFORGE_API_KEY`, plus the `INSFORGE_PROJECT_ID` variable. Keep the API key server-only. The managed deployment's persistent environment also holds `INSFORGE_URL`, `INSFORGE_API_KEY` and `NEXT_PUBLIC_ROOM_BASE_URL`. Set the room base to exactly `https://www.nimalp123.com/feud` for production or `https://www.nimalp123.com/s-feud` for staging. The workflow sets `FEUD_ENVIRONMENT` and `FEUD_COMMIT_SHA` for each source deployment.

The deployment script links the backend in a temporary directory, applies pending Postgres migrations through InsForge's native ledger, and imports the validated question bank before uploading source. It refuses to apply the baseline migration to an existing Feud schema whose migration record is missing. The bank import upserts all boards in one request. Publication succeeds only after the stable managed URL reports the expected commit, environment and question count at `/api/health`.

For local Next.js development, the ignored `.env.local` supplies the server variables. Keep `.insforge/project.json` private. After linking the intended backend, prepare it with the native migration command and bank import.

```sh
npx -y @insforge/cli@0.2.8 db migrations up --all --json
npm run seed:insforge
npm run dev:vercel
```

`vercel.json` selects `npm run build:vercel` for deployment. Run `npm run typecheck`, `npm test`, and `npm run build:vercel` before deploying. Postgres RPCs enforce atomic room creation, revision-checked updates, and quota increments. Anonymous database access is disabled. The server returns the existing sanitized room views to players.

### Legacy Sites URL

The legacy public Sites URL is configured to use the production InsForge database after the one-time room migration, so its rooms stay in sync with `/feud`. The seat bridge helps an existing browser recover its saved seat when moving from the embedded game to the production host. The original D1 data and binding are retained as a backup. The checked-in `.openai/hosting.json` preserves that Site's identity and Cloudflare build configuration.

Before switching the legacy backend, prepare the production schema and question bank, then deploy the legacy Worker with its original `DB` binding, production InsForge server credentials, `FEUD_MAINTENANCE=1`, and a server-only `FEUD_MIGRATION_TOKEN` containing a random 43-character base64url token. Maintenance pauses normal game requests. Send one `POST /api/migrate-backend` to that Worker with the token in the `x-feud-migration-token` header. Do not put the token in a URL or browser bundle.

The endpoint reads full D1 rooms, inserts missing rooms atomically without overwriting existing codes, and verifies both the target copy and unchanged source. Record its aggregate counts and digest before opening traffic. A `409` collision or verification failure requires investigation; do not cut over or delete source data. An identical retry is safe. Once verification succeeds and the production host is healthy, remove the migration token and maintenance flag while routing both public entry points to production InsForge. Keep D1 as the backup; the copy never writes to it.
