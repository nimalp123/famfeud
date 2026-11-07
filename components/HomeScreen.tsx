"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, Globe2, LockKeyhole, Radio, Sparkles, Trophy, Users, Zap } from "lucide-react";
import type { GameMode, PublicRoom, RoomSettings } from "@/lib/types";
import { PLAYER_AVATARS, QUESTION_CATEGORIES } from "@/lib/constants";
import { readSession, requestedRoom } from "@/lib/client";

interface HomeScreenProps {
  onCreate: (name: string, avatar: number, settings: RoomSettings) => Promise<void>;
  onJoin: (code: string, name: string, avatar: number) => Promise<void>;
  publicRooms: PublicRoom[];
  busy: boolean;
  error: string | null;
  questionCount: number;
}

export default function HomeScreen({ onCreate, onJoin, publicRooms, busy, error, questionCount }: HomeScreenProps) {
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(0);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<GameMode>("solo");
  const [category, setCategory] = useState("Anything goes");
  const [rounds, setRounds] = useState(3);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const hasSavedSeat = tab === "join" && code.length === 6 && Boolean(readSession(code));

  useEffect(() => {
    const invite = requestedRoom(window.location.search);
    if (invite) {
      setCode(invite);
      setTab("join");
    }
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!hasSavedSeat && !name.trim())) return;
    if (tab === "join") {
      void onJoin(code.trim(), name.trim(), avatar);
    } else {
      void onCreate(name.trim(), avatar, { mode, category, rounds, maxPlayers });
    }
  }

  function choosePublicRoom(roomCode: string) {
    setCode(roomCode);
    setTab("join");
    document.getElementById("home-room-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.getElementById("home-nickname")?.focus(), 100);
  }

  return (
    <main className="home-page">
      <div className="home-hero-grid">
        <section className="home-hero" aria-labelledby="home-heading">
          <div className="home-live-pill"><span className="home-live-dot" /> THE GAME NIGHT IS LIVE</div>
          <h1 id="home-heading">Big guesses.<br /><span>Bigger bragging<br className="home-title-break" /> rights.</span></h1>
          <p className="home-hero-description">Think you know what everyone’s thinking? Grab your friends, guess the top answers, and settle it on the board.</p>
          <div className="home-feature-list">
            <span><Zap size={16} /> Jump in. No signup.</span>
            <span><Sparkles size={16} /> {questionCount} ready-to-play rounds</span>
          </div>
          <div className="home-demo-board" aria-hidden="true">
            <div className="home-demo-heading"><span>NAME A GAME NIGHT ESSENTIAL</span><Sparkles size={16} /></div>
            <div className="home-demo-answer home-demo-answer-revealed"><span className="home-demo-rank">1</span><strong>GOOD COMPANY</strong><span className="home-demo-points">42</span></div>
            <div className="home-demo-answer home-demo-answer-revealed"><span className="home-demo-rank">2</span><strong>A LITTLE RIVALRY</strong><span className="home-demo-points">31</span></div>
            <div className="home-demo-answer"><span className="home-demo-rank">3</span><span className="home-demo-hidden">?</span><span className="home-demo-hidden-points">••</span></div>
            <div className="home-demo-caption"><span>YOUR NEXT GREAT ANSWER GOES HERE</span><ArrowRight size={15} /></div>
            <div className="home-board-sticker">SURVEY<br /><strong>SAYS…</strong></div>
          </div>
        </section>

        <section className="home-play-card panel" aria-labelledby="home-play-heading">
          <div className="home-card-eyebrow">YOUR SEAT IS WAITING</div>
          <h2 id="home-play-heading">Let’s make some noise.</h2>
          <div className="home-tabs" role="tablist" aria-label="Start playing">
            <button id="create-tab" role="tab" aria-selected={tab === "create"} aria-controls="home-room-form" className={tab === "create" ? "is-active" : ""} onClick={() => setTab("create")} type="button">Create a lobby</button>
            <button id="join-tab" role="tab" aria-selected={tab === "join"} aria-controls="home-room-form" className={tab === "join" ? "is-active" : ""} onClick={() => setTab("join")} type="button">Join with a code</button>
          </div>

          <form id="home-room-form" className="home-room-form" role="tabpanel" aria-labelledby={`${tab}-tab`} onSubmit={submit}>
            <div className="home-identity-row">
              <span className={`avatar home-selected-avatar avatar-${avatar}`} aria-hidden="true">{PLAYER_AVATARS[avatar]}</span>
              <div className="home-name-field"><label className="label" htmlFor="home-nickname">Your nickname</label><input className="field" id="home-nickname" value={name} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" maxLength={20} minLength={1} autoComplete="nickname" required={!hasSavedSeat} disabled={hasSavedSeat} /></div>
            </div>
            <div className="home-avatar-picker" role="group" aria-label="Pick your avatar">
              {PLAYER_AVATARS.map((emoji, index) => <button key={emoji} type="button" className={`home-avatar-option ${avatar === index ? "is-selected" : ""}`} aria-label={`Choose ${["cool face", "cowboy", "alien", "frog", "fox", "panda", "robot", "ghost"][index]} avatar`} aria-pressed={avatar === index} onClick={() => setAvatar(index)}>{emoji}{avatar === index && <Check size={10} className="home-avatar-check" />}</button>)}
            </div>

            {tab === "create" ? <>
              <fieldset className="home-mode-fieldset"><legend className="label">Pick your rivalry</legend><div className="home-mode-options">
                <button type="button" className={`home-mode-option ${mode === "solo" ? "is-selected" : ""}`} aria-pressed={mode === "solo"} onClick={() => setMode("solo")}><Zap size={21} /><span><strong>Free-for-all</strong><small>Everyone for themselves</small></span><span className="home-mode-radio" /></button>
                <button type="button" className={`home-mode-option ${mode === "teams" ? "is-selected" : ""}`} aria-pressed={mode === "teams"} onClick={() => setMode("teams")}><Users size={21} /><span><strong>Team showdown</strong><small>Two sides. One showdown.</small></span><span className="home-mode-radio" /></button>
              </div></fieldset>
              <div className="home-settings-row">
                <div className="home-category-field"><label className="label" htmlFor="home-category">Question category</label><select className="field" id="home-category" value={category} onChange={(event) => setCategory(event.target.value)}>{QUESTION_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></div>
                <div><label className="label" htmlFor="home-rounds">Rounds</label><select className="field" id="home-rounds" value={rounds} onChange={(event) => setRounds(Number(event.target.value))}><option value={3}>3 rounds</option><option value={5}>5 rounds</option></select></div>
                <div><label className="label" htmlFor="home-players">Room size</label><select className="field" id="home-players" value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>{[2, 4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value} players</option>)}</select></div>
              </div>
            </> : <div className="home-code-field"><label className="label" htmlFor="home-code">Lobby code</label><input className="field home-code-input" id="home-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="ABCDEF" autoComplete="off" autoCapitalize="characters" spellCheck={false} minLength={6} maxLength={6} required /><p>Get the six-character code from your host.</p></div>}

            {error && <div className="home-error" role="alert">{error}</div>}
            <button className="button button-primary home-submit" type="submit" disabled={busy || (!hasSavedSeat && !name.trim()) || (tab === "join" && code.length !== 6)}><span>{busy ? "Getting your seat…" : tab === "create" ? "Create my lobby" : hasSavedSeat ? "Rejoin my seat" : "Join the showdown"}</span><ArrowRight size={19} /></button>
            <p className="home-private-note"><LockKeyhole size={13} />{tab === "create" ? "Starts private. Invite friends or open it to everyone." : hasSavedSeat ? "This browser has a saved seat for this room." : "One code. Your people. Let the guessing begin."}</p>
          </form>
        </section>
      </div>

      <section className="home-public-section" aria-labelledby="public-heading">
        <div className="home-section-heading"><div><div className="home-section-eyebrow"><Radio size={14} /> ROOM FOR ONE MORE</div><h2 id="public-heading">Find your next rivalry.</h2></div><span className="home-public-count"><span className="home-live-dot" />{publicRooms.length} open {publicRooms.length === 1 ? "lobby" : "lobbies"}</span></div>
        {publicRooms.length > 0 ? <div className="home-public-grid">{publicRooms.map((room) => <article key={room.code} className="home-public-room panel"><div className="home-public-room-top"><span className="badge">{room.mode === "solo" ? <Zap size={12} /> : <Users size={12} />}{room.mode === "solo" ? "FREE-FOR-ALL" : "TEAM SHOWDOWN"}</span><span className="home-public-occupancy"><Users size={14} />{room.players}/{room.maxPlayers}</span></div><h3>{room.hostName}’s lobby</h3><p>{room.category}</p><button className="button button-secondary" type="button" onClick={() => choosePublicRoom(room.code)} disabled={busy}>Join lobby <ArrowRight size={16} /></button></article>)}</div> : <div className="home-public-empty panel"><div className="home-empty-icon"><Globe2 size={26} /></div><div><h3>The floor is yours.</h3><p>No public lobbies right now. Create one, open it up, and start a new rivalry.</p></div><button className="button button-secondary" type="button" onClick={() => { setTab("create"); document.getElementById("home-room-form")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Be the first <ArrowRight size={16} /></button></div>}
      </section>

      <div className="home-bottom-note"><Trophy size={15} /><span>Easy to join. Hard to stop at one game.</span><span className="home-bottom-spark">✦</span><span>2–12 players. Endless “I knew that!”</span></div>
    </main>
  );
}
