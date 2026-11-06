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
npm run dev
```

Open the printed localhost URL in separate tabs to play as separate guests. Player credentials are stored in session storage, so a refresh preserves your seat. Closing the tab ends that browser seat’s saved session.

## Stored question bank

The game uses 200 authored survey-style rounds stored in Cloudflare D1. Each has six ranked answers with spelling and synonym aliases, for 1,200 answers total. The five categories have 40 rounds each. “Anything goes” mixes all 200.

The JSON sources are in `data/question-bank/`. The server validates them and seeds the database idempotently on first use. Source corrections update stored rows on a new server instance, while active matches keep their original fixed boards. A room remembers used questions across rematches and exhausts its selected category before recycling questions. Points are estimated game weights and sum to 100 per board.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The test suite covers both modes, matching, hidden-answer protection, simultaneous claims, lobby authorization, host succession, the full 200-question cycle, and rate limits. API tests run production SQL against SQLite with a D1-compatible adapter. Browser and Cloudflare runtime checks are separate.

## Hosting

The checked-in `.openai/hosting.json` identifies the Site and its D1 binding. Sites applies the schema-only Drizzle migrations when publishing. Sessions and rooms are shared through D1 using revision-checked updates. Browser clients synchronize about once a second. Public-room discovery is separate from the Site’s overall access setting.
