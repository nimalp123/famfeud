import assert from "node:assert/strict";
import test from "node:test";
import { clearSession, readSession, requestedRoom, roomLink, saveSession } from "../lib/client.ts";
import type { Session } from "../lib/types.ts";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  };
}

const seat: Session = { code: "ABCDEF", playerId: "player1", token: "A".repeat(43) };
const secondSeat: Session = { code: "BCDEFG", playerId: "player2", token: "B".repeat(43) };
const gameOrigin = "https://feud-night-nimz.boundlessnova2.chatgpt.site";

test("a room link names only the room and keeps the verified embed's site", () => {
  assert.equal(roomLink(seat.code, gameOrigin, "https://www.nimalp123.com/"), "https://www.nimalp123.com/feud?room=ABCDEF");
  assert.equal(roomLink(seat.code, gameOrigin, "https://nimalp123.com/feud"), "https://nimalp123.com/feud?room=ABCDEF");
  assert.equal(roomLink(seat.code, gameOrigin, "https://nimalp123.com.example.org/feud"), gameOrigin + "/?room=ABCDEF");
  assert.equal(roomLink(seat.code, "http://localhost:3000"), "http://localhost:3000/?room=ABCDEF");
  assert.equal(requestedRoom("?room=abcdef"), seat.code);
  assert.equal(requestedRoom("?room=ABCDEFtooLong"), null);
});

test("a new tab can recover the same seat by code after the old tab closes", (context) => {
  const browser = { sessionStorage: memoryStorage(), localStorage: memoryStorage() };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  context.after(() => Reflect.deleteProperty(globalThis, "window"));

  saveSession(seat);
  assert.deepEqual(readSession(), seat);
  browser.sessionStorage = memoryStorage();
  assert.equal(readSession(), null);
  assert.deepEqual(readSession(requestedRoom("?room=abcdef")), seat);

  saveSession(secondSeat);
  assert.deepEqual(readSession(), secondSeat);
  assert.deepEqual(readSession(seat.code), seat);
  assert.equal(readSession("CCCCCC"), null);
});

test("backing out keeps the saved seat, while leaving or rejection forgets it", (context) => {
  const browser = { sessionStorage: memoryStorage(), localStorage: memoryStorage() };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  context.after(() => Reflect.deleteProperty(globalThis, "window"));

  saveSession(seat);
  clearSession(seat, false);
  assert.equal(readSession(), null);
  assert.deepEqual(readSession(seat.code), seat);

  saveSession(seat);
  clearSession(seat);
  assert.equal(readSession(), null);
  assert.equal(readSession(seat.code), null);

  const replacement = { ...seat, playerId: secondSeat.playerId, token: secondSeat.token };
  saveSession(replacement);
  clearSession(seat);
  assert.deepEqual(readSession(seat.code), replacement);
});
