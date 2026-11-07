import type {
  Answer,
  GameEvent,
  Player,
  Question,
  QuestionSource,
  RoomAction,
  RoomSettings,
  RoomState,
  RoomView,
  RoundState,
  Team,
} from "./types.ts";
import { answerMeaning, conciseMeaning, meaningSpellingVariants, normalizeAnswer, spellingDistance } from "./answers.ts";
import { QUESTION_CATEGORIES } from "./constants.ts";
import { readQuestionBankShortWords } from "./question-bank.ts";

const SOLO_ROUND_MS = 60_000;
const TEAM_TURN_MS = 20_000;
const MAX_STRIKES = 3;
const GUESS_INTERVAL_MS = 500;
const CONNECTED_WINDOW_MS = 30_000;

export function validateSettings(settings: RoomSettings): RoomSettings {
  if (!settings || (settings.mode !== "solo" && settings.mode !== "teams")) {
    throw new Error("Choose free-for-all or two teams.");
  }
  if (!Number.isInteger(settings.rounds) || settings.rounds < 3 || settings.rounds > 5) {
    throw new Error("Choose between 3 and 5 rounds.");
  }
  if (!Number.isInteger(settings.maxPlayers) || settings.maxPlayers < 2 || settings.maxPlayers > 12) {
    throw new Error("Rooms support between 2 and 12 players.");
  }
  if (typeof settings.category !== "string" || !QUESTION_CATEGORIES.includes(settings.category.trim() as typeof QUESTION_CATEGORIES[number])) {
    throw new Error("Choose a supported question category.");
  }
  return {
    mode: settings.mode,
    category: settings.category.trim(),
    rounds: settings.rounds,
    maxPlayers: settings.maxPlayers,
  };
}

function addEvent(room: RoomState, text: string, kind: GameEvent["kind"], now: number): void {
  room.events.push({ id: crypto.randomUUID(), text, kind, at: now });
  room.events = room.events.slice(-20);
  room.updatedAt = now;
}

function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

function teamPlayers(room: RoomState, team: Team): Player[] {
  return room.players.filter((player) => player.team === team);
}

function leastPopulatedTeam(room: RoomState): Team {
  return teamPlayers(room, 0).length <= teamPlayers(room, 1).length ? 0 : 1;
}

function rebalanceTeams(room: RoomState): void {
  room.players.forEach((player, index) => {
    player.team = room.settings.mode === "teams" ? (index % 2 as Team) : null;
  });
}

function playerInRoom(room: RoomState, playerId: string): Player {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error("You are no longer in this room.");
  return player;
}

function requireHost(room: RoomState, playerId: string): void {
  if (room.hostId !== playerId) throw new Error("Only the host can do that.");
}

function requireLobby(room: RoomState): void {
  if (room.phase !== "lobby") throw new Error("This setting can only change in the lobby.");
}

function resetReadiness(room: RoomState): void {
  room.players.forEach((player) => { player.ready = player.id === room.hostId; });
}

export function createRoom(options: {
  code: string;
  player: Player;
  settings: RoomSettings;
  now: number;
}): RoomState {
  const settings = validateSettings(options.settings);
  const player = structuredClone(options.player);
  player.ready = true;
  player.score = 0;
  player.team = settings.mode === "teams" ? 0 : null;
  player.joinedAt = options.now;
  player.lastSeen = options.now;
  player.lastGuessAt = 0;
  const room: RoomState = {
    code: options.code,
    hostId: player.id,
    settings,
    isPublic: false,
    phase: "lobby",
    players: [player],
    questions: [],
    source: "curated",
    roundIndex: 0,
    round: null,
    teamScores: [0, 0],
    events: [],
    revision: 0,
    createdAt: options.now,
    updatedAt: options.now,
    generationId: null,
    error: null,
  };
  addEvent(room, `${player.name} created the room.`, "system", options.now);
  return room;
}

