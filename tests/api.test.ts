import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { handleApi } from "../lib/api.ts";
import type {
  ApiSessionResponse,
  ClientAction,
  GameEnvironment,
  PublicRoom,
  RoomSettings,
  RoomState,
  RoomView,
  Session,
} from "../lib/types.ts";

const ORIGIN = "https://feud.test";
const DEFAULT_SETTINGS: RoomSettings = {
  mode: "solo",
  category: "Anything goes",
  rounds: 3,
  maxPlayers: 6,
};

interface Result<T> {
  response: Response;
  data: T;
}

interface ErrorBody {
  error: string;
}

interface Fixture {
  database: DatabaseSync;
  env: GameEnvironment;
  close(): void;
}

// Real SQLite executes the production migrations and SQL. The async boundary
// models D1 round trips so competing requests exercise optimistic CAS retries.
async function fixture(): Promise<Fixture> {
  const database = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql")).sort();
  assert.ok(migrations.length > 0, "The D1 schema migration must exist.");
  for (const name of migrations) {
    database.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
  }

  function prepare(sql: string, values: Array<string | number | null> = []) {
    return {
      bind(...parameters: Array<string | number | null>) {
        return prepare(sql, parameters);
      },
      async first() {
        await setImmediate();
        return database.prepare(sql).get(...values) ?? null;
      },
      async all() {
        await setImmediate();
        return { results: database.prepare(sql).all(...values), success: true, meta: {} };
      },
      async run() {
        await setImmediate();
        const result = database.prepare(sql).run(...values);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
    database,
    env: { DB: { prepare } as unknown as D1Database },
    close: () => database.close(),
  };
}

async function request<T>(
  env: GameEnvironment,
  path: string,
  options: { body?: unknown; token?: string; origin?: string; method?: string; userId?: string; ip?: string } = {},
): Promise<Result<T>> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.userId) headers.set("oai-authenticated-user-id", options.userId);
  if (options.ip) headers.set("cf-connecting-ip", options.ip);
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  if (method === "POST") headers.set("Origin", options.origin ?? ORIGIN);
  const response = await handleApi(new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), env);
  return { response, data: await response.json() as T };
}

async function create(env: GameEnvironment, name = "Host", settings: Partial<RoomSettings> = {}) {
  const result = await request<ApiSessionResponse>(env, "/api/rooms", {
    body: { name, avatar: 0, settings: { ...DEFAULT_SETTINGS, ...settings } },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return result.data;
}

async function join(env: GameEnvironment, code: string, name = "Guest") {
  const result = await request<ApiSessionResponse>(env, `/api/rooms/${code}/join`, {
    body: { name, avatar: 1 },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.data;
}

function action(env: GameEnvironment, session: Session, value: ClientAction) {
  return request<{ room: RoomView } & Partial<ErrorBody>>(env, `/api/rooms/${session.code}/action`, {
    token: session.token,
    body: { action: value },
  });
}

function storedRoom(f: Fixture, code: string): RoomState {
  const row = f.database.prepare("SELECT state FROM rooms WHERE code = ?").get(code);
  assert.ok(row && typeof row.state === "string");
  return JSON.parse(row.state) as RoomState;
}

function saveStoredRoom(f: Fixture, room: RoomState) {
  f.database.prepare("UPDATE rooms SET state = ?, phase = ?, updated_at = ? WHERE code = ?")
    .run(JSON.stringify(room), room.phase, room.updatedAt, room.code);
}

async function start(f: Fixture, host: ApiSessionResponse, guest: ApiSessionResponse) {
  assert.equal((await action(f.env, guest.session, { type: "ready", ready: true })).response.status, 200);
  const result = await action(f.env, host.session, { type: "start" });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.room.phase, "playing");
  return result.data.room;
}

test("independent seats reconnect with their own tokens and never expose credentials", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code.toLowerCase());

  assert.match(host.session.code, /^[A-Z2-9]{6}$/);
  assert.notEqual(host.session.token, guest.session.token);
  assert.notEqual(host.session.playerId, guest.session.playerId);
  assert.equal(guest.room.players.length, 2);
  assert.equal(host.room.isPublic, false);
  for (const player of guest.room.players) {
    assert.equal("tokenHash" in player, false);
    assert.equal("lastGuessAt" in player, false);
  }
  assert.equal(JSON.stringify(guest.room).includes(host.session.token), false);
  assert.equal("questions" in guest.room, false);

  const reconnected = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: host.session.token,
  });
  assert.equal(reconnected.response.status, 200);
  assert.equal(reconnected.data.room.players.length, 2);
  const missing = await request<ErrorBody>(f.env, `/api/rooms/${host.session.code}`);
  assert.equal(missing.response.status, 401);
  const foreign = await create(f.env, "Different host");
  const wrongRoom = await request<ErrorBody>(f.env, `/api/rooms/${host.session.code}`, {
    token: foreign.session.token,
  });
  assert.equal(wrongRoom.response.status, 401);
  const privatePlayer = storedRoom(f, host.session.code).players[0];
  assert.match(privatePlayer.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(privatePlayer.tokenHash, host.session.token);
});

