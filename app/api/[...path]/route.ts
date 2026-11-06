import { ipAddress } from "@vercel/functions";
import { handleApi } from "../../../lib/api.ts";
import { createInsforgeBackend } from "../../../lib/insforge-backend.ts";
import { trustedVercelRequest } from "../../../lib/vercel-request.ts";
import type { GameEnvironment } from "../../../lib/types.ts";

export const dynamic = "force-dynamic";

let backend: ReturnType<typeof createInsforgeBackend> | undefined;

async function handleRequest(request: Request): Promise<Response> {
  if (process.env.VERCEL || process.env.INSFORGE_URL) {
    const url = process.env.INSFORGE_URL;
    const apiKey = process.env.INSFORGE_API_KEY;
    if (!url || !apiKey) {
      return Response.json({ error: "The game database is not configured yet." }, { status: 503 });
    }
    backend ??= createInsforgeBackend(url, apiKey);
    return handleApi(trustedVercelRequest(request, ipAddress(request)), { backend });
  }
  const { env } = await import("cloudflare:workers");
  return handleApi(request, env as GameEnvironment);
}

export const GET = handleRequest;
export const POST = handleRequest;
