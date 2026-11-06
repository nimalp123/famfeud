"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Radio, ArrowUpRight, WifiOff } from "lucide-react";
import { api, ApiError, readSession, saveSession } from "../lib/client";
import { QUESTION_BANK_COUNT } from "../lib/constants";
import type { ApiSessionResponse, ClientAction, PublicRoom, RoomSettings, RoomView, Session } from "../lib/types";
import HomeScreen from "./HomeScreen";
import LobbyScreen from "./LobbyScreen";
import MatchScreen from "./MatchScreen";
import ResultsScreen from "./ResultsScreen";

export default function GameApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [questionCount, setQuestionCount] = useState(QUESTION_BANK_COUNT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const currentSession = useRef<Session | null>(null);
  currentSession.current = session;

  const updateRoom = useCallback((next: RoomView) => {
    setRoom((previous) => !previous || previous.code !== next.code || next.revision >= previous.revision ? next : previous);
  }, []);

  useEffect(() => {
    setSession(readSession());
    setInitialized(true);
    api.health().then((data) => setQuestionCount(data.questionCount)).catch(() => {});
  }, []);

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
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const data = await api.room(session, controller.signal);
        if (!stopped) { updateRoom(data.room); setConnectionLost(false); }
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || cause.status === 404 || cause.status === 410)) {
          saveSession(null); setSession(null); setRoom(null); setError(cause.message);
          return;
        }
        setConnectionLost(true);
      }
      if (!stopped) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
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
    const url = new URL(window.location.href); url.searchParams.delete("room");
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  const onCreate = (name: string, avatar: number, settings: RoomSettings) => run(async () => enter(await api.create(name, avatar, settings)));
  const onJoin = (code: string, name: string, avatar: number) => run(async () => enter(await api.join(code, name, avatar)));
  const onAction = (action: ClientAction) => run(async () => {
    if (!session) return;
    const data = await api.action(session, action);
    if (currentSession.current?.token === session.token) updateRoom(data.room);
  });
  const onLeave = () => run(async () => {
    if (session) {
      try { await api.action(session, { type: "leave" }); } catch { /* Leaving the tab remains possible while offline. */ }
    }
    saveSession(null); setSession(null); setRoom(null); setConnectionLost(false);
  });

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
      {connectionLost && <div className="connection-banner" role="status"><WifiOff size={16} /> Reconnecting to your room. Your place is saved.</div>}
      {!initialized || (session && !room) ? (
        <main className="loading-screen" aria-live="polite"><div className="loading-orbit">✦</div><h1>Finding your seat…</h1><p>{connectionLost ? "Waiting for the game server to reconnect." : "Getting the board ready."}</p>{connectionLost && <button className="button button-secondary" onClick={onLeave}>Back to home</button>}</main>
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