test("only the host opens a private room to public discovery", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  const list = () => request<{ rooms: PublicRoom[] }>(f.env, "/api/rooms");
  assert.deepEqual((await list()).data.rooms, []);

  const denied = await action(f.env, guest.session, { type: "settings", settings: {}, isPublic: true });
  assert.ok(denied.response.status >= 400);
  assert.deepEqual((await list()).data.rooms, []);
  assert.equal((await action(f.env, host.session, { type: "settings", settings: {}, isPublic: true })).response.status, 200);
  const rooms = (await list()).data.rooms;
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].code, host.session.code);
  assert.equal(rooms[0].players, 2);
  assert.equal(JSON.stringify(rooms).includes(host.session.token), false);

  assert.equal((await action(f.env, host.session, { type: "settings", settings: {}, isPublic: false })).response.status, 200);
  assert.deepEqual((await list()).data.rooms, []);
});

test("concurrent joins respect the final open seat without losing either request", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env, "Host", { maxPlayers: 2 });
  await action(f.env, host.session, { type: "settings", settings: {}, isPublic: true });
  const attempts = await Promise.all(["First", "Second"].map((name) =>
    request<ApiSessionResponse | ErrorBody>(f.env, `/api/rooms/${host.session.code}/join`, {
      body: { name, avatar: 1 },
    })));

  assert.equal(attempts.filter((result) => result.response.status === 200).length, 1);
  assert.equal(attempts.filter((result) => result.response.status >= 400).length, 1);
  assert.equal(storedRoom(f, host.session.code).players.length, 2);
  assert.deepEqual((await request<{ rooms: PublicRoom[] }>(f.env, "/api/rooms")).data.rooms, []);
});

test("starting requires readiness and keeps the entire unrevealed board server-side", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  assert.ok((await action(f.env, host.session, { type: "start" })).response.status >= 400);
  const guest = await join(f.env, host.session.code);
  assert.ok((await action(f.env, guest.session, { type: "start" })).response.status >= 400);
  assert.ok((await action(f.env, host.session, { type: "start" })).response.status >= 400);
  const room = await start(f, host, guest);
  assert.equal(room.source, "curated");
  assert.equal("questions" in room, false);
  assert.ok(room.round && room.round.answers.length >= 5);
  assert.ok(room.round.answers.every((answer) => answer.text === null && answer.points === null));
  assert.ok(room.round.answers.every((answer) => !("aliases" in answer)));
  assert.ok((await request<ErrorBody>(f.env, `/api/rooms/${host.session.code}/join`, {
    body: { name: "Too late", avatar: 2 },
  })).response.status >= 400);
});

