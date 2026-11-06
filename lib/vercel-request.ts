/** Replace identity headers from the browser with Vercel's trusted client IP. */
export function trustedVercelRequest(request: Request, clientIp: string | undefined): Request {
  const headers = new Headers(request.headers);
  headers.delete("oai-authenticated-user-id");
  headers.delete("cf-connecting-ip");
  if (clientIp) headers.set("cf-connecting-ip", clientIp);
  return new Request(request, { headers });
}
