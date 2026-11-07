import assert from "node:assert/strict";
import test from "node:test";
import { addPlayer, advanceTime, applyAction, createRoom, startGame, toRoomView, validateSettings } from "../lib/game.ts";
import { playableQuestion, readQuestionBank } from "../lib/question-bank.ts";
import type { GameMode, Player, Question, RoomState } from "../lib/types.ts";

const NOW = 1_000_000;

function player(id: string): Player {
  return { id, name: id, tokenHash: `secret-${id}`, avatar: 0, team: null, ready: false, score: 0, joinedAt: NOW, lastSeen: NOW, lastGuessAt: 0 };
}

function question(id = "q1"): Question {
  return {
    id,
    prompt: "Name a frozen dessert.",
    answers: [
      { id: "a1", text: "Ice cream", aliases: ["gelato"], points: 60 },
      { id: "a2", text: "Popsicle", aliases: ["ice pop"], points: 40 },
    ],
  };
}

function lobby(mode: GameMode = "solo", count = 2, rounds = 3): RoomState {
  let room = createRoom({ code: "ABCDEF", player: player("p1"), settings: { mode, category: "Everyday life", rounds, maxPlayers: 12 }, now: NOW });
  for (let i = 2; i <= count; i += 1) room = addPlayer(room, player(`p${i}`), NOW);
  for (const entry of room.players) room = applyAction(room, entry.id, { type: "ready", ready: true }, NOW);
  return room;
}

function game(mode: GameMode = "solo", count = 2, rounds = 3): RoomState {
  return startGame(lobby(mode, count, rounds), Array.from({ length: rounds }, (_, index) => question(`q${index}`)), "ai", NOW);
}

test("private lobby defaults, balanced joining, immutable actions and visibility", () => {
  const initial = lobby("teams", 3);
  assert.equal(initial.isPublic, false);
  assert.deepEqual(initial.players.map((entry) => entry.team), [0, 1, 0]);
  const updated = applyAction(initial, "p1", { type: "settings", settings: {}, isPublic: true }, NOW + 1);
  assert.equal(updated.isPublic, true);
  assert.equal(initial.isPublic, false);
  assert.equal(updated.revision, initial.revision);
  assert.throws(() => applyAction(initial, "p2", { type: "settings", settings: {}, isPublic: true }, NOW), /Only the host/);
});

test("changing modes rebalances teams and resets guest readiness", () => {
  const changed = applyAction(lobby("solo", 4), "p1", { type: "settings", settings: { mode: "teams" } }, NOW + 1);
  assert.deepEqual(changed.players.map((entry) => entry.team), [0, 1, 0, 1]);
  assert.deepEqual(changed.players.map((entry) => entry.ready), [true, false, false, false]);
});

test("start enforces players, readiness, balanced teams and valid points", () => {
  const onePlayer = createRoom({ code: "ABCDEF", player: player("p1"), settings: { mode: "solo", category: "Everyday life", rounds: 3, maxPlayers: 2 }, now: NOW });
  assert.throws(() => startGame(onePlayer, [question()], "ai", NOW), /at least 2/);
  const unready = addPlayer(onePlayer, player("p2"), NOW);
  assert.throws(() => startGame(unready, [question()], "ai", NOW), /needs to be ready/);
  const unbalanced = applyAction(lobby("teams", 4), "p2", { type: "team", team: 0 }, NOW);
  const ready = applyAction(unbalanced, "p2", { type: "ready", ready: true }, NOW);
  assert.throws(() => startGame(ready, [question()], "ai", NOW), /balanced teams/);
  const invalid = question();
  invalid.answers[0].points = 59;
  assert.throws(() => startGame(lobby(), [invalid, question("q2"), question("q3")], "ai", NOW), /total 100/);
});