export function addPlayer(state: RoomState, entry: Player, now: number): RoomState {
  requireLobby(state);
  if (state.players.length >= state.settings.maxPlayers) throw new Error("This room is full.");
  if (state.players.some((player) => player.id === entry.id)) throw new Error("You already joined this room.");
  const room = structuredClone(state);
  room.players.push({
    ...entry,
    ready: false,
    score: 0,
    team: room.settings.mode === "teams" ? leastPopulatedTeam(room) : null,
    joinedAt: now,
    lastSeen: now,
    lastGuessAt: 0,
  });
  addEvent(room, `${entry.name} joined the room.`, "system", now);
  return room;
}

function chooseActivePlayer(room: RoomState): void {
  const round = room.round!;
  const players = teamPlayers(room, round.activeTeam);
  round.activePlayerId = players.length ? players[round.turnIndex[round.activeTeam] % players.length].id : null;
}

function beginRound(room: RoomState, now: number): void {
  const activeTeam = room.roundIndex % 2 as Team;
  room.round = {
    revealed: {},
    playerStrikes: Object.fromEntries(room.players.map((player) => [player.id, 0])),
    teamStrikes: [0, 0],
    activeTeam,
    activePlayerId: null,
    turnIndex: [0, 0],
    stealing: false,
    bank: 0,
    deadline: now + (room.settings.mode === "solo" ? SOLO_ROUND_MS : TEAM_TURN_MS),
    endedReason: null,
  };
  room.phase = "playing";
  room.players.forEach((player) => { player.lastGuessAt = 0; });
  if (room.settings.mode === "teams") chooseActivePlayer(room);
  addEvent(room, `Round ${room.roundIndex + 1} is live!`, "system", now);
}

function validateQuestions(questions: Question[], count: number): Question[] {
  if (!Array.isArray(questions) || questions.length < count) {
    throw new Error("The question deck is incomplete. Try starting again.");
  }
  const deck = questions.slice(0, count);
  for (const question of deck) {
    if (typeof question.prompt !== "string" || !question.prompt.trim() || question.prompt.length > 200 ||
        !Array.isArray(question.answers) || question.answers.length < 2 || question.answers.length > 8) {
      throw new Error("A generated question was invalid. Try starting again.");
    }
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const answer of question.answers) {
      const label = normalizeAnswer(answer.text);
      if (typeof answer.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(answer.id) || ids.has(answer.id) ||
          !label || labels.has(label) || !Number.isInteger(answer.points) || answer.points < 1 || answer.points > 100 ||
          !Array.isArray(answer.aliases) || answer.aliases.length > 10 || answer.aliases.some((alias) => typeof alias !== "string" || alias.length > 100)) {
        throw new Error("A generated answer was invalid. Try starting again.");
      }
      const answerLabels = new Set([label, ...answer.aliases.map(normalizeAnswer)]);
      for (const candidate of answerLabels) {
        if (!candidate || labels.has(candidate)) throw new Error("The generated answers overlapped. Try starting again.");
        labels.add(candidate);
      }
      ids.add(answer.id);
    }
    if (question.answers.reduce((sum, answer) => sum + answer.points, 0) !== 100) {
      throw new Error("The generated points did not total 100. Try starting again.");
    }
  }
  return structuredClone(deck);
}

export function startGame(state: RoomState, questions: Question[], source: QuestionSource, now: number): RoomState {
  if (state.phase !== "lobby" && state.phase !== "generating") throw new Error("A game is already in progress.");
  if (state.players.length < 2) throw new Error("You need at least 2 players to start.");
  if (state.players.some((player) => !player.ready)) throw new Error("Every player needs to be ready.");
  if (state.settings.mode === "teams") {
    const counts = [teamPlayers(state, 0).length, teamPlayers(state, 1).length];
    if (counts.some((count) => count === 0) || Math.abs(counts[0] - counts[1]) > 1) {
      throw new Error("Choose two nonempty, balanced teams before starting.");
    }
  }
  const room = structuredClone(state);
  room.questions = validateQuestions(questions, room.settings.rounds);
  room.source = source;
  room.roundIndex = 0;
  room.teamScores = [0, 0];
  room.players.forEach((player) => { player.score = 0; });
  room.generationId = null;
  room.error = null;
  beginRound(room, now);
  return room;
}

