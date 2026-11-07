"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, LogOut, Radio, Sparkles, Trophy, Users, X } from "lucide-react";
import type { ClientAction, PlayerView, RoomView, Session, Team } from "../lib/types.ts";
import { PLAYER_AVATARS } from "../lib/constants.ts";

interface MatchScreenProps {
  room: RoomView;
  session: Session;
  onAction: (action: ClientAction) => Promise<void>;
  onLeave: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

const TEAM_NAMES = ["Blue team", "Orange team"];

function Strikes({ count, label }: { count: number; label: string }) {
  return (
    <span className="score-strikes" aria-label={`${label}: ${count} of 3 strikes`}>
      {[0, 1, 2].map((strike) => (
        <span key={strike} className={`strike ${strike < count ? "is-active" : ""}`} aria-hidden="true">
          <X size={15} strokeWidth={3} />
        </span>
      ))}
    </span>
  );
}

function PlayerRow({ player, session, room }: { player: PlayerView; session: Session; room: RoomView }) {
  const isYou = player.id === session.playerId;
  const isTurn = room.phase === "playing" && room.round?.activePlayerId === player.id;
  return (
    <div className={`score-player ${isYou ? "is-current" : ""} ${isTurn ? "is-turn" : ""}`}>
      <span className={`avatar avatar-${player.avatar % PLAYER_AVATARS.length}`} aria-hidden="true">
        {PLAYER_AVATARS[player.avatar % PLAYER_AVATARS.length]}
      </span>
      <div className="score-player-copy">
        <strong>{player.name}{isYou && <span className="score-you"> you</span>}</strong>
        <small>{isTurn ? "At the buzzer" : player.connected ? "In the game" : "Reconnecting…"}</small>
        {room.settings.mode === "solo" && (
          <Strikes count={room.round?.playerStrikes[player.id] ?? 0} label={player.name} />
        )}
      </div>
      {room.settings.mode === "solo" && <span className="score-value">{player.score}<small>pts</small></span>}
      {isTurn && room.settings.mode === "teams" && <Radio size={17} className="score-turn-icon" aria-label="Current player" />}
    </div>
  );
}

export default function MatchScreen({ room, session, onAction, onLeave, busy, error }: MatchScreenProps) {
  const [guess, setGuess] = useState("");
  const [clock, setClock] = useState(room.serverTime);
  const inputRef = useRef<HTMLInputElement>(null);
  const player = room.players.find((entry) => entry.id === session.playerId);
  const round = room.round;
  const isHost = room.hostId === session.playerId;
  const isSolo = room.settings.mode === "solo";
  const isPlaying = room.phase === "playing";
  const strikes = round?.playerStrikes[session.playerId] ?? 0;
  const canGuess = Boolean(player && isPlaying && round && (isSolo ? strikes < 3 : round.activePlayerId === session.playerId));
  const secondsLeft = round ? Math.max(0, Math.ceil((round.deadline - clock) / 1000)) : 0;
  const duration = isSolo ? 60 : 20;
  const timerPercent = Math.max(0, Math.min(100, (secondsLeft / duration) * 100));
  const activePlayer = room.players.find((entry) => entry.id === round?.activePlayerId);
  const rankedPlayers = [...room.players].sort((left, right) => right.score - left.score || left.joinedAt - right.joinedAt);

  useEffect(() => {
    const receivedAt = Date.now();
    setClock(room.serverTime);
    const interval = setInterval(() => setClock(room.serverTime + Date.now() - receivedAt), 250);
    return () => clearInterval(interval);
  }, [room.serverTime]);

  useEffect(() => {
    setGuess("");
  }, [room.roundIndex]);

  useEffect(() => {
    if (canGuess && !busy && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus({ preventScroll: window.matchMedia("(max-width: 700px)").matches });
    }
  }, [canGuess, busy]);

  async function submitGuess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answer = guess.trim();
    if (!answer || !canGuess || busy || secondsLeft === 0) return;
    try {
      await onAction({ type: "guess", guess: answer });
      setGuess((current) => current === guess ? "" : current);
    } catch {
      // The application shell displays the server's action error.
    }
  }

