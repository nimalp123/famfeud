import assert from "node:assert/strict";
import test from "node:test";
import { trustedVercelRequest } from "../lib/vercel-request.ts";

test("Vercel requests replace browser identity headers and preserve game credentials", async () => {
  const request = new Request("https://feud.example/api/rooms/ABC234/action", {
    method: "POST",
    headers: {
      "oai-authenticated-user-id": "forged-user",
      "cf-connecting-ip": "forged-ip",
      "authorization": "Bearer test-seat",
      "origin": "https://feud.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: { type: "ready", ready: true } }),
  });
  const trusted = trustedVercelRequest(request, "192.0.2.10");
  assert.equal(trusted.headers.get("oai-authenticated-user-id"), null);
  assert.equal(trusted.headers.get("cf-connecting-ip"), "192.0.2.10");
  assert.equal(trusted.headers.get("authorization"), "Bearer test-seat");
  assert.equal(trusted.headers.get("origin"), "https://feud.example");
  assert.deepEqual(await trusted.json(), { action: { type: "ready", ready: true } });
});

test("missing Vercel client IP cannot retain a forged Cloudflare identity", () => {
  const request = new Request("https://feud.example/api/rooms", {
    headers: { "cf-connecting-ip": "forged-ip", "oai-authenticated-user-id": "forged-user" },
  });
  const trusted = trustedVercelRequest(request, undefined);
  assert.equal(trusted.headers.get("cf-connecting-ip"), null);
  assert.equal(trusted.headers.get("oai-authenticated-user-id"), null);
});