test("views conceal every unrevealed answer, aliases, tokens and future questions", () => {
  const room = game("solo", 2, 3);
  room.questions[1].prompt = "UNSEEN FUTURE PROMPT";
  const view = toRoomView(room, NOW);
  const encoded = JSON.stringify(view);
  for (const hidden of ["Ice cream", "Popsicle", "gelato", "secret-", "UNSEEN FUTURE PROMPT", "tokenHash", "questions"]) assert.equal(encoded.includes(hidden), false, hidden);
  assert.deepEqual(view.round?.answers.map((answer) => [answer.text, answer.points]), [[null, null], [null, null]]);
});

test("solo race claims each answer once and accepts aliases and small typos", () => {
  const initial = game();
  const first = applyAction(initial, "p1", { type: "guess", guess: "GELATO" }, NOW + 1000);
  assert.equal(first.players[0].score, 60);
  assert.equal(initial.players[0].score, 0);
  assert.throws(() => applyAction(first, "p2", { type: "guess", guess: "ice cream" }, NOW + 2000), /already on the board/);
  const done = applyAction(first, "p2", { type: "guess", guess: "popsikle" }, NOW + 2000);
  assert.equal(done.phase, "round-ended");
  assert.equal(done.players[1].score, 40);
  assert.equal(done.round?.bank, 100);
  assert.equal(toRoomView(done, NOW + 2000).round?.answers[0].text, "Ice cream");
});

test("solo third strike locks player and all exhausted players end the round", () => {
  let room = game();
  for (let i = 0; i < 3; i += 1) room = applyAction(room, "p1", { type: "guess", guess: "broccoli" }, NOW + 1000 + i * 1000);
  assert.throws(() => applyAction(room, "p1", { type: "guess", guess: "ice cream" }, NOW + 5000), /out of guesses/);
  for (let i = 0; i < 3; i += 1) room = applyAction(room, "p2", { type: "guess", guess: "broccoli" }, NOW + 6000 + i * 1000);
  assert.equal(room.phase, "round-ended");
  assert.equal(toRoomView(room, NOW + 10_000).round?.answers[1].text, "Popsicle");
});

test("solo timer ends at server deadline and repeated checks have no effects", () => {
  const initial = game();
  assert.equal(advanceTime(initial, NOW + 59_999), initial);
  const ended = advanceTime(initial, NOW + 60_000);
  assert.equal(ended.phase, "round-ended");
  assert.equal(advanceTime(ended, NOW + 90_000), ended);
});

test("team turns rotate within a team and incorrect answers do not change bank", () => {
  let room = game("teams", 4);
  assert.equal(room.round?.activePlayerId, "p1");
  assert.throws(() => applyAction(room, "p2", { type: "guess", guess: "ice cream" }, NOW + 1000), /your turn/);
  room = applyAction(room, "p1", { type: "guess", guess: "ice cream" }, NOW + 1000);
  assert.equal(room.round?.activePlayerId, "p3");
  room = applyAction(room, "p3", { type: "guess", guess: "broccoli" }, NOW + 2000);
  assert.equal(room.round?.activePlayerId, "p1");
  assert.equal(room.round?.bank, 60);
  assert.deepEqual(room.round?.teamStrikes, [1, 0]);
});

test("three team misses open one steal and success awards the entire bank once", () => {
  let room = game("teams");
  room = applyAction(room, "p1", { type: "guess", guess: "ice cream" }, NOW + 1000);
  for (let i = 0; i < 3; i += 1) room = applyAction(room, "p1", { type: "guess", guess: "broccoli" }, NOW + 2000 + i * 1000);
  assert.equal(room.round?.stealing, true);
  assert.equal(room.round?.activePlayerId, "p2");
  room = applyAction(room, "p2", { type: "guess", guess: "ice pops" }, NOW + 6000);
  assert.equal(room.phase, "round-ended");
  assert.deepEqual(room.teamScores, [0, 100]);
  const later = advanceTime(room, NOW + 120_000);
  assert.deepEqual(later.teamScores, [0, 100]);
});

