import { QUESTION_CATEGORIES } from "./constants.ts";
import { ensureQuestionBank, playableQuestion, readQuestionBankIndex, validateBankQuestion } from "./question-bank.ts";
import type { Question, RoomSettings } from "./types.ts";
export { QUESTION_CATEGORIES } from "./constants.ts";

interface QuestionRow {
  id: string;
  category: string;
  prompt: string;
  answers: string;
}

export interface QuestionSelection {
  questions: Question[];
  source: "bank";
  usedQuestionIds: string[];
}

/** Select stored rounds, completing the current cycle before reusing a question. */
export async function generateQuestions(
  settings: RoomSettings,
  environment: { DB: D1Database },
  previousQuestionIds: string[] = [],
): Promise<QuestionSelection> {
  if (!QUESTION_CATEGORIES.includes(settings.category as typeof QUESTION_CATEGORIES[number]) ||
      !Number.isInteger(settings.rounds) || settings.rounds < 3 || settings.rounds > 5) {
    throw new Error("Choose a valid category and between three and five rounds.");
  }
  await ensureQuestionBank(environment.DB);
  const bank = readQuestionBankIndex();
  const knownIds = new Set(bank.map((question) => question.id));
  const previous = [...new Set(previousQuestionIds)].filter((id) => knownIds.has(id));
  const categoryIds = new Set(bank.filter((question) => settings.category === "Anything goes" || question.category === settings.category).map((question) => question.id));
  const fresh = await environment.DB.prepare(
    `SELECT id, category, prompt, answers FROM question_bank
     WHERE (? = 'Anything goes' OR category = ?)
       AND id NOT IN (SELECT value FROM json_each(?))
     ORDER BY RANDOM() LIMIT ?`,
  ).bind(settings.category, settings.category, JSON.stringify(previous), settings.rounds).all<QuestionRow>();
  const rows = fresh.results;
  let usedQuestionIds = previous;
  if (rows.length < settings.rounds) {
    const nextCycle = await environment.DB.prepare(
      `SELECT id, category, prompt, answers FROM question_bank
       WHERE (? = 'Anything goes' OR category = ?)
         AND id NOT IN (SELECT value FROM json_each(?))
       ORDER BY RANDOM() LIMIT ?`,
    ).bind(settings.category, settings.category, JSON.stringify(rows.map((question) => question.id)), settings.rounds - rows.length).all<QuestionRow>();
    rows.push(...nextCycle.results);
    usedQuestionIds = previous.filter((id) => !categoryIds.has(id));
  }
  if (rows.length !== settings.rounds) throw new Error("The question bank is not ready. Please try again.");
  const questions = rows.map((row) => playableQuestion(validateBankQuestion({
    id: row.id, category: row.category, prompt: row.prompt, answers: JSON.parse(row.answers),
  })));
  return { questions, source: "bank", usedQuestionIds: [...new Set([...usedQuestionIds, ...questions.map((question) => question.id)])] };
}
