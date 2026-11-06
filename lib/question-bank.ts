import everyday from "../data/question-bank/everyday.json" with { type: "json" };
import everydayB from "../data/question-bank/everyday-b.json" with { type: "json" };
import everydayC from "../data/question-bank/everyday-c.json" with { type: "json" };
import everydayD from "../data/question-bank/everyday-d.json" with { type: "json" };
import everydayE from "../data/question-bank/everyday-e.json" with { type: "json" };
import food from "../data/question-bank/food.json" with { type: "json" };
import foodB from "../data/question-bank/food-b.json" with { type: "json" };
import foodC from "../data/question-bank/food-c.json" with { type: "json" };
import foodD from "../data/question-bank/food-d.json" with { type: "json" };
import foodE from "../data/question-bank/food-e.json" with { type: "json" };
import culture from "../data/question-bank/pop-culture.json" with { type: "json" };
import cultureB from "../data/question-bank/pop-culture-b.json" with { type: "json" };
import cultureC from "../data/question-bank/pop-culture-c.json" with { type: "json" };
import cultureD from "../data/question-bank/pop-culture-d.json" with { type: "json" };
import cultureE from "../data/question-bank/pop-culture-e.json" with { type: "json" };
import travel from "../data/question-bank/travel.json" with { type: "json" };
import travelB from "../data/question-bank/travel-b.json" with { type: "json" };
import travelC from "../data/question-bank/travel-c.json" with { type: "json" };
import travelD from "../data/question-bank/travel-d.json" with { type: "json" };
import travelE from "../data/question-bank/travel-e.json" with { type: "json" };
import games from "../data/question-bank/sports-games.json" with { type: "json" };
import gamesB from "../data/question-bank/sports-games-b.json" with { type: "json" };
import gamesC from "../data/question-bank/sports-games-c.json" with { type: "json" };
import gamesD from "../data/question-bank/sports-games-d.json" with { type: "json" };
import gamesE from "../data/question-bank/sports-games-e.json" with { type: "json" };
import { normalizeAnswer } from "./answers.ts";
import { QUESTION_ANSWER_COUNT, QUESTION_BANK_COUNT, QUESTION_CATEGORIES, QUESTION_CATEGORY_COUNT } from "./constants.ts";
import type { Answer, Question } from "./types.ts";

export interface BankAnswer {
  text: string;
  aliases: string[];
  points: number;
}

