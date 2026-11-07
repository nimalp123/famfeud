/** Replace browser identity headers using the host's trusted client IP. */
export function trustedVercelRequest(request: Request, clientIp: string | undefined): Request {
  const headers = new Headers(request.headers);
  headers.delete("oai-authenticated-user-id");
  headers.delete("cf-connecting-ip");
  if (clientIp) headers.set("cf-connecting-ip", clientIp);
  // Vinext's request facade is not a native Request constructor input.
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    ...(request.body ? { body: request.body, duplex: "half" as const } : {}),
  };
  return new Request(request.url, init);
}
