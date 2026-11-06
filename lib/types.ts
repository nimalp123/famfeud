export type GameMode = "solo" | "teams";
export type RoomPhase = "lobby" | "generating" | "playing" | "round-ended" | "finished";
export type Team = 0 | 1;
export type QuestionSource = "bank" | "ai" | "curated";

export interface Answer {
  id: string;
  text: string;
  aliases: string[];
  points: number;
}

export interface Question {
  id: string;
  prompt: string;
  answers: Answer[];
}

export interface Player {
  id: string;
  tokenHash: string;
  name: string;
  avatar: number;
  team: Team | null;
  ready: boolean;
  score: number;
  joinedAt: number;
  lastSeen: number;
  lastGuessAt: number;
}

export interface RoomSettings {
  mode: GameMode;
  category: string;
  rounds: number;
  maxPlayers: number;
}

export interface GameEvent {
  id: string;
  text: string;
  kind: "info" | "correct" | "miss" | "system";
  at: number;
}

export interface RoundState {
  revealed: Record<string, string>;
  playerStrikes: Record<string, number>;
  teamStrikes: [number, number];
  activeTeam: Team;
  activePlayerId: string | null;
  turnIndex: [number, number];
  stealing: boolean;
  bank: number;
  deadline: number;
  endedReason: string | null;
}

export interface RoomState {
  code: string;
  hostId: string;
  settings: RoomSettings;
  isPublic: boolean;
  phase: RoomPhase;
  players: Player[];
  questions: Question[];
  source: QuestionSource;
  roundIndex: number;
  round: RoundState | null;
  teamScores: [number, number];
  events: GameEvent[];
  revision: number;
  createdAt: number;
  updatedAt: number;
  generationId: string | null;
  usedQuestionIds?: string[];
  error: string | null;
}

export interface PlayerView extends Omit<Player, "tokenHash" | "lastGuessAt" | "lastSeen"> {
  connected: boolean;
}

export interface AnswerView {
  id: string;
  text: string | null;
  points: number | null;
  revealed: boolean;
  claimedBy: string | null;
}

export interface RoundView extends RoundState {
  prompt: string;
  answers: AnswerView[];
}

export interface RoomView {
  code: string;
  hostId: string;
  settings: RoomSettings;
  isPublic: boolean;
  phase: RoomPhase;
  players: PlayerView[];
  source: QuestionSource;
  roundIndex: number;
  round: RoundView | null;
  teamScores: [number, number];
  events: GameEvent[];
  revision: number;
  serverTime: number;
  error: string | null;
}

export interface PublicRoom {
  code: string;
  hostName: string;
  mode: GameMode;
  category: string;
  players: number;
  maxPlayers: number;
}

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export type RoomAction =
  | { type: "ready"; ready: boolean }
  | { type: "settings"; settings: Partial<RoomSettings>; isPublic?: boolean }
  | { type: "team"; team: Team }
  | { type: "kick"; playerId: string }
  | { type: "leave" }
  | { type: "guess"; guess: string }
  | { type: "next" }
  | { type: "rematch" };

export type ClientAction = RoomAction | { type: "start" };

export interface ApiSessionResponse {
  session: Session;
  room: RoomView;
}

export interface RoomRepository {
  consumeRateLimit(scope: string, key: string, limit: number, windowMs: number, now: number): Promise<void>;
  get(code: string): Promise<RoomState>;
  create(room: RoomState): Promise<boolean>;
  mutate(code: string, update: (room: RoomState) => RoomState): Promise<RoomState>;
  listPublic(now: number): Promise<PublicRoom[]>;
}

export interface StoredQuestion {
  id: string;
  category: string;
  prompt: string;
  answers: unknown;
}

export interface GameBackend {
  rooms: RoomRepository;
  countQuestions(): Promise<number>;
  sampleQuestions(category: string, excludedIds: string[], limit: number): Promise<StoredQuestion[]>;
}

export type GameEnvironment =
  | { DB: D1Database; backend?: never }
  | { DB?: never; backend: GameBackend };
