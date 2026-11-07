const ROOM_BASE_URLS = new Set([
  "https://www.nimalp123.com/feud",
  "https://www.nimalp123.com/s-feud",
]);

export function validateRoomBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!ROOM_BASE_URLS.has(value)) {
    throw new Error("NEXT_PUBLIC_ROOM_BASE_URL must name the production or staging game page.");
  }
  return value;
}
