"use client";

import { useState } from "react";
import { ArrowRight, Check, Copy, Crown, Globe2, LockKeyhole, LogOut, Sparkles, Users, X, Zap } from "lucide-react";
import type { ClientAction, PlayerView, RoomSettings, RoomView, Session, Team } from "@/lib/types";
import { PLAYER_AVATARS, QUESTION_CATEGORIES } from "@/lib/constants";
import RoomLinkButton from "./RoomLinkButton";

interface LobbyScreenProps {
  room: RoomView;
  session: Session;
  onAction: (action: ClientAction) => Promise<void>;
  onLeave: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

export default function LobbyScreen({ room, session, onAction, onLeave, busy, error }: LobbyScreenProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const me = room.players.find((player) => player.id === session.playerId);
  const isHost = room.hostId === session.playerId;
  const generating = room.phase === "generating";
  const blue = room.players.filter((player) => player.team === 0);
  const coral = room.players.filter((player) => player.team === 1);
  const allReady = room.players.every((player) => player.ready);
  const validTeams = room.settings.mode !== "teams" || (blue.length > 0 && coral.length > 0 && Math.abs(blue.length - coral.length) <= 1);
  const canStart = room.players.length >= 2 && allReady && validTeams;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopyError(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyError("Couldn’t copy automatically. You can select and share the lobby code above.");
    }
  }

  function changeSettings(settings: Partial<RoomSettings>) {
    void onAction({ type: "settings", settings });
  }

  function playerRow(player: PlayerView) {
    return <div key={player.id} className={`lobby-player ${player.id === session.playerId ? "lobby-player-self" : ""}`}>
      <span className={`avatar avatar-${player.avatar}`} aria-hidden="true">{PLAYER_AVATARS[player.avatar % PLAYER_AVATARS.length]}</span>
      <div className="lobby-player-info"><strong>{player.name}{player.id === session.playerId && <small>YOU</small>}{player.id === room.hostId && <Crown size={13} aria-label="Host" />}</strong><span>{player.connected ? "In the lobby" : "Reconnecting…"}</span></div>
      <span className={`lobby-ready-pill ${player.ready ? "is-ready" : ""}`}>{player.ready ? <><Check size={12} /> Ready</> : "Getting ready"}</span>
      {isHost && player.id !== session.playerId && <button className="lobby-kick" type="button" disabled={busy || generating} onClick={() => void onAction({ type: "kick", playerId: player.id })} aria-label={`Remove ${player.name} from lobby`} title={`Remove ${player.name}`}><X size={15} /></button>}
    </div>;
  }

  function teamColumn(team: Team, players: PlayerView[], name: string) {
    const slots = Math.max(1, Math.ceil(room.settings.maxPlayers / 2) - players.length);
    return <div className={`lobby-team lobby-team-${team}`}><div className="lobby-team-heading"><h3>{name}</h3><span>{players.length} {players.length === 1 ? "player" : "players"}</span></div><div className="lobby-player-list">{players.map(playerRow)}{Array.from({ length: Math.min(slots, 3) }, (_, index) => <div className="lobby-empty-seat" key={`empty-${index}`}><span className="lobby-empty-avatar">+</span><span>Waiting for a teammate</span></div>)}</div><button className="button button-secondary lobby-join-team" type="button" disabled={busy || generating || me?.team === team} onClick={() => void onAction({ type: "team", team })}>{me?.team === team ? <><Check size={15} /> Your team</> : `Join ${name}`}</button></div>;
  }

  let startHint = "Everyone’s ready. Let’s see those guesses.";
  if (room.players.length < 2) startHint = "Invite at least one more player to start.";
  else if (!validTeams) startHint = "Give both teams a player and keep the teams balanced.";
  else if (!allReady) startHint = "Waiting for everyone to ready up.";

  const startPanel = (
    <div className={`lobby-start-panel ${generating ? "is-generating" : ""}`}>
      <div>
        {generating ? <Sparkles size={24} className="lobby-generating-icon" /> : <Zap size={24} />}
        <span>
          <strong>{generating ? "Getting your game ready…" : isHost ? "All eyes on you, host." : "The host will kick things off."}</strong>
          <small>{generating ? "Your questions and answer boards are on their way." : startHint}</small>
        </span>
      </div>
      {isHost && (
        <button className="button button-primary" type="button" disabled={busy || generating || !canStart} onClick={() => void onAction({ type: "start" })}>
          {generating ? "Getting ready…" : "Start the showdown"}<ArrowRight size={19} />
        </button>
      )}
    </div>
  );

  return <main className="lobby-page">
    <div className="lobby-page-heading"><div><div className="lobby-eyebrow"><span className="home-live-dot" /> PRE-GAME HANGOUT</div><h1>Your people. Your showdown.</h1><p>{generating ? "Picking questions from the bank…" : "Claim a seat, warm up your guesses, and get everyone ready."}</p></div><button className="button button-ghost lobby-leave" type="button" onClick={() => void onLeave()} disabled={busy || generating}><LogOut size={16} /> Leave lobby</button></div>

