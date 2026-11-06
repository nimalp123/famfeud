import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { generateQuestions, QUESTION_CATEGORIES } from "../lib/questions.ts";
import { ensureQuestionBank, questionCount, readQuestionBank, validateBankQuestion, validateQuestionBank } from "../lib/question-bank.ts";
import type { RoomSettings } from "../lib/types.ts";

const settings: RoomSettings = { mode: "solo", category: "Anything goes", rounds: 5, maxPlayers: 6 };

async function databaseFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".sql")).sort()) {
    sqlite.exec(await readFile(new URL(name, directory), "utf8"));
  }
  function prepare(sql: string, values: Array<string | number> = []) {
    function execute() {
      const result = sqlite.prepare(sql).run(...values);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    }
    return {
      bind(...parameters: Array<string | number>) { return prepare(sql, parameters); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values), success: true, meta: {} }; },
      async run() { return execute(); },
      execute,
    };
  }
  const database = {
    prepare,
    async batch(statements: Array<ReturnType<typeof prepare>>) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, DB: database as unknown as D1Database };
}

test("the stored bank contains 2,000 distinct rounds and 12,000 ranked answers", () => {
  const bank = readQuestionBank();
  assert.equal(bank.length, 2000);
  assert.equal(new Set(bank.map((question) => question.id)).size, 2000);
  assert.equal(new Set(bank.map((question) => question.prompt.toLowerCase())).size, 2000);
  assert.equal(bank.flatMap((question) => question.answers).length, 12000);
  for (const category of QUESTION_CATEGORIES.filter((entry) => entry !== "Anything goes")) {
    assert.equal(bank.filter((question) => question.category === category).length, 400);
  }
  for (const question of bank) {
    assert.equal(question.answers.reduce((sum, answer) => sum + answer.points, 0), 100);
    assert.equal(question.answers.length, 6);
  }
});

test("bank validation rejects duplicate, malformed and ambiguous questions", () => {
  const bank = readQuestionBank();
  assert.throws(() => validateQuestionBank([]), /2,?000/);
  const duplicated = structuredClone(bank);
  duplicated[1] = duplicated[0];
  assert.throws(() => validateQuestionBank(duplicated), /repeats/);
  const badPoints = structuredClone(bank[0]);
  badPoints.answers[0].points += 1;
  assert.throws(() => validateBankQuestion(badPoints), /100/);
  const ambiguous = structuredClone(bank[0]);
  ambiguous.answers[0] = { text: "Library", aliases: ["books"], points: 30 };
  ambiguous.answers[1] = { text: "Bookstore", aliases: ["book"], points: 24 };
  assert.throws(() => validateBankQuestion(ambiguous), /ambiguous/);
  const malformed = structuredClone(bank[0]);
  malformed.prompt = "";
  assert.throws(() => validateBankQuestion(malformed), /invalid/);
});

test("D1 seeding is idempotent and persists every stored answer", async () => {
  const fixture = await databaseFixture();
  try {
    await Promise.all([ensureQuestionBank(fixture.DB), ensureQuestionBank(fixture.DB)]);
    assert.equal(await questionCount(fixture.DB), 2000);
    const firstChanges = fixture.sqlite.prepare("SELECT total_changes() AS count").get()!.count;
    await ensureQuestionBank(fixture.DB);
    await questionCount(fixture.DB);
    assert.equal(fixture.sqlite.prepare("SELECT total_changes() AS count").get()!.count, firstChanges);
    const rows = fixture.sqlite.prepare("SELECT answers FROM question_bank").all();
    assert.equal(rows.flatMap((row) => JSON.parse(row.answers as string)).length, 12000);
  } finally { fixture.sqlite.close(); }
});

test("a new binding with an older content marker refreshes authored rows without duplicates", async () => {
  const fixture = await databaseFixture();
  try {
    await ensureQuestionBank(fixture.DB);
    const original = readQuestionBank()[0];
    fixture.sqlite.prepare("UPDATE question_bank SET prompt = ? WHERE id = ?").run("Older question wording", original.id);
    fixture.sqlite.prepare("UPDATE question_bank_metadata SET content_hash = ? WHERE id = ?").run("older-version", "authored");
    const reloadedBinding = {
      prepare: fixture.DB.prepare.bind(fixture.DB),
      batch: fixture.DB.batch.bind(fixture.DB),
    } as unknown as D1Database;
    await ensureQuestionBank(reloadedBinding);
    assert.equal(fixture.sqlite.prepare("SELECT prompt FROM question_bank WHERE id = ?").get(original.id)!.prompt, original.prompt);
    assert.equal(await questionCount(reloadedBinding), 2000);
  } finally { fixture.sqlite.close(); }
});