test("concurrent lobby changes rebase without losing readiness or visibility", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  const results = await Promise.all([
    action(f.env, host.session, { type: "settings", settings: {}, isPublic: true }),
    action(f.env, guest.session, { type: "ready", ready: true }),
  ]);
  assert.ok(results.every((result) => result.response.status === 200));
  const room = storedRoom(f, host.session.code);
  assert.equal(room.isPublic, true);
  assert.equal(room.players.find((player) => player.id === guest.session.playerId)?.ready, true);
});

test("concurrent start requests create a single active game", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  await action(f.env, guest.session, { type: "ready", ready: true });
  const results = await Promise.all([
    action(f.env, host.session, { type: "start" }),
    action(f.env, host.session, { type: "start" }),
  ]);
  assert.equal(results.filter((result) => result.response.status === 200).length, 1);
  assert.equal(results.filter((result) => result.response.status >= 400).length, 1);
  const room = storedRoom(f, host.session.code);
  assert.equal(room.phase, "playing");
  assert.equal(room.generationId, null);
  assert.equal(room.questions.length, room.settings.rounds);
  assert.equal(room.events.filter((event) => event.text === "Round 1 is live!").length, 1);
});

test("simultaneous matching guesses award a hidden answer exactly once", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  await start(f, host, guest);
  const answer = storedRoom(f, host.session.code).questions[0].answers[0];
  const results = await Promise.all([host.session, guest.session].map((session) =>
    action(f.env, session, { type: "guess", guess: answer.text })));

  assert.equal(results.filter((result) => result.response.status === 200).length, 1);
  assert.equal(results.filter((result) => result.response.status >= 400).length, 1);
  const current = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: host.session.token,
  });
  assert.equal(current.data.room.players.reduce((total, player) => total + player.score, 0), answer.points);
  assert.equal(current.data.room.round?.bank, answer.points);
  assert.equal(current.data.room.round?.answers.filter((entry) => entry.revealed).length, 1);
  assert.ok(current.data.room.round?.answers.filter((entry) => !entry.revealed)
    .every((entry) => entry.text === null && entry.points === null));
});

test("simultaneous different guesses preserve both valid answers and scores", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  await start(f, host, guest);
  const [first, second] = storedRoom(f, host.session.code).questions[0].answers;
  const results = await Promise.all([
    action(f.env, host.session, { type: "guess", guess: first.text }),
    action(f.env, guest.session, { type: "guess", guess: second.text }),
  ]);
  assert.ok(results.every((result) => result.response.status === 200), JSON.stringify(results.map((result) => result.data)));
  const room = storedRoom(f, host.session.code);
  assert.equal(Object.keys(room.round!.revealed).length, 2);
  assert.equal(room.players.reduce((total, player) => total + player.score, 0), first.points + second.points);
  assert.equal(room.round!.bank, first.points + second.points);
});

test("reads persist round expiry, then host progression and rematch reset the match", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  await start(f, host, guest);
  const expired = storedRoom(f, host.session.code);
  expired.roundIndex = expired.settings.rounds - 1;
  expired.round!.deadline = Date.now() - 1;
  saveStoredRoom(f, expired);
  const polled = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: guest.session.token,
  });
  assert.equal(polled.data.room.phase, "round-ended");
  assert.ok(polled.data.room.round!.answers.every((answer) => answer.text && answer.points));
  assert.equal(storedRoom(f, host.session.code).phase, "round-ended");
  assert.ok((await action(f.env, guest.session, { type: "next" })).response.status >= 400);
  assert.equal((await action(f.env, host.session, { type: "next" })).data.room.phase, "finished");
  const reset = await action(f.env, host.session, { type: "rematch" });
  assert.equal(reset.data.room.phase, "lobby");
  assert.equal(reset.data.room.round, null);
  assert.ok(reset.data.room.players.every((player) => player.score === 0));
  assert.equal(reset.data.room.players.find((player) => player.id === guest.session.playerId)?.ready, false);
});

