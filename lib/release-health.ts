interface ReleaseEnvironment {
  FEUD_ENVIRONMENT?: string;
  FEUD_COMMIT_SHA?: string;
}

/** Attach release identity only to a successful game health response. */
export async function withReleaseHealth(
  request: Request,
  response: Response,
  configuration: ReleaseEnvironment,
): Promise<Response> {
  if (request.method !== "GET" || new URL(request.url).pathname.replace(/\/+$/, "") !== "/api/health" || !response.ok) {
    return response;
  }
  const environment = configuration.FEUD_ENVIRONMENT;
  const commitSha = configuration.FEUD_COMMIT_SHA;
  if (environment === undefined && commitSha === undefined) return response;
  if ((environment !== "production" && environment !== "staging") || !commitSha || !/^[a-f0-9]{40}$/.test(commitSha)) {
    return Response.json({ error: "The game release is not configured correctly." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  const body = await response.json() as Record<string, unknown>;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return Response.json({ ...body, environment, commitSha }, { status: response.status, headers });
}
