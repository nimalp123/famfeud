import { addPlayer, advanceTime, applyAction, createRoom, startGame, toRoomView, validateSettings } from "./game.ts";
import { generateQuestions } from "./questions.ts";
import { questionCount } from "./question-bank.ts";
import { PLAYER_AVATARS, QUESTION_CATEGORIES } from "./constants.ts";
import { RoomStorageError, RoomStore } from "./storage.ts";
import type { ClientAction, GameEnvironment, Player, RoomRepository, RoomSettings, RoomState } from "./types.ts";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BODY_LIMIT = 4096;

class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError("Send a JSON request.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("The request body is missing.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        throw new ApiError("The request is too large.", 413);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError("The request contains invalid JSON.");
  }
  if (!isObject(parsed)) throw new ApiError("Send a JSON object.");
  return parsed;
}

function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin)
      || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError("This action must come from the game page.", 403);
  }
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestTokenHash(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) throw new ApiError("Rejoin the room to continue.", 401);
  return tokenHash(match[1]);
}

async function requesterKey(request: Request): Promise<string> {
  const userId = request.headers.get("oai-authenticated-user-id");
  if (userId) return tokenHash(`user:${userId}`);
  const connectingIp = request.headers.get("cf-connecting-ip");
  return tokenHash(connectingIp ? `ip:${connectingIp}` : "local-development");
}

function currentPlayer(room: RoomState, hash: string): Player {
  const player = room.players.find((entry) => entry.tokenHash === hash);
  if (!player) throw new ApiError("Your seat is no longer in this room. Please rejoin.", 401);
  return player;
}

function gameCall<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "That action is unavailable.");
  }
}

async function makePlayer(body: Record<string, unknown>): Promise<{ player: Player; token: string }> {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ApiError("Choose a nickname between 1 and 24 characters.");
  }
  const avatar = body.avatar === undefined ? 0 : body.avatar;
  if (typeof avatar !== "number" || !Number.isInteger(avatar) || avatar < 0 || avatar >= PLAYER_AVATARS.length) {
    throw new ApiError("Choose a valid player icon.");
  }
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Date.now();
  return {
    token,
    player: {
      id: crypto.randomUUID(), tokenHash: await tokenHash(token), name, avatar,
      team: null, ready: false, score: 0, joinedAt: now, lastSeen: now, lastGuessAt: 0,
    },
  };
}

function parseSettings(value: unknown): RoomSettings {
  if (!isObject(value)) throw new ApiError("Choose the game settings first.");
  const settings = gameCall(() => validateSettings({
    mode: value.mode as RoomSettings["mode"],
    category: value.category as string,
    rounds: value.rounds as number,
    maxPlayers: value.maxPlayers as number,
  }));
  if (!QUESTION_CATEGORIES.includes(settings.category as typeof QUESTION_CATEGORIES[number])) {
    throw new ApiError("Choose one of the available question categories.");
  }
  return settings;
}

function parseAction(value: unknown): ClientAction {
  if (!isObject(value) || typeof value.type !== "string") throw new ApiError("Choose a valid action.");
  switch (value.type) {
    case "start":
    case "leave":
    case "next":
    case "rematch":
      return { type: value.type };
    case "ready":
      if (typeof value.ready !== "boolean") throw new ApiError("Choose your ready status.");
      return { type: "ready", ready: value.ready };
    case "team":
      if (value.team !== 0 && value.team !== 1) throw new ApiError("Choose one of the two teams.");
      return { type: "team", team: value.team };
    case "kick":
      if (typeof value.playerId !== "string" || value.playerId.length > 80) throw new ApiError("Choose a player to remove.");
      return { type: "kick", playerId: value.playerId };
    case "guess":
      if (typeof value.guess !== "string" || !value.guess.trim() || value.guess.length > 100) {
        throw new ApiError("Enter a guess between 1 and 100 characters.");
      }
      return { type: "guess", guess: value.guess.trim() };
    case "settings": {
      if (!isObject(value.settings)) throw new ApiError("Choose valid game settings.");
      if (value.isPublic !== undefined && typeof value.isPublic !== "boolean") throw new ApiError("Choose a valid room visibility.");
      const settings: Partial<RoomSettings> = {};
      if ("mode" in value.settings) settings.mode = value.settings.mode as RoomSettings["mode"];
      if ("category" in value.settings) {
        const category = typeof value.settings.category === "string" ? value.settings.category.trim() : "";
        if (!QUESTION_CATEGORIES.includes(category as typeof QUESTION_CATEGORIES[number])) {
          throw new ApiError("Choose one of the available question categories.");
        }
        settings.category = category;
      }
      if ("rounds" in value.settings) settings.rounds = value.settings.rounds as number;
      if ("maxPlayers" in value.settings) settings.maxPlayers = value.settings.maxPlayers as number;
      return { type: "settings", settings, isPublic: value.isPublic as boolean | undefined };
    }
    default:
      throw new ApiError("That game action is unavailable.");
  }
}

