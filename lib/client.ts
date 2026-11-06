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

export function readSession(): Session | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return data && /^[A-Z0-9]{6}$/.test(data.code) && typeof data.playerId === "string" && typeof data.token === "string" ? data : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The current tab can still play if browser storage is unavailable.
  }
}
