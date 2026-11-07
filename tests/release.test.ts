import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateRoomBaseUrl } from "../lib/room-url.ts";
import { withReleaseHealth } from "../lib/release-health.ts";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const HEALTH_REQUEST = new Request("https://feud.insforge.site/api/health");

function healthResponse() {
  return Response.json({ ok: true, questionCount: 2000 }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

test("room destinations accept only the two configured public game pages", () => {
  assert.equal(validateRoomBaseUrl(undefined), undefined);
  for (const path of ["/feud", "/s-feud"]) {
    const value = `https://www.nimalp123.com${path}`;
    assert.equal(validateRoomBaseUrl(value), value);
  }
  for (const value of [
    "", "https://example.com/feud", "http://www.nimalp123.com/feud",
    "https://www.nimalp123.com.evil.test/feud", "https://www.nimalp123.com@evil.test/feud",
    "https://www.nimalp123.com/other", "https://www.nimalp123.com/feud?room=ABCDEF",
    "https://www.nimalp123.com/feud#room", "https://www.nimalp123.com/feud/../s-feud",
  ]) {
    assert.throws(() => validateRoomBaseUrl(value), /NEXT_PUBLIC_ROOM_BASE_URL/);
  }
});

test("the client chooses each configured destination over upstream and frame URLs", () => {
  const clientModule = new URL("../lib/client.ts", import.meta.url).href;
  for (const path of ["/feud", "/s-feud"]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import { roomLink } from ${JSON.stringify(clientModule)};
      console.log(roomLink("ABCDEF", "https://upstream.insforge.site", "https://www.nimalp123.com/"));
    `], {
      encoding: "utf8",
      env: { ...process.env, NEXT_PUBLIC_ROOM_BASE_URL: `https://www.nimalp123.com${path}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `https://www.nimalp123.com${path}?room=ABCDEF`);
  }
});

test("the Next.js build configuration rejects an unexpected public room destination", () => {
  const configurationModule = new URL("../next.config.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    await import(${JSON.stringify(configurationModule)});
  `], {
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_ROOM_BASE_URL: "https://unexpected.example/feud" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NEXT_PUBLIC_ROOM_BASE_URL/);
});

test("release health adds the exact deployment identity and preserves existing fields and headers", async () => {
  for (const environment of ["production", "staging"]) {
    const response = await withReleaseHealth(HEALTH_REQUEST, healthResponse(), {
      FEUD_ENVIRONMENT: environment, FEUD_COMMIT_SHA: COMMIT_SHA,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(await response.json(), { ok: true, questionCount: 2000, environment, commitSha: COMMIT_SHA });
  }
});

test("legacy health, failed health, and other game endpoints retain their responses", async () => {
  const legacy = healthResponse();
  assert.equal(await withReleaseHealth(HEALTH_REQUEST, legacy, {}), legacy);
  assert.deepEqual(await legacy.json(), { ok: true, questionCount: 2000 });

  const failed = Response.json({ error: "Database unavailable" }, { status: 503 });
  assert.equal(await withReleaseHealth(HEALTH_REQUEST, failed, { FEUD_ENVIRONMENT: "staging" }), failed);
  const rooms = Response.json({ rooms: [] });
  assert.equal(await withReleaseHealth(new Request("https://feud.insforge.site/api/rooms"), rooms, {
    FEUD_ENVIRONMENT: "staging", FEUD_COMMIT_SHA: COMMIT_SHA,
  }), rooms);
});

test("invalid release configuration cannot report a healthy release or disclose its values", async () => {
  for (const configuration of [
    { FEUD_ENVIRONMENT: "production" },
    { FEUD_COMMIT_SHA: COMMIT_SHA },
    { FEUD_ENVIRONMENT: "unknown-private-value", FEUD_COMMIT_SHA: COMMIT_SHA },
    { FEUD_ENVIRONMENT: "staging", FEUD_COMMIT_SHA: "private-value" },
    { FEUD_ENVIRONMENT: "production", FEUD_COMMIT_SHA: COMMIT_SHA.slice(0, 7) },
  ]) {
    const response = await withReleaseHealth(HEALTH_REQUEST, healthResponse(), configuration);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "The game release is not configured correctly." });
  }
});
