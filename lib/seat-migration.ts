import type { Session } from "./types";

export const LEGACY_GAME_ORIGIN = "https://feud-night-nimz.boundlessnova2.chatgpt.site";
const PERSONAL_SITE_ORIGINS = ["https://www.nimalp123.com", "https://nimalp123.com"];

export function migrationParentOrigin(referrer: string): string | null {
  try {
    const origin = new URL(referrer).origin;
    return PERSONAL_SITE_ORIGINS.includes(origin) ? origin : null;
  } catch {
    return null;
  }
}

export function isLegacySeatMigration(origin: string, search: string): boolean {
  return origin === LEGACY_GAME_ORIGIN && new URLSearchParams(search).get("seat_migration") === "1";
}

export function migrationSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const seat = value as Partial<Session>;
  if (typeof seat.code !== "string" || !/^[A-Z0-9]{6}$/.test(seat.code)
    || typeof seat.playerId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(seat.playerId)
    || typeof seat.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(seat.token)) return null;
  return { code: seat.code, playerId: seat.playerId, token: seat.token };
}

export function receivedMigrationSession(
  event: Pick<MessageEvent, "source" | "origin" | "data">,
  parent: MessageEventSource,
  requestedCode: string | null,
  currentSession: Session | null,
): Session | null {
  if (event.source !== parent || !PERSONAL_SITE_ORIGINS.includes(event.origin) || currentSession) return null;
  if (!event.data || typeof event.data !== "object" || event.data.type !== "feud:restore-seat") return null;
  const seat = migrationSession(event.data.session);
  return seat && (!requestedCode || seat.code === requestedCode) ? seat : null;
}