test("a cold binding with the current content marker does not rewrite the bank", async () => {
  const fixture = await databaseFixture();
  try {
    await ensureQuestionBank(fixture.DB);
    const changes = fixture.sqlite.prepare("SELECT total_changes() AS count").get()!.count;
    const coldBinding = {
      prepare: fixture.DB.prepare.bind(fixture.DB),
      batch: fixture.DB.batch.bind(fixture.DB),
    } as unknown as D1Database;
    assert.equal(await questionCount(coldBinding), 2000);
    assert.equal(fixture.sqlite.prepare("SELECT total_changes() AS count").get()!.count, changes);
  } finally { fixture.sqlite.close(); }
});

test("a failed seed batch rolls back all rows and the content marker before retrying", async () => {
  const fixture = await databaseFixture();
  try {
    const rejectedId = readQuestionBank()[250].id;
    assert.match(rejectedId, /^[a-z0-9-]+$/);
    fixture.sqlite.exec(`CREATE TEMP TRIGGER reject_question BEFORE INSERT ON question_bank
      WHEN NEW.id = '${rejectedId}' BEGIN SELECT RAISE(ABORT, 'forced seed failure'); END`);
    await assert.rejects(ensureQuestionBank(fixture.DB), /forced seed failure/);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM question_bank").get()!.count, 0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM question_bank_metadata").get()!.count, 0);
    fixture.sqlite.exec("DROP TRIGGER reject_question");
    assert.equal(await questionCount(fixture.DB), 2000);
    assert.equal(fixture.sqlite.prepare("SELECT question_count FROM question_bank_metadata WHERE id = ?").get("authored")!.question_count, 2000);
  } finally { fixture.sqlite.close(); }
});

test("every category is selected from stored rows with stable answer IDs", async () => {
  const fixture = await databaseFixture();
  try {
    for (const category of QUESTION_CATEGORIES) {
      const result = await generateQuestions({ ...settings, category }, fixture);
      assert.equal(result.source, "bank");
      assert.equal(result.questions.length, 5);
      for (const question of result.questions) {
        const row = fixture.sqlite.prepare("SELECT category FROM question_bank WHERE id = ?").get(question.id);
        assert.ok(row);
        if (category !== "Anything goes") assert.equal(row.category, category);
        assert.deepEqual(question.answers.map((answer) => answer.id), [1, 2, 3, 4, 5, 6].map((index) => `${question.id}-${index}`));
      }
    }
  } finally { fixture.sqlite.close(); }
});

for (const [category, poolSize] of [["Everyday life", 400], ["Anything goes", 2000]] as const) {
  test(`${category} finishes all ${poolSize} questions before beginning its next cycle`, async () => {
    const fixture = await databaseFixture();
    try {
      let used: string[] = [];
      const seen = new Set<string>();
      for (let match = 0; match < poolSize / settings.rounds; match += 1) {
        const result = await generateQuestions({ ...settings, category }, fixture, used);
        for (const question of result.questions) {
          assert.equal(seen.has(question.id), false, `${question.id} repeated before its pool was exhausted`);
          seen.add(question.id);
        }
        used = result.usedQuestionIds;
      }
      assert.equal(seen.size, poolSize);
      const rollover = await generateQuestions({ ...settings, category }, fixture, used);
      assert.equal(rollover.questions.length, 5);
      assert.equal(new Set(rollover.questions.map((question) => question.id)).size, 5);
      assert.equal(rollover.usedQuestionIds.length, 5);
      assert.ok(rollover.questions.every((question) => seen.has(question.id)));
    } finally { fixture.sqlite.close(); }
  });
}

test("a game spans a cycle boundary without duplicating a question", async () => {
  const fixture = await databaseFixture();
  try {
    const food = readQuestionBank().filter((question) => question.category === "Food & drink");
    const unrelated = readQuestionBank().filter((question) => question.category === "Everyday life").slice(0, 3).map((question) => question.id);
    const previous = [...food.slice(0, -2).map((question) => question.id), ...unrelated];
    const result = await generateQuestions({ ...settings, category: "Food & drink" }, fixture, previous);
    assert.ok(food.slice(-2).every((remaining) => result.questions.some((question) => question.id === remaining.id)));
    assert.equal(new Set(result.questions.map((question) => question.id)).size, 5);
    assert.ok(unrelated.every((id) => result.usedQuestionIds.includes(id)));
  } finally { fixture.sqlite.close(); }
});

test("question selection makes no outbound request", async () => {
  const fixture = await databaseFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Network use is forbidden for stored questions."); };
  try {
    const result = await generateQuestions(settings, fixture);
    assert.equal(result.questions.length, 5);
    await assert.rejects(generateQuestions({ ...settings, category: "Unknown" }, fixture), /valid category/);
    await assert.rejects(generateQuestions({ ...settings, rounds: 1 }, fixture), /three and five/);
  } finally { globalThis.fetch = originalFetch; fixture.sqlite.close(); }
});
