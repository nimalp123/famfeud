"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Radio, ArrowUpRight, WifiOff } from "lucide-react";
import { api, ApiError, clearSession, readSession, requestedRoom, saveSession } from "../lib/client";
import { QUESTION_BANK_COUNT } from "../lib/constants";
import { isLegacySeatMigration, migrationParentOrigin, receivedMigrationSession } from "../lib/seat-migration";
import type { ApiSessionResponse, ClientAction, PublicRoom, RoomSettings, RoomView, Session } from "../lib/types";
import HomeScreen from "./HomeScreen";
import LobbyScreen from "./LobbyScreen";
import MatchScreen from "./MatchScreen";
import ResultsScreen from "./ResultsScreen";
import LegacySeatBridge from "./LegacySeatBridge";

function setRoomInAddress(code: string | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  window.history.replaceState(window.history.state, "", url);
}

export default function GameApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [questionCount, setQuestionCount] = useState(QUESTION_BANK_COUNT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [legacyBridge, setLegacyBridge] = useState(false);
  const currentSession = useRef<Session | null>(null);

  useEffect(() => {
    currentSession.current = session;
  }, [session]);

  const updateRoom = useCallback((next: RoomView) => {
    setRoom((previous) => !previous || previous.code !== next.code || next.revision >= previous.revision ? next : previous);
  }, []);

  useEffect(() => {
    if (isLegacySeatMigration(window.location.origin, window.location.search)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Origin and saved seats are available only after browser hydration.
      setLegacyBridge(true);
      return;
    }
    setSession(readSession(requestedRoom(window.location.search)));
    setInitialized(true);
    api.health().then((data) => setQuestionCount(data.questionCount)).catch(() => {});
  }, []);

  useEffect(() => {
    const parentOrigin = migrationParentOrigin(document.referrer);
    if (!initialized || window.parent === window || !parentOrigin) return;
    const receiveSeat = (event: MessageEvent) => {
      const restored = receivedMigrationSession(event, window.parent, requestedRoom(window.location.search), currentSession.current);
      if (!restored) return;
      currentSession.current = restored;
      setSession(restored);
      setError(null);
      setConnectionLost(false);
      window.parent.postMessage({ type: "feud:seat-received", code: restored.code }, parentOrigin);
    };
    window.addEventListener("message", receiveSeat);
    window.parent.postMessage({ type: "feud:seat-ready" }, parentOrigin);
    return () => window.removeEventListener("message", receiveSeat);
  }, [initialized, session]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [room?.phase]);

  useEffect(() => {
    if (!initialized || session) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const data = await api.publicRooms();
        if (!stopped) setPublicRooms(data.rooms);
      } catch {
        // Creating and joining still surface their specific server errors.
      }
    };
    void refresh();
    const timer = setInterval(refresh, 7500);
    return () => { stopped = true; clearInterval(timer); };
  }, [session, initialized]);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let seatVerified = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const refresh = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const data = await api.room(session, controller.signal);
        if (stopped) return;
        if (!seatVerified) {
          saveSession(session);
          setRoomInAddress(session.code);
          seatVerified = true;
        }
        updateRoom(data.room);
        setConnectionLost(false);
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || cause.status === 404 || cause.status === 410)) {
          clearSession(session);
          setSession(null);
          setRoom(null);
          setConnectionLost(false);
          setError(cause.status === 401 ? "Your saved seat is no longer available. Check with the host before joining again." : cause.message);
          return;
        }
        setConnectionLost(true);
      } finally {
        clearTimeout(timeout);
      }
      if (!stopped) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); };
  }, [session, updateRoom]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Try again."); }
    finally { setBusy(false); }
  }

  function enter(data: ApiSessionResponse) {
    saveSession(data.session); setSession(data.session); setRoom(data.room); setConnectionLost(false);
    setRoomInAddress(data.session.code);
  }

  const onCreate = (name: string, avatar: number, settings: RoomSettings) => run(async () => enter(await api.create(name, avatar, settings)));
  const onJoin = (code: string, name: string, avatar: number) => run(async () => {
    const saved = readSession(code);
    if (saved) {
      setRoomInAddress(saved.code);
      setSession(saved);
      return;
    }
    if (name.trim()) enter(await api.join(code, name, avatar));
  });
  const onAction = (action: ClientAction) => run(async () => {
    if (!session) return;
    const data = await api.action(session, action);
    if (currentSession.current?.token === session.token) updateRoom(data.room);
  });
  const onLeave = () => run(async () => {
    if (session) {
      try { await api.action(session, { type: "leave" }); } catch { /* Leaving the tab remains possible while offline. */ }
      clearSession(session);
    }
    setRoomInAddress(null);
    setSession(null); setRoom(null); setConnectionLost(false);
  });
  const returnHomeWhileOffline = () => {
    if (session) clearSession(session, false);
    setRoomInAddress(null);
    setSession(null); setRoom(null); setConnectionLost(false);
  };

  if (legacyBridge) return <LegacySeatBridge />;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Feud Night home" onClick={(event) => { if (session) event.preventDefault(); }}>
          <span className="brand-mark"><Sparkles size={24} strokeWidth={2.4} /></span>
          <span>FEUD<span className="brand-light">NIGHT</span><span className="brand-dot">✦</span></span>
        </a>
        <div className="header-right">
          <span className="nav-chip"><Radio size={14} /> Live multiplayer</span>
          <a href="#public-heading" className="header-link" onClick={(event) => { if (session) event.preventDefault(); }}>Made for game night <ArrowUpRight size={15} /></a>
        </div>
      </header>
      {connectionLost && <div className="connection-banner" role="status"><WifiOff size={16} /> Reconnecting to your room…</div>}
      {!initialized || (session && !room) ? (
        <main className="loading-screen" aria-live="polite"><div className="loading-orbit">✦</div><h1>Finding your seat…</h1><p>{connectionLost ? "Waiting for the game server to reconnect." : "Getting the board ready."}</p>{connectionLost && <button className="button button-secondary" onClick={returnHomeWhileOffline}>Back to home</button>}</main>
      ) : session && room ? room.phase === "lobby" ? (
        <LobbyScreen {...{ room, session, onAction, onLeave, busy, error }} />
      ) : room.phase === "finished" ? (
        <ResultsScreen {...{ room, session, onAction, onLeave, busy, error }} />
      ) : (
        <MatchScreen {...{ room, session, onAction, onLeave, busy, error }} />
      ) : (
        <HomeScreen {...{ onCreate, onJoin, publicRooms, busy, error, questionCount }} />
      )}
      <footer className="site-footer"><span>Good company. Questionable guesses.</span><span>Fresh boards. Real rivalries. <span aria-hidden="true">✦</span></span></footer>
    </div>
  );
}