export interface BankQuestion {
  id: string;
  category: string;
  prompt: string;
  answers: BankAnswer[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Question bank contains an invalid ${field}.`);
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || text.length > maximum || !normalizeAnswer(text)) {
    throw new Error(`Question bank contains an invalid ${field}.`);
  }
  return text;
}

export function validateBankQuestion(value: unknown): BankQuestion {
  if (!isObject(value) || typeof value.id !== "string" || !/^[a-z0-9-]{1,70}$/.test(value.id)) {
    throw new Error("Question bank contains an invalid question ID.");
  }
  if (typeof value.category !== "string" || value.category === "Anything goes" ||
      !QUESTION_CATEGORIES.includes(value.category as typeof QUESTION_CATEGORIES[number])) {
    throw new Error(`Question ${value.id} has an invalid category.`);
  }
  if (!Array.isArray(value.answers) || value.answers.length !== QUESTION_ANSWER_COUNT) {
    throw new Error(`Question ${value.id} must have ${QUESTION_ANSWER_COUNT} answers.`);
  }
  const usedLabels = new Set<string>();
  const answers = value.answers.map((rawAnswer): BankAnswer => {
    if (!isObject(rawAnswer) || !Array.isArray(rawAnswer.aliases) || rawAnswer.aliases.length > 10 ||
        !Number.isInteger(rawAnswer.points) || (rawAnswer.points as number) < 1 || (rawAnswer.points as number) > 100) {
      throw new Error(`Question ${value.id} has an invalid answer.`);
    }
    const text = cleanText(rawAnswer.text, 60, "answer");
    const aliases = rawAnswer.aliases.map((alias) => cleanText(alias, 60, "alias"));
    const labels = new Set([text, ...aliases].map(normalizeAnswer));
    for (const label of labels) {
      if (usedLabels.has(label)) throw new Error(`Question ${value.id} has ambiguous answer aliases.`);
      usedLabels.add(label);
    }
    const canonical = normalizeAnswer(text);
    const distinctAliases = new Map(aliases.map((alias) => [normalizeAnswer(alias), alias]));
    distinctAliases.delete(canonical);
    return { text, aliases: [...distinctAliases.values()], points: rawAnswer.points as number };
  });
  if (answers.reduce((total, answer) => total + answer.points, 0) !== 100) {
    throw new Error(`Question ${value.id} must total 100 points.`);
  }
  if (answers.some((answer, index) => index > 0 && answer.points > answers[index - 1].points)) {
    throw new Error(`Question ${value.id} answers must be ranked by points.`);
  }
  return { id: value.id, category: value.category, prompt: cleanText(value.prompt, 180, "prompt"), answers };
}

export function validateQuestionBank(value: unknown): BankQuestion[] {
  if (!Array.isArray(value) || value.length !== QUESTION_BANK_COUNT) {
    throw new Error(`Question bank must contain exactly ${QUESTION_BANK_COUNT} rounds.`);
  }
  const questions = value.map(validateBankQuestion);
  const ids = new Set<string>();
  const prompts = new Set<string>();
  for (const question of questions) {
    const prompt = normalizeAnswer(question.prompt);
    if (ids.has(question.id) || prompts.has(prompt)) throw new Error(`Question ${question.id} repeats a question ID or prompt.`);
    ids.add(question.id);
    prompts.add(prompt);
  }
  for (const category of QUESTION_CATEGORIES.filter((entry) => entry !== "Anything goes")) {
    if (questions.filter((question) => question.category === category).length !== QUESTION_CATEGORY_COUNT) {
      throw new Error(`Question bank must contain ${QUESTION_CATEGORY_COUNT} rounds in ${category}.`);
    }
  }
  return questions;
}

let bank: BankQuestion[] | undefined;
let bankIndex: ReadonlyArray<Readonly<Pick<BankQuestion, "id" | "category">>> | undefined;

function getQuestionBank(): BankQuestion[] {
  bank ??= validateQuestionBank([
    ...everyday, ...everydayB, ...everydayC, ...everydayD, ...everydayE,
    ...food, ...foodB, ...foodC, ...foodD, ...foodE,
    ...culture, ...cultureB, ...cultureC, ...cultureD, ...cultureE,
    ...travel, ...travelB, ...travelC, ...travelD, ...travelE,
    ...games, ...gamesB, ...gamesC, ...gamesD, ...gamesE,
  ]);
  return bank;
}

export function readQuestionBank(): BankQuestion[] {
  return structuredClone(getQuestionBank());
}

/** Reuse immutable metadata for selection instead of copying every hidden board. */
export function readQuestionBankIndex(): ReadonlyArray<Readonly<Pick<BankQuestion, "id" | "category">>> {
  bankIndex ??= Object.freeze(getQuestionBank().map(({ id, category }) => Object.freeze({ id, category })));
  return bankIndex;
}

const seedRequests = new WeakMap<D1Database, Promise<void>>();
const SEED_CHUNK_SIZE = 200;
const BANK_METADATA_ID = "authored";
let seedPayload: Promise<{ contentHash: string; chunks: string[] }> | undefined;

function getSeedPayload(): Promise<{ contentHash: string; chunks: string[] }> {
  seedPayload ??= (async () => {
    const questions = getQuestionBank();
    const bytes = new TextEncoder().encode(JSON.stringify(questions));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const contentHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const chunks: string[] = [];
    for (let offset = 0; offset < questions.length; offset += SEED_CHUNK_SIZE) {
      chunks.push(JSON.stringify(questions.slice(offset, offset + SEED_CHUNK_SIZE)));
    }
    return { contentHash, chunks };
  })();
  return seedPayload;
}

async function seedQuestionBank(database: D1Database): Promise<void> {
  const { contentHash, chunks } = await getSeedPayload();
  const metadata = await database.prepare(
    "SELECT content_hash, question_count FROM question_bank_metadata WHERE id = ?",
  ).bind(BANK_METADATA_ID).first<{ content_hash: string; question_count: number }>();
  if (metadata?.content_hash === contentHash && metadata.question_count === QUESTION_BANK_COUNT) return;

  const statements = chunks.map((chunk) => database.prepare(
    `INSERT INTO question_bank (id, category, prompt, answers)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.category'),
            json_extract(value, '$.prompt'), json_extract(value, '$.answers')
     FROM json_each(?) WHERE true
     ON CONFLICT(id) DO UPDATE SET
       category = excluded.category, prompt = excluded.prompt, answers = excluded.answers
     WHERE question_bank.category != excluded.category
        OR question_bank.prompt != excluded.prompt
        OR question_bank.answers != excluded.answers`,
  ).bind(chunk));
  statements.push(database.prepare(
    `INSERT INTO question_bank_metadata (id, content_hash, question_count) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content_hash = excluded.content_hash, question_count = excluded.question_count
     WHERE question_bank_metadata.content_hash != excluded.content_hash
        OR question_bank_metadata.question_count != excluded.question_count`,
  ).bind(BANK_METADATA_ID, contentHash, QUESTION_BANK_COUNT));

  // D1 batch is transactional: a failed chunk cannot publish the revision marker.
  // Ten bounded JSON parameters plus the marker remain below the per-request query limit.
  await database.batch(statements);
}

export async function ensureQuestionBank(database: D1Database): Promise<void> {
  let pending = seedRequests.get(database);
  if (!pending) {
    pending = seedQuestionBank(database);
    seedRequests.set(database, pending);
  }
  try {
    await pending;
  } catch (error) {
    seedRequests.delete(database);
    throw error;
  }
}

export async function questionCount(database: D1Database): Promise<number> {
  await ensureQuestionBank(database);
  const result = await database.prepare("SELECT COUNT(*) AS count FROM question_bank").first<{ count: number }>();
  return result?.count ?? 0;
}

export function playableQuestion(question: BankQuestion): Question {
  return {
    id: question.id,
    prompt: question.prompt,
    answers: question.answers.map((answer, index): Answer => ({ ...answer, id: `${question.id}-${index + 1}` })),
  };
}
