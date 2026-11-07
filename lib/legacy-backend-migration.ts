import { createAdminClient } from "@insforge/sdk";

export interface LegacyMigrationEnvironment {
  DB?: D1Database;
  FEUD_MAINTENANCE?: string;
  FEUD_MIGRATION_TOKEN?: string;
  INSFORGE_URL?: string;
  INSFORGE_API_KEY?: string;
}

export interface MigrationRoomRow {
  code: string;
  state: Record<string, unknown>;
  revision: number;
  is_public: boolean;
  phase: string;
  updated_at: number;
}

export interface MigrationTarget {
  read(codes: string[]): Promise<unknown[]>;
  insert(rows: MigrationRoomRow[]): Promise<void>;
}

const COLUMNS = "code, state, revision, is_public, phase, updated_at";
const PHASES = new Set(["lobby", "generating", "playing", "round-ended", "finished"]);

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function tokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !/^[A-Za-z0-9_-]{43}$/.test(expected) || !provided || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  return difference === 0;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid room object");
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  const result = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) throw new Error("Invalid room integer");
  return result;
}

function normalizeRow(input: unknown, useAuthoritativeRevision = false): MigrationRoomRow {
  const row = object(input);
  const state = object(typeof row.state === "string" ? JSON.parse(row.state) : row.state);
  const revision = integer(row.revision);
  const updatedAt = integer(row.updated_at);
  const isPublic = row.is_public === true || row.is_public === 1;
  if (typeof row.code !== "string" || !/^[A-Z0-9]{6}$/.test(row.code) || state.code !== row.code
      || revision > 2_147_483_647 || typeof row.phase !== "string" || !PHASES.has(row.phase)
      || state.phase !== row.phase || (!useAuthoritativeRevision && state.revision !== revision)
      || ![true, false, 0, 1].includes(row.is_public as boolean | number)
      || state.isPublic !== isPublic || integer(state.updatedAt) !== updatedAt || !Array.isArray(state.players)) {
    throw new Error("Inconsistent room metadata");
  }
  integer(state.createdAt);
  for (const entry of state.players) {
    const player = object(entry);
    if (typeof player.id !== "string" || typeof player.tokenHash !== "string" || typeof player.name !== "string") {
      throw new Error("Invalid player state");
    }
    integer(player.score);
  }
  return { code: row.code, state: { ...state, revision }, revision, is_public: isPublic, phase: row.phase, updated_at: updatedAt };
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortedJson(child)]));
  }
  return value;
}

function canonical(rows: MigrationRoomRow[]): string {
  return JSON.stringify(sortedJson([...rows].sort((left, right) => left.code.localeCompare(right.code))));
}

function targetRepository(baseUrl: string, apiKey: string): MigrationTarget {
  const client = createAdminClient({ baseUrl, apiKey });
  return {
    async read(codes) {
      const { data, error } = await client.database.from("rooms").select(COLUMNS).in("code", codes);
      if (error || !Array.isArray(data)) throw new Error("Target read failed");
      return data;
    },
    async insert(rows) {
      // A plain batch INSERT is one atomic statement and never replaces a row.
      const { error } = await client.database.from("rooms").insert(rows);
      if (error) throw new Error("Target insert failed");
    },
  };
}

/** Copy a frozen legacy snapshot without returning any room or player data. */
export async function handleLegacyBackendMigration(
  request: Request,
  environment: LegacyMigrationEnvironment,
  createTarget: (baseUrl: string, apiKey: string) => MigrationTarget = targetRepository,
): Promise<Response> {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/api/migrate-backend"
      || environment.FEUD_MAINTENANCE !== "1" || !environment.DB
      || !environment.INSFORGE_URL || !environment.INSFORGE_API_KEY
      || !tokenMatches(request.headers.get("x-feud-migration-token"), environment.FEUD_MIGRATION_TOKEN)) {
    return reply({ error: "Not found." }, 404);
  }
  const database = environment.DB;
  async function sourceRows(): Promise<MigrationRoomRow[]> {
    const result = await database.prepare(`SELECT ${COLUMNS} FROM rooms ORDER BY code`).all();
    if (!result.success || !Array.isArray(result.results)) throw new Error("Source read failed");
    const rows = result.results.map((row) => normalizeRow(row, true));
    if (new Set(rows.map((row) => row.code)).size !== rows.length) throw new Error("Duplicate source room");
    return rows;
  }
  try {
    const source = await sourceRows();
    const snapshot = canonical(source);
    let missing: MigrationRoomRow[] = [];
    if (source.length) {
      const target = createTarget(environment.INSFORGE_URL, environment.INSFORGE_API_KEY);
      const codes = source.map((row) => row.code);
      const existing = (await target.read(codes)).map((row) => normalizeRow(row));
      const sourceByCode = new Map(source.map((row) => [row.code, row]));
      if (existing.some((row) => !sourceByCode.has(row.code) || canonical([row]) !== canonical([sourceByCode.get(row.code)!]))) {
        return reply({ error: "Migration stopped because the target contains different room data." }, 409);
      }
      const existingCodes = new Set(existing.map((row) => row.code));
      missing = source.filter((row) => !existingCodes.has(row.code));
      if (missing.length) await target.insert(missing);
      const verified = (await target.read(codes)).map((row) => normalizeRow(row));
      if (canonical(verified) !== snapshot) return reply({ error: "Migration verification failed." }, 409);
    }
    if (canonical(await sourceRows()) !== snapshot) {
      return reply({ error: "Migration stopped because the source changed during verification." }, 409);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
    const players = source.flatMap((row) => row.state.players as Array<Record<string, unknown>>);
    return reply({ ok: true, rooms: source.length, imported: missing.length, verified: source.length,
      players: players.length, totalScore: players.reduce((sum, player) => sum + integer(player.score), 0),
      digest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") }, 200);
  } catch {
    return reply({ error: "Migration could not be completed safely." }, 503);
  }
}
