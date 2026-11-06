import { QUESTION_CATEGORIES } from "./constants.ts";
import { ensureQuestionBank, playableQuestion, readQuestionBankIndex, validateBankQuestion } from "./question-bank.ts";
import type { GameEnvironment, Question, RoomSettings, StoredQuestion } from "./types.ts";
export { QUESTION_CATEGORIES } from "./constants.ts";

export interface QuestionSelection {
  questions: Question[];
  source: "bank";
  usedQuestionIds: string[];
}

async function sampleQuestions(
  environment: GameEnvironment,
  category: string,
  excludedIds: string[],
  limit: number,
): Promise<StoredQuestion[]> {
  if (environment.backend) return environment.backend.sampleQuestions(category, excludedIds, limit);
  const result = await environment.DB.prepare(
    `SELECT id, category, prompt, answers FROM question_bank
     WHERE (? = 'Anything goes' OR category = ?)
       AND id NOT IN (SELECT value FROM json_each(?))
     ORDER BY RANDOM() LIMIT ?`,
  ).bind(category, category, JSON.stringify(excludedIds), limit).all<StoredQuestion>();
  return result.results;
}

/** Select stored rounds, completing the current cycle before reusing a question. */
export async function generateQuestions(
  settings: RoomSettings,
  environment: GameEnvironment,
  previousQuestionIds: string[] = [],
): Promise<QuestionSelection> {
  if (!QUESTION_CATEGORIES.includes(settings.category as typeof QUESTION_CATEGORIES[number]) ||
      !Number.isInteger(settings.rounds) || settings.rounds < 3 || settings.rounds > 5) {
    throw new Error("Choose a valid category and between three and five rounds.");
  }
  if (environment.DB) await ensureQuestionBank(environment.DB);
  const bank = readQuestionBankIndex();
  const knownIds = new Set(bank.map((question) => question.id));
  const previous = [...new Set(previousQuestionIds)].filter((id) => knownIds.has(id));
  const categoryIds = new Set(bank.filter((question) => settings.category === "Anything goes" || question.category === settings.category).map((question) => question.id));
  const rows = await sampleQuestions(environment, settings.category, previous, settings.rounds);
  let usedQuestionIds = previous;
  if (rows.length < settings.rounds) {
    const nextCycle = await sampleQuestions(environment, settings.category, rows.map((question) => question.id), settings.rounds - rows.length);
    rows.push(...nextCycle);
    usedQuestionIds = previous.filter((id) => !categoryIds.has(id));
  }
  if (rows.length !== settings.rounds) throw new Error("The question bank is not ready. Please try again.");
  const questions = rows.map((row) => playableQuestion(validateBankQuestion({
    id: row.id, category: row.category, prompt: row.prompt,
    answers: typeof row.answers === "string" ? JSON.parse(row.answers) : row.answers,
  })));
  return { questions, source: "bank", usedQuestionIds: [...new Set([...usedQuestionIds, ...questions.map((question) => question.id)])] };
}
