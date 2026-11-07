import assert from "node:assert/strict";
import test from "node:test";
import {
  isLegacySeatMigration,
  LEGACY_GAME_ORIGIN,
  migrationParentOrigin,
  migrationSession,
  receivedMigrationSession,
} from "../lib/seat-migration.ts";
import type { Session } from "../lib/types.ts";

const seat: Session = { code: "ABCDEF", playerId: "95daa33b-4d3c-4fb5-b1df-46549817cd1b", token: "A".repeat(43) };
const parent = {} as Window;
const event = { source: parent, origin: "https://www.nimalp123.com", data: { type: "feud:restore-seat", session: seat } };

test("the legacy bridge activates only on the old game origin with its explicit flag", () => {
  assert.equal(isLegacySeatMigration(LEGACY_GAME_ORIGIN, "?seat_migration=1&room=ABCDEF"), true);
  assert.equal(isLegacySeatMigration(LEGACY_GAME_ORIGIN, "?room=ABCDEF"), false);
  assert.equal(isLegacySeatMigration(LEGACY_GAME_ORIGIN, "?seat_migration=0"), false);
  assert.equal(isLegacySeatMigration("https://feud.example.org", "?seat_migration=1"), false);
});

test("migration parent discovery accepts only the two HTTPS personal-site origins", () => {
  assert.equal(migrationParentOrigin("https://www.nimalp123.com/feud?room=ABCDEF"), event.origin);
  assert.equal(migrationParentOrigin("https://nimalp123.com/"), "https://nimalp123.com");
  for (const referrer of ["", "http://www.nimalp123.com/feud", "https://www.nimalp123.com.example.org/feud", "https://www.nimalp123.com@attacker.example/"]) {
    assert.equal(migrationParentOrigin(referrer), null);
  }
});

test("transferred seats require valid code, player ID, and bearer token and discard extra properties", () => {
  assert.deepEqual(migrationSession({ ...seat, extra: "discard" }), seat);
  for (const value of [null, [], {}, { ...seat, code: "abcdef" }, { ...seat, code: "ABCDEF7" }, { ...seat, playerId: "" }, { ...seat, playerId: " ".repeat(12) }, { ...seat, playerId: "a".repeat(81) }, { ...seat, token: "A".repeat(42) }, { ...seat, token: "+".repeat(43) }]) {
    assert.equal(migrationSession(value), null);
  }
});

test("only the actual trusted parent can transfer a requested seat", () => {
  assert.deepEqual(receivedMigrationSession(event, parent, seat.code, null), seat);
  assert.deepEqual(receivedMigrationSession({ ...event, origin: "https://nimalp123.com" }, parent, null, null), seat);
  assert.equal(receivedMigrationSession({ ...event, source: {} as Window }, parent, seat.code, null), null);
  assert.equal(receivedMigrationSession({ ...event, origin: LEGACY_GAME_ORIGIN }, parent, seat.code, null), null);
  assert.equal(receivedMigrationSession({ ...event, origin: "https://www.nimalp123.com/feud" }, parent, seat.code, null), null);
  assert.equal(receivedMigrationSession(event, parent, "UVWXYZ", null), null);
  assert.equal(receivedMigrationSession({ ...event, data: { type: "feud:legacy-seat", session: seat } }, parent, seat.code, null), null);
});

test("a migration message preserves an existing seat even when its requested code matches", () => {
  assert.equal(receivedMigrationSession(event, parent, seat.code, { ...seat, token: "B".repeat(43) }), null);
  assert.equal(receivedMigrationSession({ ...event, data: { type: "feud:restore-seat", session: { ...seat, token: "bad" } } }, parent, seat.code, null), null);
});