function finishRound(room: RoomState, reason: string, now: number, winner?: Team): void {
  if (room.phase !== "playing" || !room.round) return;
  if (winner !== undefined) room.teamScores[winner] += room.round.bank;
  room.round.endedReason = reason;
  room.round.activePlayerId = null;
  room.phase = "round-ended";
  addEvent(room, reason, "system", now);
}

function rotatePlayer(room: RoomState, now: number): void {
  const round = room.round!;
  round.turnIndex[round.activeTeam] += 1;
  chooseActivePlayer(room);
  round.deadline = now + TEAM_TURN_MS;
}

function missTeamAnswer(room: RoomState, player: Player | undefined, now: number, timedOut: boolean): void {
  const round = room.round!;
  const label = player?.name ?? `Team ${round.activeTeam + 1}`;
  addEvent(room, timedOut ? `${label} ran out of time.` : `${label} missed.`, "miss", now);
  if (round.stealing) {
    finishRound(room, `Steal missed. Team ${otherTeam(round.activeTeam) + 1} takes ${round.bank} points.`, now, otherTeam(round.activeTeam));
    return;
  }
  round.teamStrikes[round.activeTeam] += 1;
  if (round.teamStrikes[round.activeTeam] === MAX_STRIKES) {
    round.activeTeam = otherTeam(round.activeTeam);
    round.stealing = true;
    chooseActivePlayer(room);
    round.deadline = now + TEAM_TURN_MS;
    addEvent(room, `Team ${round.activeTeam + 1} has one chance to steal!`, "system", now);
    return;
  }
  rotatePlayer(room, now);
}

export function advanceTime(state: RoomState, now: number): RoomState {
  if (state.phase !== "playing" || !state.round || now < state.round.deadline) return state;
  const room = structuredClone(state);
  if (room.settings.mode === "solo") {
    finishRound(room, "Time's up!", now);
  } else {
    missTeamAnswer(room, room.players.find((player) => player.id === room.round!.activePlayerId), now, true);
  }
  return room;
}

function matchMeaning(meaning: string, meanings: { answer: Answer; labels: string[] }[]): Answer | null | undefined {
  const semantic = meanings.filter((candidate) => candidate.labels.includes(meaning));
  if (semantic.length) return semantic.length === 1 ? semantic[0].answer : null;

  const concise = conciseMeaning(meaning);
  const abbreviated = meanings.filter(({ labels }) => labels.some((label) => conciseMeaning(label) === concise));
  if (abbreviated.length) {
    if (abbreviated.length !== 1) return null;
    const { answer, labels } = abbreviated[0];
    const opposite = (label: string) => /^stop talk\b/.test(label) && conciseMeaning(label) === concise;
    if (opposite(meaning) || labels.some(opposite)) return null;
    const talking = /^(?:(?:keep|start) )?talk\b/;
    const hasBareSide = meaning === concise || labels.includes(concise);
    const bothTalk = talking.test(meaning) && labels.some((label) => talking.test(label) && conciseMeaning(label) === concise);
    if (hasBareSide || bothTalk) return answer;
  }
}

