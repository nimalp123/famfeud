import type { ApiSessionResponse, ClientAction, PublicRoom, RoomSettings, RoomView, Session } from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, session?: Session): Promise<T> {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
  });
  const data: unknown = await response.json().catch(() => ({ error: "The server could not be reached. Try again." }));
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : "Something went wrong. Try again.";
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; questionCount: number }>("/api/health"),
  publicRooms: () => request<{ rooms: PublicRoom[] }>("/api/rooms"),
  create: (name: string, avatar: number, settings: RoomSettings) =>
    request<ApiSessionResponse>("/api/rooms", { method: "POST", body: JSON.stringify({ name, avatar, settings }) }),
  join: (code: string, name: string, avatar: number) =>
    request<ApiSessionResponse>(`/api/rooms/${encodeURIComponent(code.toUpperCase())}/join`, {
      method: "POST", body: JSON.stringify({ name, avatar }),
    }),
  room: (session: Session, signal?: AbortSignal) =>
    request<{ room: RoomView }>(`/api/rooms/${session.code}`, { signal }, session),
  action: (session: Session, action: ClientAction) =>
    request<{ room: RoomView }>(`/api/rooms/${session.code}/action`, {
      method: "POST", body: JSON.stringify({ action }),
    }, session),
};

const SESSION_KEY = "feud-night-session";
const ROOM_SEAT_PREFIX = "feud-night-seat:";

export function requestedRoom(search: string): string | null {
  const code = new URLSearchParams(search).get("room")?.toUpperCase() ?? "";
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export function roomLink(code: string, gameOrigin: string, frameReferrer = ""): string {
  const parentOrigin = frameReferrer.match(/^(https:\/\/(?:www\.)?nimalp123\.com)(?:\/|$)/)?.[1];
  const url = gameOrigin === "https://feud-night-nimz.boundlessnova2.chatgpt.site" && parentOrigin
    ? new URL("/feud", parentOrigin)
    : new URL("/", gameOrigin);
  url.searchParams.set("room", code);
  return url.href;
}

function readStoredSession(storage: "localStorage" | "sessionStorage", key: string): Session | null {
  try {
    const data = JSON.parse(window[storage].getItem(key) ?? "null");
    return data && typeof data.code === "string" && /^[A-Z0-9]{6}$/.test(data.code)
      && typeof data.playerId === "string" && typeof data.token === "string"
      && /^[A-Za-z0-9_-]{43}$/.test(data.token) ? data : null;
  } catch {
    return null;
  }
}

export function readSession(code?: string | null): Session | null {
  const active = readStoredSession("sessionStorage", SESSION_KEY);
  if (!code || active?.code === code) return active;
  const saved = readStoredSession("localStorage", ROOM_SEAT_PREFIX + code);
  return saved?.code === code ? saved : null;
}

function writeSession(storage: "localStorage" | "sessionStorage", key: string, session: Session) {
  try {
    window[storage].setItem(key, JSON.stringify(session));
  } catch {
    // The current tab can still play if browser storage is unavailable.
  }
}

export function saveSession(session: Session) {
  writeSession("sessionStorage", SESSION_KEY, session);
  writeSession("localStorage", ROOM_SEAT_PREFIX + session.code, session);
}

export function clearSession(session: Session, forgetSeat = true) {
  // Another tab may already have replaced an expired credential with a new seat.
  const entries = [["sessionStorage", SESSION_KEY], ["localStorage", ROOM_SEAT_PREFIX + session.code]] as const;
  for (const [storage, key] of forgetSeat ? entries : entries.slice(0, 1)) {
    try {
      const stored = readStoredSession(storage, key);
      if (stored?.code === session.code && stored.token === session.token) window[storage].removeItem(key);
    } catch {
      // The tab can still leave when browser storage is unavailable.
    }
  }
}
