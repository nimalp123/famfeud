import type { PublicRoom, RoomRepository, RoomState } from "./types.ts";

interface RoomRow {
  state: string;
  revision: number;
}

export class RoomStorageError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RoomStorageError";
    this.status = status;
  }
}

/** Apply one intent to the newest committed state until its revision wins. */
export async function mutateRoom(
  code: string,
  update: (room: RoomState) => RoomState,
  read: (code: string) => Promise<RoomState>,
  compareAndSet: (previous: RoomState, next: RoomState) => Promise<boolean>,
): Promise<RoomState> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const previous = await read(code);
    const next = update(structuredClone(previous));
    if (JSON.stringify(next) === JSON.stringify(previous)) return previous;
    next.revision = previous.revision + 1;
    if (await compareAndSet(previous, next)) return next;
  }
  throw new RoomStorageError("The room is busy. Please try your action again.", 409);
}

export class RoomStore implements RoomRepository {
  private database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async consumeRateLimit(scope: string, key: string, limit: number, windowMs: number, now: number): Promise<void> {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const result = await this.database.prepare(
      `INSERT INTO rate_limits (scope, key, window_start, hits, expires_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (scope, key) DO UPDATE SET
         hits = CASE WHEN rate_limits.window_start < excluded.window_start THEN 1 ELSE rate_limits.hits + 1 END,
         window_start = MAX(rate_limits.window_start, excluded.window_start),
         expires_at = MAX(rate_limits.expires_at, excluded.expires_at)
       RETURNING hits`,
    ).bind(scope, key, windowStart, windowStart + windowMs).first<{ hits: number }>();
    if (!result || result.hits > limit) {
      throw new RoomStorageError("Too many requests. Please wait a little and try again.", 429);
    }
  }

  async get(code: string): Promise<RoomState> {
    const row = await this.database.prepare(
      "SELECT state, revision FROM rooms WHERE code = ?",
    ).bind(code).first<RoomRow>();
    if (!row) {
      throw new RoomStorageError("That room could not be found. Check the code and try again.", 404);
    }
    const room = JSON.parse(row.state) as RoomState;
    room.revision = row.revision;
    return room;
  }

  async create(room: RoomState): Promise<boolean> {
    const result = await this.database.prepare(
      "INSERT OR IGNORE INTO rooms (code, state, revision, is_public, phase, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(room.code, JSON.stringify(room), room.revision, Number(room.isPublic), room.phase, room.updatedAt).run();
    return result.meta.changes === 1;
  }

  async mutate(
    code: string,
    update: (room: RoomState) => RoomState,
  ): Promise<RoomState> {
    return mutateRoom(code, update, (roomCode) => this.get(roomCode), async (previous, next) => {
      const result = next.players.length === 0
        ? await this.database.prepare("DELETE FROM rooms WHERE code = ? AND revision = ?")
          .bind(code, previous.revision).run()
        : await this.database.prepare(
          "UPDATE rooms SET state = ?, revision = ?, is_public = ?, phase = ?, updated_at = ? WHERE code = ? AND revision = ?",
        ).bind(
          JSON.stringify(next), next.revision, Number(next.isPublic), next.phase, next.updatedAt,
          code, previous.revision,
        ).run();
      return result.meta.changes === 1;
    });
  }

  async listPublic(now: number): Promise<PublicRoom[]> {
    const result = await this.database.prepare(
      "SELECT state, revision FROM rooms WHERE is_public = 1 AND phase = 'lobby' AND updated_at > ? ORDER BY updated_at DESC LIMIT 60",
    ).bind(now - 60 * 60 * 1000).all<RoomRow>();
    return result.results.flatMap((row) => {
      const room = JSON.parse(row.state) as RoomState;
      if (room.players.length === 0 || room.players.length >= room.settings.maxPlayers) {
        return [];
      }
      const host = room.players.find((player) => player.id === room.hostId);
      return [{
        code: room.code,
        hostName: host?.name ?? "Player",
        mode: room.settings.mode,
        category: room.settings.category,
        players: room.players.length,
        maxPlayers: room.settings.maxPlayers,
      }];
    });
  }
}