test("a failed steal awards the bank to the controlling team", () => {
  let room = game("teams");
  room = applyAction(room, "p1", { type: "guess", guess: "ice cream" }, NOW + 1000);
  for (let i = 0; i < 3; i += 1) room = applyAction(room, "p1", { type: "guess", guess: "broccoli" }, NOW + 2000 + i * 1000);
  room = applyAction(room, "p2", { type: "guess", guess: "broccoli" }, NOW + 6000);
  assert.deepEqual(room.teamScores, [60, 0]);
  assert.equal(room.phase, "round-ended");
});

test("timeouts advance team strikes and resolve the steal", () => {
  let room = game("teams");
  room = applyAction(room, "p1", { type: "guess", guess: "ice cream" }, NOW + 1000);
  for (let i = 0; i < 4; i += 1) room = advanceTime(room, room.round!.deadline);
  assert.equal(room.phase, "round-ended");
  assert.deepEqual(room.teamScores, [60, 0]);
});

test("host controls next round and rematch clears deck, scores and readiness", () => {
  let room = game("solo", 2, 3);
  room = advanceTime(room, NOW + 60_000);
  assert.throws(() => applyAction(room, "p2", { type: "next" }, NOW + 61_000), /Only the host/);
  room = applyAction(room, "p1", { type: "next" }, NOW + 61_000);
  assert.equal(room.roundIndex, 1);
  room = advanceTime(room, NOW + 121_000);
  room = applyAction(room, "p1", { type: "next" }, NOW + 122_000);
  assert.equal(room.roundIndex, 2);
  room = advanceTime(room, NOW + 182_000);
  room = applyAction(room, "p1", { type: "next" }, NOW + 183_000);
  assert.equal(room.phase, "finished");
  room = applyAction(room, "p1", { type: "rematch" }, NOW + 184_000);
  assert.equal(room.phase, "lobby");
  assert.deepEqual(room.questions, []);
  assert.equal(room.round, null);
  assert.deepEqual(room.players.map((entry) => entry.ready), [true, false]);
});

test("host departure transfers ownership and removal cannot leave an active match without an opponent", () => {
  const transferred = applyAction(lobby("solo", 3), "p1", { type: "leave" }, NOW + 1000);
  assert.equal(transferred.hostId, "p2");
  assert.equal(transferred.players[0].ready, true);
  const ended = applyAction(game("teams"), "p2", { type: "leave" }, NOW + 1000);
  assert.equal(ended.phase, "finished");
  assert.equal(ended.hostId, "p1");
});

test("leaving active team player selects a remaining teammate", () => {
  const room = applyAction(game("teams", 4), "p1", { type: "leave" }, NOW + 1000);
  assert.equal(room.phase, "playing");
  assert.equal(room.round?.activePlayerId, "p3");
  assert.equal(room.hostId, "p2");
});

test("settings and guess pacing reject invalid operations", () => {
  assert.throws(() => validateSettings({ mode: "solo", category: "", rounds: 3, maxPlayers: 2 }), /category/);
  assert.throws(() => validateSettings({ mode: "solo", category: "Everyday life", rounds: 6, maxPlayers: 2 }), /rounds/);
  const room = applyAction(game(), "p1", { type: "guess", guess: "broccoli" }, NOW + 1000);
  assert.throws(() => applyAction(room, "p1", { type: "guess", guess: "ice cream" }, NOW + 1100), /moment/);
  assert.throws(() => applyAction(room, "p1", { type: "settings", settings: {}, isPublic: true }, NOW + 2000), /lobby/);
});

test("only supported categories and three to five rounds can enter a lobby", () => {
  const settings = { mode: "solo" as const, category: "Anything goes", rounds: 3, maxPlayers: 6 };
  for (const rounds of [1, 2, 6, 3.5]) assert.throws(() => validateSettings({ ...settings, rounds }), /rounds/);
  for (const rounds of [3, 4, 5]) assert.equal(validateSettings({ ...settings, rounds }).rounds, rounds);
  assert.throws(() => validateSettings({ ...settings, category: "Unimplemented category" }), /category/);
  assert.equal(validateSettings({ ...settings, category: " Food & drink " }).category, "Food & drink");
});

