import { env } from "cloudflare:workers";
import { handleApi } from "../../../lib/api.ts";
import type { GameEnvironment } from "../../../lib/types.ts";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleApi(request, env as GameEnvironment);
}

export function POST(request: Request): Promise<Response> {
  return handleApi(request, env as GameEnvironment);
}