  const turnMessage = isSolo
    ? strikes >= 3 ? "Three strikes. Cheer on the rest of the room!" : "Everyone’s in. Find an answer before someone else does."
    : round?.stealing
      ? `${TEAM_NAMES[round.activeTeam]} has one chance to steal ${round.bank} points!`
      : canGuess ? "You’re up! What’s on the board?" : `${activePlayer?.name ?? "The next player"} is at the buzzer.`;

  return (
    <section className="match-screen" aria-label="Live game">
      <div className="match-topline">
        <span className="badge"><span className="live-dot" /> {room.phase === "generating" ? "Getting ready" : "Live showdown"}</span>
        <span className="match-room-code">Room <strong>{room.code}</strong></span>
        <button className="button button-quiet" onClick={() => void onLeave()} disabled={busy}><LogOut size={16} /> Leave game</button>
      </div>

      {room.phase === "generating" ? (
        <div className="match-generating panel" role="status">
          <div className="match-loading-orbit" aria-hidden="true"><span>?</span><span>!</span><Sparkles size={36} /></div>
          <span className="badge">A little suspense never hurt</span>
          <h1>Setting the stage.</h1>
          <p>Picking {room.settings.rounds} rounds from the question bank for your room. The first question is coming right up.</p>
          <div className="match-loading-steps"><span /><span /><span /></div>
          <small>Keep this tab open. Everyone will start together.</small>
        </div>
      ) : round ? (
        <div className="match-layout">
          <div className="match-main">
            <div className="match-round-heading">
              <span>ROUND <strong>{room.roundIndex + 1}</strong> <span>/ {room.settings.rounds}</span></span>
              <span className="badge">{isSolo ? "Free-for-all" : "Team showdown"}</span>
            </div>

            <div className="match-question panel">
              <div className="match-question-eyebrow"><Sparkles size={15} /> {room.settings.category}</div>
              <h1>{round.prompt}</h1>
              <div className="match-question-footer">
                <span className="badge">{room.source === "bank" ? "Question bank" : "Saved board"}</span>
                {isPlaying ? (
                  <div className={`match-timer ${secondsLeft <= 5 ? "is-urgent" : ""}`} role="timer" aria-label={`${secondsLeft} seconds remaining`}>
                    <Clock3 size={18} /><span>{secondsLeft}<small>s</small></span>
                  </div>
                ) : <span className="match-round-complete"><Check size={17} /> Round complete</span>}
              </div>
              {isPlaying && <div className="match-timer-track" aria-hidden="true"><i style={{ width: `${timerPercent}%` }} /></div>}
            </div>

            <div className="board-grid" aria-label="Answer board" aria-live="polite">
              {round.answers.map((answer, index) => {
                const revealed = answer.text !== null;
                const claimant = room.players.find((entry) => entry.id === answer.claimedBy);
                return (
                  <div key={answer.id} className={`board-answer ${revealed ? "is-revealed" : ""} ${answer.claimedBy === session.playerId ? "is-mine" : ""}`}>
                    <span className="board-number">{index + 1}</span>
                    <div className="board-answer-copy">
                      <strong>{revealed ? answer.text : ""}</strong>
                      {revealed && claimant && <small className="board-claim">{answer.claimedBy === session.playerId ? "You got this one" : claimant.name}</small>}
                      {!revealed && <span className="board-hidden" aria-label={`Answer ${index + 1} hidden`}>••••••••</span>}
                    </div>
                    {revealed && <span className="board-points">{answer.points}<small>pts</small></span>}
                  </div>
                );
              })}
            </div>

            {isPlaying ? (
              <>
                <div className={`match-turn-banner ${canGuess ? "is-my-turn" : ""} ${round.stealing ? "is-steal" : ""}`}>
                  {round.stealing ? <Trophy size={19} /> : isSolo ? <Users size={19} /> : <Radio size={19} />}
                  <span>{turnMessage}</span>
                  {!isSolo && <span className="match-bank">{round.bank}<small>in the pot</small></span>}
                </div>
                <form className="match-guess-form panel" onSubmit={submitGuess}>
                  <label className="label" htmlFor="live-answer">{canGuess ? "YOUR BEST GUESS" : "STAY SHARP"}</label>
                  <div className="match-guess-row">
                    <input
                      ref={inputRef}
                      className="field"
                      id="live-answer"
                      value={guess}
                      onChange={(event) => setGuess(event.target.value)}
                      placeholder={canGuess ? "Type an answer…" : isSolo ? "You’re out for this round" : "Waiting for your turn…"}
                      maxLength={100}
                      autoComplete="off"
                      enterKeyHint="send"
                      disabled={!canGuess || secondsLeft === 0}
                      aria-describedby="guess-hint"
                    />
                    <button className="button button-primary" type="submit" disabled={!canGuess || busy || !guess.trim() || secondsLeft === 0}>
                      {busy ? "Checking…" : "Lock it in"}<ArrowRight size={18} />
                    </button>
                  </div>
                  <p className="match-hint" id="guess-hint">{isSolo ? "One board. First to find an answer gets its points. Three misses and you sit this round out." : "Each teammate takes a turn. Three misses give the other team one shot at a steal."}</p>
                  {error && <p className="form-error" role="alert">{error}</p>}
                </form>
              </>
            ) : (
              <div className="match-round-summary panel" aria-live="polite">
                <span className="badge"><Check size={14} /> That’s the board</span>
                <h2>{round.endedReason ?? "Round complete!"}</h2>
                <p>{room.roundIndex + 1 >= room.settings.rounds ? "The final guesses are in. Time to see who came out on top." : "Take a breath. A fresh question is up next."}</p>
                {isHost ? (
                  <button className="button button-primary" disabled={busy} onClick={() => void onAction({ type: "next" })}>
                    {busy ? "One moment…" : room.roundIndex + 1 >= room.settings.rounds ? "See results" : "Next round"}<ArrowRight size={18} />
                  </button>
                ) : <p className="match-waiting">Waiting for the host to continue…</p>}
                {error && <p className="form-error" role="alert">{error}</p>}
              </div>
            )}
          </div>

          <aside className="score-panel panel" aria-label="Scoreboard">
            <div className="score-heading"><Trophy size={19} /><h2>{isSolo ? "The leaderboard" : "The teams"}</h2></div>
            {isSolo ? (
              <div className="score-list">{rankedPlayers.map((entry) => <PlayerRow key={entry.id} player={entry} session={session} room={room} />)}</div>
            ) : (
              ([0, 1] as Team[]).map((team) => (
                <div className={`score-team score-team-${team} ${isPlaying && round.activeTeam === team ? "is-active" : ""}`} key={team}>
                  <div className="score-team-heading"><h3>{TEAM_NAMES[team]}</h3><span className="score-value">{room.teamScores[team]}<small>pts</small></span></div>
                  <Strikes count={round.teamStrikes[team]} label={TEAM_NAMES[team]} />
                  <div className="score-team-roster">{room.players.filter((entry) => entry.team === team).map((entry) => <PlayerRow key={entry.id} player={entry} session={session} room={room} />)}</div>
                </div>
              ))
            )}
            <div className="match-events" aria-label="Recent game events">
              <h3>JUST HAPPENED</h3>
              {room.events.slice(-4).reverse().map((event) => <p key={event.id} className={`match-event is-${event.kind}`}>{event.text}</p>)}
            </div>
            <p className="score-footnote">Game points are estimated popularity. Each board stays fixed for the match.</p>
          </aside>
        </div>
      ) : <div className="panel match-generating" role="status"><h1>Joining the game…</h1><p>Your board will appear in a moment.</p></div>}
    </section>
  );
}
