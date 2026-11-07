import assert from "node:assert/strict";
import test from "node:test";
import { handleLegacyBackendMigration, type LegacyMigrationEnvironment, type MigrationRoomRow, type MigrationTarget } from "../lib/legacy-backend-migration.ts";

const SECRET = "m".repeat(43);

function sourceRoom(code = "ABCDEF", score = 73) {
  const state = {
    code, revision: 4, phase: "playing", isPublic: false, createdAt: 1_000, updatedAt: 2_000,
    players: [{ id: "private-player", name: "private-name", tokenHash: "private-token-hash", score }],
    questions: [{ id: "question", prompt: "Full board", answers: [{ text: "A complete answer", aliases: ["x".repeat(6000)], points: 100 }] }],
    round: { bank: 73, revealed: { answer: "private-player" }, deadline: 9_000 },
    teamScores: [73, 0], events: [{ text: "private-event", at: 1_500 }],
  };
  return { code, state: JSON.stringify(state), revision: 18, is_public: 0, phase: "playing", updated_at: 2_000 };
}

function setup(initial = [sourceRoom()]) {
  let source = structuredClone(initial);
  let sourceReads = 0;
  let targetReads = 0;
  const insertCalls: MigrationRoomRow[][] = [];
  const stored = new Map<string, MigrationRoomRow>();
  let afterInsert: (() => void) | undefined;
  const DB = {
    prepare(sql: string) {
      assert.match(sql, /^SELECT code, state, revision, is_public, phase, updated_at FROM rooms ORDER BY code$/);
      return {
        async all() {
          sourceReads += 1;
          return { success: true, results: structuredClone(source) };
        },
      };
    },
  } as unknown as D1Database;
  const target: MigrationTarget = {
    async read(codes) {
      targetReads += 1;
      return codes.flatMap((code) => stored.has(code) ? [structuredClone(stored.get(code)!)] : []);
    },
    async insert(rows) {
      assert.ok(rows.every((row) => !stored.has(row.code)), "The batch must never overwrite");
      insertCalls.push(structuredClone(rows));
      for (const row of rows) stored.set(row.code, structuredClone(row));
      afterInsert?.();
    },
  };
  const environment: LegacyMigrationEnvironment = {
    DB, FEUD_MAINTENANCE: "1", FEUD_MIGRATION_TOKEN: SECRET,
    INSFORGE_URL: "https://example.us-west.insforge.app", INSFORGE_API_KEY: "private-admin-key",
  };
  const request = (token: string | null = SECRET, method = "POST", path = "/api/migrate-backend") => new Request(`https://legacy.example${path}`, {
    method, headers: token === null ? {} : { "x-feud-migration-token": token },
  });
  return {
    environment, request, target, stored, insertCalls,
    reads: () => ({ source: sourceReads, target: targetReads }),
    changeSource: (rows: typeof source) => { source = structuredClone(rows); },
    afterInsert: (callback: () => void) => { afterInsert = callback; },
  };
}

test("the migration stays undiscoverable and reads nothing without all authorization guards", async () => {
  const f = setup();
  for (const [request, environment] of [
    [f.request(null), f.environment],
    [f.request("x".repeat(43)), f.environment],
    [f.request(SECRET, "GET"), f.environment],
    [f.request(SECRET, "POST", "/api/other"), f.environment],
    [f.request(), { ...f.environment, FEUD_MAINTENANCE: "0" }],
    [f.request(), { ...f.environment, DB: undefined }],
    [f.request(), { ...f.environment, INSFORGE_API_KEY: undefined }],
    [f.request(), { ...f.environment, FEUD_MIGRATION_TOKEN: "short" }],
  ] as const) {
    const response = await handleLegacyBackendMigration(request, environment, () => { throw new Error("No target access allowed"); });
    assert.equal(response.status, 404);
  }
  assert.deepEqual(f.reads(), { source: 0, target: 0 });
  assert.equal(f.insertCalls.length, 0);
});

test("full room state survives one atomic batch and repeated migration is idempotent", async () => {
  const initial = [sourceRoom(), sourceRoom("BCDEFG", 27)];
  const f = setup(initial);
  const first = await handleLegacyBackendMigration(f.request(), f.environment, () => f.target);
  assert.equal(first.status, 200);
  const receipt = await first.json() as Record<string, unknown>;
  assert.deepEqual({ ...receipt, digest: "digest" }, { ok: true, rooms: 2, imported: 2, verified: 2, players: 2, totalScore: 100, digest: "digest" });
  assert.match(receipt.digest as string, /^[a-f0-9]{64}$/);
  assert.equal(f.insertCalls.length, 1);
  assert.equal(f.insertCalls[0].length, 2);
  for (const row of initial) {
    const stored = f.stored.get(row.code)!;
    assert.deepEqual(stored.state, { ...JSON.parse(row.state), revision: row.revision });
    assert.ok(JSON.stringify(stored.state).length > 6000);
    assert.equal(stored.is_public, false);
  }
  const output = JSON.stringify(receipt);
  for (const value of ["ABCDEF", "BCDEFG", "private-name", "private-token-hash", "private-admin-key", SECRET]) assert.equal(output.includes(value), false);
  const repeated = await handleLegacyBackendMigration(f.request(), f.environment, () => f.target);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { ...receipt, imported: 0 });
  assert.equal(f.insertCalls.length, 1);
  assert.deepEqual(initial, [sourceRoom(), sourceRoom("BCDEFG", 27)]);
  assert.deepEqual(f.reads(), { source: 4, target: 4 });
});

test("a different target collision aborts before inserting any missing room", async () => {
  const f = setup([sourceRoom(), sourceRoom("BCDEFG")]);
  const first = sourceRoom();
  f.stored.set(first.code, {
    ...first, state: { ...JSON.parse(first.state), revision: first.revision, players: [] }, is_public: false,
  });
  const before = structuredClone([...f.stored]);
  const response = await handleLegacyBackendMigration(f.request(), f.environment, () => f.target);
  assert.equal(response.status, 409);
  assert.equal(f.insertCalls.length, 0);
  assert.deepEqual([...f.stored], before);
});

test("inconsistent source metadata or truncated JSON fails before target access", async () => {
  for (const altered of [
    { ...sourceRoom(), phase: "finished" },
    { ...sourceRoom(), state: sourceRoom().state.slice(0, 2046) },
  ]) {
    const f = setup([altered]);
    const response = await handleLegacyBackendMigration(f.request(), f.environment, () => { throw new Error("Target should remain untouched"); });
    assert.equal(response.status, 503);
    assert.deepEqual(f.reads(), { source: 1, target: 0 });
  }
});

test("verification refuses a changed target and detects a late source mutation", async () => {
  for (const change of ["source", "target"]) {
    const f = setup();
    f.afterInsert(() => {
      if (change === "source") f.changeSource([sourceRoom("ABCDEF", 74)]);
      else f.stored.get("ABCDEF")!.state.round = { bank: 999 };
    });
    const response = await handleLegacyBackendMigration(f.request(), f.environment, () => f.target);
    assert.equal(response.status, 409, change);
  }
});