test("team turns reject the other side and advance when the active player times out", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env, "Host", { mode: "teams" });
  const guest = await join(f.env, host.session.code);
  const room = await start(f, host, guest);
  const active = room.round!.activePlayerId === host.session.playerId ? host : guest;
  const inactive = active === host ? guest : host;
  const answer = storedRoom(f, host.session.code).questions[0].answers[0];
  assert.ok((await action(f.env, inactive.session, { type: "guess", guess: answer.text })).response.status >= 400);
  const expired = storedRoom(f, host.session.code);
  const activeTeam = expired.round!.activeTeam;
  expired.round!.deadline = Date.now() - 1;
  saveStoredRoom(f, expired);
  const polled = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: inactive.session.token,
  });
  assert.equal(polled.data.room.round!.teamStrikes[activeTeam], 1);
  assert.ok(polled.data.room.round!.deadline > Date.now());
  assert.equal(polled.data.room.phase, "playing");
});

test("a late guess cannot reopen an expired round or hide its persisted end", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  await start(f, host, guest);
  const expired = storedRoom(f, host.session.code);
  expired.round!.deadline = Date.now() - 1;
  const answer = expired.questions[0].answers[0];
  saveStoredRoom(f, expired);
  const late = await action(f.env, host.session, { type: "guess", guess: answer.text });
  assert.ok(late.response.status >= 400);
  const room = storedRoom(f, host.session.code);
  assert.equal(room.phase, "round-ended");
  assert.equal(room.round!.bank, 0);
  assert.equal(Object.keys(room.round!.revealed).length, 0);
});

test("kicking revokes a seat and leaving transfers the host without orphaning the room", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const guest = await join(f.env, host.session.code);
  const last = await join(f.env, host.session.code, "Last");
  assert.ok((await action(f.env, guest.session, { type: "kick", playerId: host.session.playerId })).response.status >= 400);
  assert.equal((await action(f.env, host.session, { type: "kick", playerId: guest.session.playerId })).response.status, 200);
  assert.equal((await request<ErrorBody>(f.env, `/api/rooms/${host.session.code}`, {
    token: guest.session.token,
  })).response.status, 401);
  assert.equal((await action(f.env, host.session, { type: "leave" })).response.status, 200);
  const remaining = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: last.session.token,
  });
  assert.equal(remaining.data.room.hostId, last.session.playerId);
  assert.equal((await action(f.env, last.session, { type: "leave" })).response.status, 200);
  assert.equal((await request<ErrorBody>(f.env, `/api/rooms/${host.session.code}`, {
    token: last.session.token,
  })).response.status, 404);
});

test("mutation boundaries reject cross-origin, malformed, and oversized requests", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const crossOrigin = await request<ErrorBody>(f.env, "/api/rooms", {
    origin: "https://other.test",
    body: { name: "Host", settings: DEFAULT_SETTINGS },
  });
  assert.equal(crossOrigin.response.status, 403);
  const invalid = await handleApi(new Request(`${ORIGIN}/api/rooms`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  }), f.env);
  assert.equal(invalid.status, 400);
  const oversized = await request<ErrorBody>(f.env, "/api/rooms", {
    body: { name: "x".repeat(5000), settings: DEFAULT_SETTINGS },
  });
  assert.equal(oversized.response.status, 413);
  const nonJson = await handleApi(new Request(`${ORIGIN}/api/rooms`, {
    method: "POST", body: "plain text",
  }), f.env);
  assert.equal(nonJson.status, 415);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM rooms").get()!.count, 0);
});

test("abandoned question generation recovers through ordinary room polling", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const state = storedRoom(f, host.session.code);
  state.phase = "generating";
  state.generationId = `${Date.now() - 100_000}:abandoned`;
  saveStoredRoom(f, state);
  const result = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: host.session.token,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.room.phase, "lobby");
  assert.match(result.data.room.error!, /try again/i);
  assert.equal(storedRoom(f, host.session.code).generationId, null);
});