function matchAnswer(answers: Answer[], guess: string): Answer | undefined {
  const normalized = normalizeAnswer(guess);
  const candidates = answers.map((answer) => ({
    answer,
    labels: [answer.text, ...answer.aliases].map(normalizeAnswer),
  }));
  const exact = candidates.find((candidate) => candidate.labels.includes(normalized));
  if (exact) return exact.answer;

  const meaning = answerMeaning(normalized);
  const meanings = candidates.map(({ answer, labels }) => ({ answer, labels: labels.map(answerMeaning) }));
  const semantic = matchMeaning(meaning, meanings);
  if (semantic !== undefined) return semantic ?? undefined;

  const knownWords = readQuestionBankShortWords();
  const close = candidates.map(({ answer, labels }, index) => ({
    answer,
    distance: Math.min(
      ...labels.map((label) => spellingDistance(normalized, label, knownWords)),
      ...meanings[index].labels.map((label) => spellingDistance(meaning, label, knownWords)),
    ),
  }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((a, b) => a.distance - b.distance);
  if (close.length > 1 && close[0].distance === close[1].distance) return undefined;
  if (close.length) return close[0].answer;

  const corrected = new Set<Answer>();
  for (const variant of meaningSpellingVariants(normalized, meanings.flatMap(({ labels }) => labels), knownWords)) {
    const match = matchMeaning(answerMeaning(variant), meanings);
    if (match === null) return undefined;
    if (match) corrected.add(match);
  }
  return corrected.size === 1 ? corrected.values().next().value : undefined;
}

function submitGuess(room: RoomState, player: Player, guess: string, now: number): void {
  if (room.phase !== "playing" || !room.round) throw new Error("Wait for the next round to guess.");
  if (typeof guess !== "string" || !guess.trim() || guess.trim().length > 100) throw new Error("Enter an answer of up to 100 characters.");
  const round = room.round;
  if (room.settings.mode === "teams" && round.activePlayerId !== player.id) throw new Error("Wait for your turn.");
  if (room.settings.mode === "solo" && (round.playerStrikes[player.id] ?? 0) >= MAX_STRIKES) throw new Error("You're out of guesses this round.");
  if (player.lastGuessAt > 0 && now - player.lastGuessAt < GUESS_INTERVAL_MS) throw new Error("Give it a moment before guessing again.");
  const question = room.questions[room.roundIndex];
  const answer = matchAnswer(question.answers, guess);
  if (answer && Object.hasOwn(round.revealed, answer.id)) throw new Error("That answer is already on the board.");
  player.lastGuessAt = now;
  if (answer) {
    round.revealed[answer.id] = player.id;
    round.bank += answer.points;
    player.score += answer.points;
    addEvent(room, `${player.name} found ${answer.text} · ${answer.points} points!`, "correct", now);
    if (room.settings.mode === "teams" && round.stealing) {
      finishRound(room, `Team ${round.activeTeam + 1} steals ${round.bank} points!`, now, round.activeTeam);
    } else if (Object.keys(round.revealed).length === question.answers.length) {
      finishRound(room, "Board cleared!", now, room.settings.mode === "teams" ? round.activeTeam : undefined);
    } else if (room.settings.mode === "teams") {
      rotatePlayer(room, now);
    }
    return;
  }
  if (room.settings.mode === "teams") {
    missTeamAnswer(room, player, now, false);
    return;
  }
  round.playerStrikes[player.id] = (round.playerStrikes[player.id] ?? 0) + 1;
  addEvent(room, `${player.name} missed · ${round.playerStrikes[player.id]} of 3 strikes.`, "miss", now);
  if (room.players.every((entry) => (round.playerStrikes[entry.id] ?? 0) >= MAX_STRIKES)) {
    finishRound(room, "Everyone is out of guesses. The board is revealed!", now);
  }
}

function removePlayer(room: RoomState, playerId: string, now: number, kicked: boolean): void {
  const player = playerInRoom(room, playerId);
  const wasActive = room.round?.activePlayerId === playerId;
  room.players = room.players.filter((entry) => entry.id !== playerId);
  if (room.hostId === playerId) {
    room.hostId = room.players[0]?.id ?? "";
    if (room.players[0] && room.phase === "lobby") room.players[0].ready = true;
  }
  addEvent(room, `${player.name} ${kicked ? "was removed" : "left the room"}.`, "system", now);
  if (room.players.length === 0) {
    room.isPublic = false;
    room.phase = "finished";
    room.generationId = null;
    return;
  }
  if (room.phase !== "playing") return;
  if (room.players.length < 2 || (room.settings.mode === "teams" && [0, 1].some((team) => !teamPlayers(room, team as Team).length))) {
    const winner = room.settings.mode === "teams" ? room.players[0].team ?? undefined : undefined;
    finishRound(room, "The match ended because a side left the room.", now, winner);
    room.phase = "finished";
    return;
  }
  if (wasActive) {
    chooseActivePlayer(room);
    room.round!.deadline = now + TEAM_TURN_MS;
  }
  if (room.settings.mode === "solo" && room.players.every((entry) => (room.round!.playerStrikes[entry.id] ?? 0) >= MAX_STRIKES)) {
    finishRound(room, "Everyone remaining is out of guesses.", now);
  }
}

export function applyAction(state: RoomState, playerId: string, action: RoomAction, now: number): RoomState {
  const room = structuredClone(advanceTime(state, now));
  const player = playerInRoom(room, playerId);
  switch (action.type) {
    case "ready":
      requireLobby(room);
      if (typeof action.ready !== "boolean") throw new Error("Choose a ready status.");
      player.ready = action.ready;
      break;
    case "settings": {
      requireHost(room, playerId);
      requireLobby(room);
      const settings = validateSettings({ ...room.settings, ...action.settings });
      if (settings.maxPlayers < room.players.length) throw new Error("The room already has more players than that limit.");
      if (action.isPublic !== undefined && typeof action.isPublic !== "boolean") throw new Error("Choose a valid room visibility.");
      const modeChanged = settings.mode !== room.settings.mode;
      const gameChanged = settings.mode !== room.settings.mode || settings.category !== room.settings.category || settings.rounds !== room.settings.rounds;
      room.settings = settings;
      if (action.isPublic !== undefined) room.isPublic = action.isPublic;
      if (modeChanged) rebalanceTeams(room);
      if (gameChanged) resetReadiness(room);
      break;
    }
    case "team":
      requireLobby(room);
      if (room.settings.mode !== "teams" || (action.team !== 0 && action.team !== 1)) throw new Error("Choose one of the two teams.");
      player.team = action.team;
      player.ready = player.id === room.hostId;
      break;
    case "kick":
      requireHost(room, playerId);
      requireLobby(room);
      if (action.playerId === playerId) throw new Error("Use Leave room to leave your own room.");
      removePlayer(room, action.playerId, now, true);
      break;
    case "leave":
      removePlayer(room, playerId, now, false);
      break;
    case "guess":
      submitGuess(room, player, action.guess, now);
      break;
    case "next":
      requireHost(room, playerId);
      if (room.phase !== "round-ended") throw new Error("Finish this round first.");
      if (room.roundIndex + 1 >= room.settings.rounds) {
        room.phase = "finished";
        addEvent(room, "That's a wrap!", "system", now);
      } else {
        room.roundIndex += 1;
        beginRound(room, now);
      }
      break;
    case "rematch":
      requireHost(room, playerId);
      if (room.phase !== "finished" && room.phase !== "round-ended") throw new Error("Finish the round first.");
      room.phase = "lobby";
      room.questions = [];
      room.round = null;
      room.roundIndex = 0;
      room.teamScores = [0, 0];
      room.generationId = null;
      room.error = null;
      room.players.forEach((entry) => { entry.score = 0; entry.lastGuessAt = 0; });
      resetReadiness(room);
      addEvent(room, "Back in the lobby. Ready for a fresh match?", "system", now);
      break;
    default:
      throw new Error("That game action is not supported.");
  }
  room.updatedAt = now;
  return room;
}

export function toRoomView(room: RoomState, now: number): RoomView {
  const showAll = room.phase === "round-ended" || room.phase === "finished";
  const question = room.questions[room.roundIndex];
  return {
    code: room.code,
    hostId: room.hostId,
    settings: { ...room.settings },
    isPublic: room.isPublic,
    phase: room.phase,
    players: room.players.map(({ tokenHash: _tokenHash, lastGuessAt: _lastGuessAt, lastSeen, ...player }) => ({
      ...player,
      connected: now - lastSeen <= CONNECTED_WINDOW_MS,
    })),
    source: room.source,
    roundIndex: room.roundIndex,
    round: room.round && question ? {
      ...structuredClone(room.round),
      prompt: question.prompt,
      answers: question.answers.map((answer) => {
        const revealed = Object.hasOwn(room.round!.revealed, answer.id);
        return {
          id: answer.id,
          text: revealed || showAll ? answer.text : null,
          points: revealed || showAll ? answer.points : null,
          revealed,
          claimedBy: room.round!.revealed[answer.id] ?? null,
        };
      }),
    } : null,
    teamScores: [...room.teamScores],
    events: structuredClone(room.events),
    revision: room.revision,
    serverTime: now,
    error: room.error,
  };
}
