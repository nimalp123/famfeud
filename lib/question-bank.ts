import everyday from "../data/question-bank/everyday.json" with { type: "json" };
import food from "../data/question-bank/food.json" with { type: "json" };
import culture from "../data/question-bank/pop-culture.json" with { type: "json" };
import travel from "../data/question-bank/travel.json" with { type: "json" };
import games from "../data/question-bank/sports-games.json" with { type: "json" };
import { normalizeAnswer } from "./answers.ts";
import { QUESTION_CATEGORIES } from "./constants.ts";
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
  if (!Array.isArray(value.answers) || value.answers.length !== 6) {
    throw new Error(`Question ${value.id} must have six answers.`);
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
  if (!Array.isArray(value) || value.length !== 200) throw new Error("Question bank must contain exactly 200 rounds.");
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
    if (questions.filter((question) => question.category === category).length !== 40) {
      throw new Error(`Question bank must contain 40 rounds in ${category}.`);
    }
  }
  return questions;
}

let bank: BankQuestion[] | undefined;

export function readQuestionBank(): BankQuestion[] {
  bank ??= validateQuestionBank([...everyday, ...food, ...culture, ...travel, ...games]);
  return structuredClone(bank);
}

const seedRequests = new WeakMap<D1Database, Promise<void>>();

export async function ensureQuestionBank(database: D1Database): Promise<void> {
  let pending = seedRequests.get(database);
  if (!pending) {
    pending = database.prepare(
      `INSERT INTO question_bank (id, category, prompt, answers)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.category'),
              json_extract(value, '$.prompt'), json_extract(value, '$.answers')
       FROM json_each(?) WHERE true
       ON CONFLICT(id) DO UPDATE SET
         category = excluded.category, prompt = excluded.prompt, answers = excluded.answers
       WHERE question_bank.category != excluded.category
          OR question_bank.prompt != excluded.prompt
          OR question_bank.answers != excluded.answers`,
    ).bind(JSON.stringify(readQuestionBank())).run().then(() => undefined);
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
