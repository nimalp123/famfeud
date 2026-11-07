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

## Stored question bank

The game uses 2,000 authored survey-style rounds stored in InsForge Postgres for Vercel, or Cloudflare D1 for Sites. Each has six ranked answers with spelling and synonym aliases, for 12,000 answers total. The five categories have 400 rounds each. “Anything goes” mixes all 2,000. The shared public counts live in `lib/constants.ts`; the client only imports that metadata.

Boards and rankings are written for a 16–22 audience. Edits draw on everyday experiences and current media habits reported in [Pew’s teen platform research](https://www.pewresearch.org/internet/2026/04/15/teens-experiences-on-tiktok-instagram-and-snapchat/) and [young-adult social media data](https://www.pewresearch.org/internet/fact-sheet/social-media/). The server accepts board aliases, common paraphrases and close typos when they identify a single answer.

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

The Vercel build uses native Next.js and the InsForge backend. Set `INSFORGE_URL` and `INSFORGE_API_KEY` as server-only Vercel environment variables. Local development reads the same variables from the ignored `.env.local` file. Keep `.insforge/project.json` private.

After linking the InsForge project, apply the Postgres migration and import the validated question bank. The import upserts all boards in one database request. Repeat it after editing the bank.

```sh
npx -y @insforge/cli db migrations up --all
npm run seed:insforge
npm run dev:vercel
```

`vercel.json` selects `npm run build:vercel` for deployment. Run `npm run typecheck`, `npm test`, and `npm run build:vercel` before deploying. Postgres RPCs enforce atomic room creation, revision-checked updates, and quota increments. Anonymous database access is disabled. The server returns the existing sanitized room views to players.

### Sites and Cloudflare

The checked-in `.openai/hosting.json` identifies the Site and its D1 binding. Sites applies the schema-only Drizzle migrations when publishing. Sessions and rooms are shared through D1 using revision-checked updates. Browser clients synchronize about once a second. Public-room discovery is separate from the Site’s overall access setting.
