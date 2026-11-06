"use client";

import { ArrowRight, LogOut, RotateCcw, Sparkles, Trophy } from "lucide-react";
import type { ClientAction, RoomView, Session } from "../lib/types.ts";
import { PLAYER_AVATARS } from "../lib/constants.ts";

interface ResultsScreenProps {
  room: RoomView;
  session: Session;
  onAction: (action: ClientAction) => Promise<void>;
  onLeave: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

export default function ResultsScreen({ room, session, onAction, onLeave, busy, error }: ResultsScreenProps) {
  const isSolo = room.settings.mode === "solo";
  const isHost = room.hostId === session.playerId;
  const rankedPlayers = [...room.players].sort((left, right) => right.score - left.score || left.joinedAt - right.joinedAt);
  const bestScore = isSolo ? rankedPlayers[0]?.score ?? 0 : Math.max(...room.teamScores);
  const winners = isSolo
    ? rankedPlayers.filter((player) => player.score === bestScore).map((player) => player.name)
    : room.teamScores[0] === room.teamScores[1] ? ["Blue team", "Orange team"] : [room.teamScores[0] > room.teamScores[1] ? "Blue team" : "Orange team"];
  const tied = winners.length > 1;
  const title = tied ? "A photo finish!" : `${winners[0] ?? "Your room"} takes the crown!`;

  return (
    <section className="results-screen" aria-label="Game results">
      <div className="match-topline"><span className="badge">THAT’S A WRAP</span><span className="match-room-code">Room <strong>{room.code}</strong></span></div>
      <div className="results-hero">
        <div className="results-trophy" aria-hidden="true"><Sparkles size={24} /><Trophy size={60} strokeWidth={1.6} /><Sparkles size={21} /></div>
        <span className="badge">{room.roundIndex + 1} {room.roundIndex === 0 ? "round" : "rounds"} played. Plenty of opinions.</span>
        <h1>{title}</h1>
        <p>{tied ? `${winners.join(" and ")} share the top spot with ${bestScore} points.` : "A little instinct. A little luck. A lot of bragging rights."}</p>
      </div>

      <div className={`results-podium ${isSolo ? "is-solo" : "is-teams"}`}>
        {isSolo ? rankedPlayers.map((player, index) => {
          const isWinner = player.score === bestScore;
          const rank = rankedPlayers.findIndex((entry) => entry.score === player.score) + 1;
          return (
            <div className={`results-place panel ${isWinner ? "is-winner" : ""} ${player.id === session.playerId ? "is-current" : ""}`} key={player.id}>
              <span className="results-place-number">{isWinner ? <Trophy size={18} /> : `#${rank}`}</span>
              <span className={`avatar avatar-${player.avatar % PLAYER_AVATARS.length}`} aria-hidden="true">{PLAYER_AVATARS[player.avatar % PLAYER_AVATARS.length]}</span>
              <h2>{player.name}{player.id === session.playerId && <small>you</small>}</h2>
              <span className="results-points">{player.score}<small>points</small></span>
              {index === 0 && !tied && <span className="results-winner-label">ROOM CHAMPION</span>}
            </div>
          );
        }) : ([0, 1] as (0 | 1)[]).sort((left, right) => room.teamScores[right] - room.teamScores[left]).map((team) => (
          <div className={`results-place results-team-${team} panel ${room.teamScores[team] === bestScore ? "is-winner" : ""}`} key={team}>
            <span className="results-place-number">{room.teamScores[team] === bestScore ? <Trophy size={19} /> : "#2"}</span>
            <span className="results-team-icon" aria-hidden="true">{team === 0 ? "⚡" : "🔥"}</span>
            <h2>{team === 0 ? "Blue team" : "Orange team"}</h2>
            <p className="results-team-members">{room.players.filter((player) => player.team === team).map((player) => player.name).join(" · ")}</p>
            <span className="results-points">{room.teamScores[team]}<small>points</small></span>
          </div>
        ))}
      </div>

      <div className="results-actions">
        {isHost ? (
          <button className="button button-primary" onClick={() => void onAction({ type: "rematch" })} disabled={busy}>
            <RotateCcw size={18} />{busy ? "One moment…" : "Run it back"}<ArrowRight size={18} />
          </button>
        ) : <p className="match-waiting">Up for another? Your host can start a rematch.</p>}
        <button className="button button-secondary" onClick={() => void onLeave()} disabled={busy}><LogOut size={17} />Leave room</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="results-note">{isHost ? "Your room stays together. Pick a new mode or category in the lobby." : "A rematch brings everyone back to the same lobby."}</p>
    </section>
  );
}