    <div className="lobby-layout">
      <div className="lobby-main-column">
        <section className="lobby-invite panel" aria-labelledby="lobby-invite-heading">
          <div className="lobby-invite-top">
            <div><span className="lobby-label">THE SECRET HANDSHAKE</span><h2 id="lobby-invite-heading">Share your lobby code.</h2></div>
            <span className="badge">{room.isPublic ? <><Globe2 size={13} /> PUBLIC LOBBY</> : <><LockKeyhole size={13} /> FRIENDS ONLY</>}</span>
          </div>
          <div className="lobby-code-row">
            <span className="lobby-code" aria-label={`Lobby code ${room.code}`}>{room.code}</span>
            <button className="button button-secondary" onClick={() => void copyCode()} type="button">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied!" : "Copy code"}</button>
            <RoomLinkButton code={room.code} className="button button-secondary lobby-copy-link" />
          </div>
          <p>Share the link or code to invite friends. If you disconnect, reopen the link in the same browser to find your seat.</p>
          {copyError && <p className="lobby-copy-error" role="status">{copyError}</p>}
        </section>

        {(error || room.error) && <div className="lobby-error" role="alert">{error || room.error}</div>}
        {isHost && startPanel}

        <section className="lobby-players-section panel" aria-labelledby="lobby-players-heading"><div className="lobby-section-header"><h2 id="lobby-players-heading"><Users size={20} /> The competition</h2><span>{room.players.length}<span className="lobby-count-muted"> / {room.settings.maxPlayers} players</span></span></div>
          <div className="lobby-ready-actions"><div><strong>{me?.ready ? "You’re all set." : "Ready to play?"}</strong><p>{me?.ready ? "Your best guesses are about to get their moment." : "Let everyone know you’re good to go."}</p></div><button className={`button ${me?.ready ? "button-secondary" : "button-primary"}`} type="button" disabled={busy || generating || !me} onClick={() => void onAction({ type: "ready", ready: !me?.ready })}>{me?.ready ? <><Check size={17} /> I’m ready</> : "Ready up"}</button></div>
          {room.settings.mode === "teams" ? <div className="lobby-team-grid">{teamColumn(0, blue, "Blue team")}{teamColumn(1, coral, "Orange team")}</div> : <div className="lobby-player-list">{room.players.map(playerRow)}{Array.from({ length: Math.max(0, Math.min(room.settings.maxPlayers - room.players.length, 4)) }, (_, index) => <div className="lobby-empty-seat" key={index}><span className="lobby-empty-avatar">+</span><span>Your next rival could be here</span></div>)}</div>}
        </section>

        {!isHost && startPanel}
      </div>

      <aside className="lobby-sidebar">
        <section className="lobby-settings panel" aria-labelledby="lobby-settings-heading"><div className="lobby-section-header"><h2 id="lobby-settings-heading">Make it your game</h2>{isHost && <Crown size={17} />}</div><p className="lobby-settings-note">{isHost ? "You’re the host. Set the scene." : "Your host sets the game rules."}</p>
          <label className="label" htmlFor="lobby-mode">Game mode</label><select className="field" id="lobby-mode" value={room.settings.mode} disabled={!isHost || busy || generating} onChange={(event) => changeSettings({ mode: event.target.value as RoomSettings["mode"] })}><option value="solo">Free-for-all</option><option value="teams">Team showdown</option></select>
          <label className="label" htmlFor="lobby-category">Question category</label><select className="field" id="lobby-category" value={room.settings.category} disabled={!isHost || busy || generating} onChange={(event) => changeSettings({ category: event.target.value })}>{QUESTION_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select>
          <div className="lobby-settings-pair"><div><label className="label" htmlFor="lobby-rounds">Rounds</label><select className="field" id="lobby-rounds" value={room.settings.rounds} disabled={!isHost || busy || generating} onChange={(event) => changeSettings({ rounds: Number(event.target.value) })}><option value={3}>3 rounds</option><option value={5}>5 rounds</option></select></div><div><label className="label" htmlFor="lobby-size">Room size</label><select className="field" id="lobby-size" value={room.settings.maxPlayers} disabled={!isHost || busy || generating} onChange={(event) => changeSettings({ maxPlayers: Number(event.target.value) })}>{[2, 4, 6, 8, 10, 12].map((value) => <option key={value} value={value} disabled={value < room.players.length}>{value} players</option>)}</select></div></div>
          <div className="lobby-public-setting"><div><span className="lobby-public-icon">{room.isPublic ? <Globe2 size={19} /> : <LockKeyhole size={19} />}</span><div><strong>Open to everyone</strong><p>{room.isPublic ? "Players can find your lobby." : "Only people with the code can join."}</p></div></div><button className={`lobby-toggle ${room.isPublic ? "is-on" : ""}`} role="switch" aria-checked={room.isPublic} aria-label="Open lobby to public players" type="button" disabled={!isHost || busy || generating} onClick={() => void onAction({ type: "settings", settings: {}, isPublic: !room.isPublic })}><span /></button></div>
        </section>

        <section className="lobby-how-to panel" aria-labelledby="lobby-how-heading"><span className="lobby-how-icon">{room.settings.mode === "teams" ? <Users size={24} /> : <Zap size={24} />}</span><h2 id="lobby-how-heading">{room.settings.mode === "teams" ? "Better together. Sweeter to win." : "One board. Every player for themselves."}</h2>{room.settings.mode === "teams" ? <ol><li>Take turns guessing with your team.</li><li>Three misses gives the other team a chance to steal the bank.</li><li>Collect the most points to take the crown.</li></ol> : <ol><li>Everyone guesses at the same time.</li><li>Claim an answer first to score its points.</li><li>Three misses and you sit out the round.</li></ol>}<p><Sparkles size={13} />{generating ? "Rounds are being selected." : "Your answer boards lock in before play."}</p></section>
      </aside>
    </div>
  </main>;
}