test("simultaneous creation requests share an atomic quota and separate users keep their own allowance", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const createRequest = (name: string, userId: string) => request<ApiSessionResponse | ErrorBody>(f.env, "/api/rooms", {
    userId,
    body: { name, avatar: 0, settings: DEFAULT_SETTINGS },
  });
  const results = await Promise.all(Array.from({ length: 11 }, (_, index) =>
    createRequest(`Host ${index}`, "same-user")));
  assert.equal(results.filter((result) => result.response.status === 201).length, 10);
  assert.equal(results.filter((result) => result.response.status === 429).length, 1);
  assert.equal((await createRequest("Independent host", "another-user")).response.status, 201);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM rooms").get()!.count, 11);

  const rows = f.database.prepare("SELECT key FROM rate_limits WHERE scope = 'create'").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => typeof row.key === "string" && /^[a-f0-9]{64}$/.test(row.key)));
});

test("join attempts share the 30-per-minute IP quota without blocking an independent visitor", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const results = await Promise.all(Array.from({ length: 31 }, (_, index) =>
    request<ErrorBody>(f.env, "/api/rooms/ZZZZZZ/join", {
      ip: "192.0.2.10",
      body: { name: `Visitor ${index}`, avatar: 1 },
    })));
  assert.equal(results.filter((result) => result.response.status === 404).length, 30);
  assert.equal(results.filter((result) => result.response.status === 429).length, 1);
  const independent = await request<ApiSessionResponse>(f.env, `/api/rooms/${host.session.code}/join`, {
    ip: "192.0.2.11",
    body: { name: "Independent visitor", avatar: 2 },
  });
  assert.equal(independent.response.status, 200);
  assert.equal(independent.data.room.players.length, 2);
});

test("room-start quota bounds repeated starts before question generation", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const results = await Promise.all(Array.from({ length: 4 }, () =>
    action(f.env, host.session, { type: "start" })));
  assert.equal(results.filter((result) => result.response.status === 400).length, 3);
  assert.equal(results.filter((result) => result.response.status === 429).length, 1);
  assert.equal(storedRoom(f, host.session.code).phase, "lobby");
});

test("an offline host transfers once to the earliest connected player and retains its reconnectable seat", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const host = await create(f.env);
  const first = await join(f.env, host.session.code, "First guest");
  const second = await join(f.env, host.session.code, "Second guest");
  const room = storedRoom(f, host.session.code);
  const now = Date.now();
  room.players.find((player) => player.id === host.session.playerId)!.lastSeen = now - 89_000;
  room.players.find((player) => player.id === first.session.playerId)!.joinedAt = now - 2000;
  room.players.find((player) => player.id === second.session.playerId)!.joinedAt = now - 1000;
  saveStoredRoom(f, room);

  const gracePeriod = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: first.session.token,
  });
  assert.equal(gracePeriod.data.room.hostId, host.session.playerId);
  const expired = storedRoom(f, host.session.code);
  expired.players.find((player) => player.id === host.session.playerId)!.lastSeen = Date.now() - 91_000;
  saveStoredRoom(f, expired);

  const polls = await Promise.all([first, second].map((visitor) =>
    request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, { token: visitor.session.token })));
  assert.ok(polls.every((result) => result.response.status === 200));
  const transferred = storedRoom(f, host.session.code);
  assert.equal(transferred.hostId, first.session.playerId);
  assert.equal(transferred.players.length, 3);
  assert.equal(transferred.players.find((player) => player.id === first.session.playerId)?.ready, true);
  assert.equal(transferred.events.filter((event) => event.text === "First guest is now the host.").length, 1);

  const returned = await request<{ room: RoomView }>(f.env, `/api/rooms/${host.session.code}`, {
    token: host.session.token,
  });
  assert.equal(returned.response.status, 200);
  assert.equal(returned.data.room.hostId, first.session.playerId);
  assert.equal(returned.data.room.players.find((player) => player.id === host.session.playerId)?.connected, true);
});