test("answer validation rejects aliases that singularize to the same answer", () => {
  const ambiguous = question();
  ambiguous.answers = [
    { id: "a1", text: "Library", aliases: ["books"], points: 60 },
    { id: "a2", text: "Bookstore", aliases: ["book"], points: 40 },
  ];
  assert.throws(() => startGame(lobby(), [ambiguous, question("q2"), question("q3")], "ai", NOW), /overlapped/);
});

test("an exact match takes priority over another answer's fuzzy match", () => {
  const exact = question();
  exact.answers = [
    { id: "a1", text: "Kitten", aliases: ["Kittun"], points: 60 },
    { id: "a2", text: "Kittin", aliases: [], points: 40 },
  ];
  let room = startGame(lobby(), [exact, question("q2"), question("q3")], "ai", NOW);
  room = applyAction(room, "p1", { type: "guess", guess: "Kittin" }, NOW + 1000);
  assert.deepEqual(room.round?.revealed, { a2: "p1" });
  assert.equal(room.players[0].score, 40);
});

test("tied fuzzy answers do not claim either answer even with multiple matching aliases", () => {
  const ambiguous = question();
  ambiguous.answers = [
    { id: "a1", text: "Kitten", aliases: ["Kitton"], points: 60 },
    { id: "a2", text: "Kittan", aliases: [], points: 40 },
  ];
  let room = startGame(lobby(), [ambiguous, question("q2"), question("q3")], "ai", NOW);
  room = applyAction(room, "p1", { type: "guess", guess: "Kittin" }, NOW + 1000);
  assert.deepEqual(room.round?.revealed, {});
  assert.equal(room.players[0].score, 0);
  assert.equal(room.round?.playerStrikes.p1, 1);
});

function bankGame(id: string, mode: GameMode = "solo"): RoomState {
  const board = readQuestionBank().find((entry) => entry.id === id);
  assert.ok(board, id);
  return startGame(lobby(mode), [playableQuestion(board), question("q2"), question("q3")], "bank", NOW);
}

test("natural paraphrases score the existing Keep chatting answer in both modes", () => {
  for (const mode of ["solo", "teams"] as const) {
    for (const guess of ["talk", "start talking", "start talkign", "chattign", "chit-chat", "keep talking", "yapping", "have a conversation", "I'd say chat for a while"]) {
      const room = applyAction(bankGame("food-063", mode), "p1", { type: "guess", guess }, NOW + 1000);
      assert.equal(room.players[0].score, 24, guess);
      assert.equal(room.round?.revealed["food-063-2"], "p1", guess);
      assert.throws(() => applyAction(room, "p1", { type: "guess", guess: "talk" }, NOW + 2000), /already on the board/);
    }
  }
});

test("a broad guess does not choose between opposed answers", () => {
  const misspelled = applyAction(bankGame("everyday-390"), "p1", { type: "guess", guess: "start talkign" }, NOW + 1000);
  assert.deepEqual(misspelled.round?.revealed, {});
  let room = applyAction(bankGame("everyday-390"), "p1", { type: "guess", guess: "chat" }, NOW + 1000);
  assert.deepEqual(room.round?.revealed, {});
  room = applyAction(room, "p1", { type: "guess", guess: "start talking" }, NOW + 2000);
  assert.deepEqual(room.round?.revealed, {});
  room = applyAction(room, "p1", { type: "guess", guess: "stop chatting" }, NOW + 3000);
  room = applyAction(room, "p2", { type: "guess", guess: "continue chatting" }, NOW + 4000);
  assert.deepEqual(room.round?.revealed, { "everyday-390-1": "p1", "everyday-390-5": "p2" });
});

test("equivalent phrasing works across categories and a short guess can name the item", () => {
  for (const [id, guess, expected] of [
    ["travel-131", "doze off", "Take a nap"],
    ["travel-116", "take a pic", "Take a photo"],
    ["food-063", "coffee", "Order coffee"],
  ]) {
    const room = applyAction(bankGame(id), "p1", { type: "guess", guess }, NOW + 1000);
    const answer = toRoomView(room, NOW + 1000).round?.answers.find(({ text }) => text === expected);
    assert.ok(answer, guess);
    assert.equal(room.players[0].score, answer.points, guess);
  }
});

