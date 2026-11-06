import "server-only";
import { createAdminClient } from "@insforge/sdk";
import { mutateRoom, RoomStorageError } from "./storage.ts";
import type { GameBackend, PublicRoom, RoomRepository, RoomState, StoredQuestion } from "./types.ts";

function checkDatabaseError(error: unknown): void {
  if (error) throw new RoomStorageError("The game database could not be reached. Please try again.", 503);
}

/** The admin client stays on the server. Players only receive sanitized RoomViews. */
export function createInsforgeBackend(baseUrl: string, apiKey: string): GameBackend {
  const client = createAdminClient({ baseUrl, apiKey });

  async function saveRoom(previous: RoomState, next: RoomState): Promise<boolean> {
    const { data, error } = await client.database.rpc("feud_compare_and_set_room", {
      p_code: previous.code,
      p_expected_revision: previous.revision,
      p_state: next,
    });
    checkDatabaseError(error);
    return data === true;
  }

  const rooms: RoomRepository = {
    async consumeRateLimit(scope, key, limit, windowMs, now) {
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const { data, error } = await client.database.rpc("feud_consume_rate_limit", {
        p_scope: scope,
        p_key: key,
        p_window_start: windowStart,
        p_expires_at: windowStart + windowMs,
      });
      checkDatabaseError(error);
      if (typeof data !== "number" || !Number.isSafeInteger(data)) {
        throw new RoomStorageError("The game database returned an invalid rate limit.", 503);
      }
      if (data > limit) {
        throw new RoomStorageError("Too many requests. Please wait a little and try again.", 429);
      }
    },

    async get(code) {
      const { data, error } = await client.database.from("rooms")
        .select("state, revision").eq("code", code).maybeSingle();
      checkDatabaseError(error);
      if (!data) throw new RoomStorageError("That room could not be found. Check the code and try again.", 404);
      const room = structuredClone(data.state) as RoomState;
      room.revision = data.revision;
      return room;
    },

    async create(room) {
      const { data, error } = await client.database.rpc("feud_create_room", {
        p_code: room.code,
        p_state: room,
      });
      checkDatabaseError(error);
      return data === true;
    },

    mutate(code, update) {
      return mutateRoom(code, update, rooms.get, saveRoom);
    },

    async listPublic(now) {
      const { data, error } = await client.database.rpc("feud_list_public_rooms", {
        p_since: now - 60 * 60 * 1000,
      });
      checkDatabaseError(error);
      return (data ?? []) as PublicRoom[];
    },
  };

  return {
    rooms,
    async countQuestions() {
      const { count, error } = await client.database.from("question_bank")
        .select("id", { count: "exact", head: true });
      checkDatabaseError(error);
      return count ?? 0;
    },
    async sampleQuestions(category, excludedIds, limit) {
      const { data, error } = await client.database.rpc("feud_sample_questions", {
        p_category: category,
        p_excluded_ids: excludedIds,
        p_limit: limit,
      });
      checkDatabaseError(error);
      return (data ?? []) as StoredQuestion[];
    },
  };
}
