"use client";

import { useEffect } from "react";
import { readSession, requestedRoom } from "../lib/client";
import { isLegacySeatMigration, migrationParentOrigin, migrationSession } from "../lib/seat-migration";

export default function LegacySeatBridge() {
  useEffect(() => {
    const parentOrigin = migrationParentOrigin(document.referrer);
    if (window.parent === window || !parentOrigin || !isLegacySeatMigration(window.location.origin, window.location.search)) return;
    const code = requestedRoom(window.location.search);
    const saved = migrationSession(readSession(code));
    const session = saved && (!code || saved.code === code) ? saved : null;
    window.parent.postMessage({ type: "feud:legacy-seat", session }, parentOrigin);
  }, []);

  return null;
}
