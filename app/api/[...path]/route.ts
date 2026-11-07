import { ipAddress } from "@vercel/functions";
import { handleApi } from "../../../lib/api.ts";
import { createInsforgeBackend } from "../../../lib/insforge-backend.ts";
import { trustedVercelRequest } from "../../../lib/vercel-request.ts";
import { withReleaseHealth } from "../../../lib/release-health.ts";
import { handleLegacyBackendMigration, type LegacyMigrationEnvironment } from "../../../lib/legacy-backend-migration.ts";
import type { GameEnvironment } from "../../../lib/types.ts";

export const dynamic = "force-dynamic";

let backend: ReturnType<typeof createInsforgeBackend> | undefined;

async function handleGameRequest(request: Request): Promise<Response> {
  if (!process.env.VERCEL) {
    let workerEnvironment: GameEnvironment | undefined;
    try {
      workerEnvironment = (await import("cloudflare:workers")).env as GameEnvironment;
    } catch {
      // Local Next.js has no Cloudflare runtime module.
    }
    if (workerEnvironment) {
      const legacy = workerEnvironment as unknown as Record<string, unknown>;
      if (legacy.FEUD_MAINTENANCE === "1") {
        if (new URL(request.url).pathname === "/api/migrate-backend") {
          return handleLegacyBackendMigration(request, workerEnvironment as LegacyMigrationEnvironment);
        }
        return Response.json({ error: "Updating the game connection. Reconnecting in a moment." }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "2" },
        });
      }
      if (typeof legacy.INSFORGE_URL !== "string" || typeof legacy.INSFORGE_API_KEY !== "string") {
        return handleApi(request, workerEnvironment);
      }
      backend ??= createInsforgeBackend(legacy.INSFORGE_URL, legacy.INSFORGE_API_KEY);
      return handleApi(trustedVercelRequest(request, request.headers.get("cf-connecting-ip") ?? undefined), { backend });
    }
  }
  const url = process.env.INSFORGE_URL;
  const apiKey = process.env.INSFORGE_API_KEY;
  if (!url || !apiKey) {
    return Response.json({ error: "The game database is not configured yet." }, { status: 503 });
  }
  backend ??= createInsforgeBackend(url, apiKey);
  return handleApi(trustedVercelRequest(request, ipAddress(request)), { backend });
}

async function handleRequest(request: Request): Promise<Response> {
  return withReleaseHealth(request, await handleGameRequest(request), {
    FEUD_ENVIRONMENT: process.env.FEUD_ENVIRONMENT,
    FEUD_COMMIT_SHA: process.env.FEUD_COMMIT_SHA,
  });
}

export const GET = handleRequest;
export const POST = handleRequest;