function recoverGeneration(room: RoomState, now: number): RoomState {
  if (room.phase !== "generating") return room;
  const started = Number(room.generationId?.split(":")[0]);
  if (Number.isFinite(started) && now - started < 90_000) return room;
  return {
    ...room, phase: "lobby", generationId: null, updatedAt: now,
    error: "Loading questions took too long. The host can try again.",
  };
}

async function touchRoom(store: RoomRepository, code: string, hash: string): Promise<RoomState> {
  return store.mutate(code, (room) => {
    const player = currentPlayer(room, hash);
    const now = Date.now();
    let next = recoverGeneration(room, now);
    next = advanceTime(next, now);
    if (now - player.lastSeen >= 10_000) {
      next = structuredClone(next);
      const current = currentPlayer(next, hash);
      current.lastSeen = now;
      next.updatedAt = now;
    }
    const host = next.players.find((entry) => entry.id === next.hostId);
    if (host && now - host.lastSeen >= 90_000) {
      const successor = next.players.filter((entry) => now - entry.lastSeen <= 30_000)
        .sort((left, right) => left.joinedAt - right.joinedAt || left.id.localeCompare(right.id))[0];
      if (successor) {
        next = structuredClone(next);
        next.hostId = successor.id;
        next.players.find((entry) => entry.id === successor.id)!.ready = true;
        next.events.push({
          id: crypto.randomUUID(), text: `${successor.name} is now the host.`, kind: "system", at: now,
        });
        next.events = next.events.slice(-20);
        next.updatedAt = now;
      }
    }
    return next;
  });
}

async function beginGame(store: RoomRepository, code: string, hash: string, environment: GameEnvironment): Promise<RoomState> {
  const generationId = `${Date.now()}:${crypto.randomUUID()}`;
  const pending = await store.mutate(code, (room) => {
    const host = currentPlayer(room, hash);
    if (host.id !== room.hostId) throw new ApiError("Only the host can start the game.", 403);
    if (room.phase !== "lobby") throw new ApiError("This game has already started.", 409);
    if (room.players.length < 2) throw new ApiError("Invite at least one more player to start.");
    if (room.players.some((player) => !player.ready)) throw new ApiError("Wait until every player is ready.");
    if (room.settings.mode === "teams") {
      const red = room.players.filter((player) => player.team === 0).length;
      const blue = room.players.filter((player) => player.team === 1).length;
      if (red === 0 || blue === 0 || Math.abs(red - blue) > 1 || red + blue !== room.players.length) {
        throw new ApiError("Both teams need players and must be balanced before starting.");
      }
    }
    return { ...room, phase: "generating", generationId, error: null, updatedAt: Date.now() };
  });
  try {
    const generated = await generateQuestions(pending.settings, environment, pending.usedQuestionIds);
    return await store.mutate(code, (room) => {
      currentPlayer(room, hash);
      if (room.phase !== "generating" || room.generationId !== generationId) {
        throw new ApiError("This game start is no longer active.", 409);
      }
      return gameCall(() => ({ ...startGame(room, generated.questions, generated.source, Date.now()), usedQuestionIds: generated.usedQuestionIds }));
    });
  } catch (error) {
    if (error instanceof RoomStorageError && error.status === 404) throw error;
    const recovered = await store.mutate(code, (room) => {
      if (room.phase !== "generating" || room.generationId !== generationId) return room;
      return {
        ...room, phase: "lobby", generationId: null, updatedAt: Date.now(),
        error: "We could not load this game's questions. Please try again.",
      };
    });
    currentPlayer(recovered, hash);
    return recovered;
  }
}