test("common typing errors score real board answers in both modes", () => {
  for (const mode of ["solo", "teams"] as const) {
    for (const [id, guess, expected] of [
      ["games-178", "sdoa", "Soda"],
      ["games-178", "sda", "Soda"],
      ["travel-250", "cofee", "Coffee"],
      ["travel-250", "cofffee", "Coffee"],
      ["travel-250", "choclate", "Chocolate"],
      ["travel-250", "choclaet", "Chocolate"],
      ["food-136", "cie crream", "Ice cream"],
      ["travel-319", "I'd say wlak", "Walking"],
    ]) {
      const room = applyAction(bankGame(id, mode), "p1", { type: "guess", guess }, NOW + 1000);
      const answer = room.questions[0].answers.find(({ text }) => text === expected);
      assert.ok(answer, expected);
      assert.equal(room.round?.revealed[answer.id], "p1", guess);
      assert.equal(room.players[0].score, answer.points, guess);
    }
  }
});

test("typing tolerance does not substitute another short word or number", () => {
  const board = question();
  board.answers = [
    { id: "a1", text: "Tea", aliases: [], points: 60 },
    { id: "a2", text: "10 dollars", aliases: [], points: 40 },
  ];
  const initial = startGame(lobby(), [board, question("q2"), question("q3")], "bank", NOW);
  for (const guess of ["sea", "20 dollars"]) {
    const room = applyAction(initial, "p1", { type: "guess", guess }, NOW + 1000);
    assert.deepEqual(room.round?.revealed, {}, guess);
  }
  const accepted = applyAction(initial, "p1", { type: "guess", guess: "tae" }, NOW + 1000);
  assert.equal(accepted.players[0].score, 60);
});

test("real short guesses and apostrophe-free negatives do not become different answers", () => {
  for (const [id, guess] of [
    ["everyday-122", "cart"],
    ["everyday-100", "coat"],
    ["food-317", "team"],
    ["games-364", "they cant rest"],
  ]) {
    const room = applyAction(bankGame(id), "p1", { type: "guess", guess }, NOW + 1000);
    assert.deepEqual(room.round?.revealed, {}, guess);
  }
});

test("negation, extra details, and multiple guesses do not receive typo credit", () => {
  const board = question();
  board.answers = [
    { id: "a1", text: "Hot coffee", aliases: [], points: 60 },
    { id: "a2", text: "Tea", aliases: [], points: 40 },
  ];
  const initial = startGame(lobby(), [board, question("q2"), question("q3")], "bank", NOW);
  for (const guess of ["not coffee", "coffee or tea", "hot coffee cake"]) {
    const room = applyAction(initial, "p1", { type: "guess", guess }, NOW + 1000);
    assert.equal(room.players[0].score, 0, guess);
    assert.equal(room.round?.playerStrikes.p1, 1, guess);
  }
});

test("a shared object does not make different actions equivalent", () => {
  const board = question();
  board.answers = [
    { id: "a1", text: "Take out their phone", aliases: [], points: 60 },
    { id: "a2", text: "Get a mentor", aliases: [], points: 40 },
  ];
  const initial = startGame(lobby(), [board, question("q2"), question("q3")], "bank", NOW);
  for (const guess of ["take away their phone", "order a mentor"]) {
    const room = applyAction(initial, "p1", { type: "guess", guess }, NOW + 1000);
    assert.equal(room.players[0].score, 0, guess);
  }
});

test("picturing someone does not mean taking a photo of them", () => {
  const initial = bankGame("games-197");
  const wrong = applyAction(initial, "p1", { type: "guess", guess: "picture them" }, NOW + 1000);
  const right = applyAction(initial, "p1", { type: "guess", guess: "take pictures of them" }, NOW + 1000);
  assert.equal(wrong.players[0].score, 0);
  assert.equal(right.players[0].score, 24);
});
