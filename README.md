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
npm run dev
```

Open the printed localhost URL in separate tabs to play as separate guests. Player credentials are stored in session storage, so a refresh preserves your seat. Closing the tab ends that browser seat’s saved session.

## AI question generation

The server uses the OpenAI Responses API with a strict JSON schema. Set `OPENAI_API_KEY` as a server-only secret. `OPENAI_MODEL` defaults to `gpt-4.1-mini`. For local development, use an ignored `.dev.vars` file with those names. For hosted play, set them in the Site’s runtime environment and redeploy.

With no key, the game clearly labels its curated practice boards. A configured provider failure returns the lobby to a retryable state. AI-estimated popularity scores are game values. No real survey is claimed. A new board is generated for each match and stays fixed during that match.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The test suite covers both modes, matching, hidden-answer protection, simultaneous claims, lobby authorization, host succession, generation failure, and rate limits. API tests run production SQL against SQLite with a D1-compatible adapter. Browser and Cloudflare runtime checks are separate.

## Hosting

The checked-in `.openai/hosting.json` identifies the Site and its D1 binding. Sites applies the schema-only Drizzle migrations when publishing. Sessions and rooms are shared through D1 using revision-checked updates. Browser clients synchronize about once a second. Public-room discovery is separate from the Site’s overall access setting.
