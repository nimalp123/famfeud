# AGENTS.md

## Lifebase continuity

The canonical project entity is `project:famfeud`.

- Configure the private Cloud environment with both `nimalp123/famfeud` and `nimalp123/nimz-lifebase`. Locate the private sibling checkout from the actual workspace inventory, read its `AGENTS.md`, and follow its referenced session protocol in place. Do not assume a personal-machine path or copy private protocol/source content into this public game repository.
- Start each task with the exposed Lifebase connector's `lifebase_context` using the exact query `project:famfeud` and `max_chars: 262144`. If that connector is unavailable, follow the private checkout's README and `skills/lifebase-context` Git-only reader protocol. Pin the actual full checkout commit, retain `portable-as-of` status and coverage, and treat work newer than that published snapshot as unknown. A 24,000-character budget can omit required essentials. Read the complete response in bounded parts; do not clip it or silently drop its coverage report.
- Read current corrections, the latest matching project handoff, and cited original sources before making precise project claims. Retain observation times, exact entity scope, selected/eligible counts, omissions, and unavailable source layers. A lexical fallback is not an entity alias or proof of complete project coverage.
- Record meaningful milestones, decisions and unresolved work, and finish with a handoff, through the supported private session protocol (`lifebase_record` and `lifebase_handoff` on the connector), scoped to `entity: project:famfeud`. Include verified results, concrete next steps, evidence and actual known agent/provider/model/session provenance; leave unknown fields unknown. Generated engineering reports use `confidence: unknown` and remain distinct from owner statements and independently observed results.
- Retain every returned record ID. For connector writes, read each new record back with `lifebase_search(query: record_id, limit: 1)` using that exact ID alone, then verify its entity is `project:famfeud` and its content matches. Combining the entity with the ID disables the exact-ID route. Follow the private protocol for Git-only readback. Report the actual persistence boundary: Cloud-local writes or readback do not establish synchronization to the Mac or live connector.
- If neither the connector nor the supported private checkout context path succeeds, the Lifebase start is incomplete. Report concrete tool/command failures and missing coverage. Continue safe, authorized source work when possible, but do not claim failed context retrieval, registration or persistence succeeded.
- Keep private context packets, Lifebase ledgers and configuration, raw histories, personal-file paths and credentials out of this public repository. Refer to private evidence through Lifebase rather than copying it here.

## Codex Cloud development

Use a private Cloud environment named `famfeud` with the game and private Lifebase sibling checkouts. Run game commands from the `famfeud` checkout. Node.js 24 and `npm ci` match CI. Run checks in this order:

```sh
npm run build:vercel
npm run typecheck
npm test
```

The default Cloud task is development and testing. Work on task branches; pushes to `main` or `staging` trigger managed deployments. Do not run production database, migration, seed or deployment commands unless that work is explicitly requested. Do not supply production keys to the development environment.

For an interactive local backend, follow README's local development sequence: `npm run build` builds Vinext, apply all four checked-in Drizzle migrations to local D1, then use `npm run dev`. This path needs no production InsForge credentials. Keep checkout-local runtime state and secrets ignored.

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **feud-night** (API base `https://s2gk84v4.us-west.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