export async function handleApi(request: Request, environment: GameEnvironment): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (!environment.DB && !environment.backend) throw new ApiError("The game database is not configured yet.", 503);
    if (request.method === "GET" && path === "/api/health") {
      const count = environment.backend
        ? await environment.backend.countQuestions()
        : await questionCount(environment.DB);
      return json({ ok: true, questionCount: count });
    }
    const store = environment.backend?.rooms ?? new RoomStore(environment.DB!);
    if (request.method === "GET" && path === "/api/rooms") {
      return json({ rooms: await store.listPublic(Date.now()) });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ error: "Use GET or POST for this endpoint." }, 405);
    }
    if (request.method === "POST") requireSameOrigin(request);
    if (request.method === "POST" && path === "/api/rooms") {
      const body = await readBody(request);
      const settings = parseSettings(body.settings);
      await store.consumeRateLimit("create", await requesterKey(request), 10, 60 * 60 * 1000, Date.now());
      const { player, token } = await makePlayer(body);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const random = crypto.getRandomValues(new Uint8Array(6));
        const code = Array.from(random, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
        const room = gameCall(() => createRoom({ code, player, settings, now: Date.now() }));
        if (await store.create(room)) {
          return json({ session: { code, playerId: player.id, token }, room: toRoomView(room, Date.now()) }, 201);
        }
      }
      throw new ApiError("We could not reserve a room code. Please try again.", 503);
    }
    const match = /^\/api\/rooms\/([A-Za-z0-9]{6})(?:\/(join|action))?$/.exec(path);
    if (!match) throw new ApiError("This game endpoint could not be found.", 404);
    const code = match[1].toUpperCase();
    const operation = match[2];
    if (request.method === "POST" && operation === "join") {
      const body = await readBody(request);
      await store.consumeRateLimit("join", await requesterKey(request), 30, 60 * 1000, Date.now());
      const { player, token } = await makePlayer(body);
      const room = await store.mutate(code, (current) => gameCall(() => addPlayer(current, player, Date.now())));
      return json({ session: { code, playerId: player.id, token }, room: toRoomView(room, Date.now()) });
    }
    if ((request.method === "GET" && operation) || (request.method === "POST" && operation !== "action")) {
      throw new ApiError("This game endpoint could not be found.", 404);
    }
    const hash = await requestTokenHash(request);
    let room = await touchRoom(store, code, hash);
    if (request.method === "POST") {
      const body = await readBody(request);
      const action = parseAction(body.action);
      if (action.type === "start") {
        if (currentPlayer(room, hash).id !== room.hostId) throw new ApiError("Only the host can start the game.", 403);
        const key = await requesterKey(request);
        await store.consumeRateLimit("start", key, 10, 60 * 60 * 1000, Date.now());
        await store.consumeRateLimit("room-start", await tokenHash(code), 3, 60 * 1000, Date.now());
        room = await beginGame(store, code, hash, environment);
      } else {
        let actionError: ApiError | null = null;
        room = await store.mutate(code, (current) => {
          actionError = null;
          const player = currentPlayer(current, hash);
          const advanced = advanceTime(current, Date.now());
          try {
            return gameCall(() => applyAction(advanced, player.id, action, Date.now()));
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            actionError = error;
            return advanced;
          }
        });
        if (actionError) throw actionError;
      }
    }
    return json({ room: toRoomView(room, Date.now()) });
  } catch (error) {
    if (error instanceof ApiError || error instanceof RoomStorageError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "The game server had a problem. Please try again." }, 500);
  }
}
