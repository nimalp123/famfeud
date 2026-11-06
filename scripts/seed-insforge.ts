import { createAdminClient } from "@insforge/sdk";
import { readQuestionBank } from "../lib/question-bank.ts";

const baseUrl = process.env.INSFORGE_URL;
const apiKey = process.env.INSFORGE_API_KEY;
if (!baseUrl || !apiKey) throw new Error("Set the server-only InsForge environment variables first.");

const client = createAdminClient({ baseUrl, apiKey });
const questions = readQuestionBank();
const { error } = await client.database.from("question_bank").upsert(questions, { onConflict: "id" });
if (error) throw new Error(`Question bank import failed: ${error.message}`);

const { count, error: countError } = await client.database.from("question_bank")
  .select("id", { count: "exact", head: true });
if (countError || count !== questions.length) throw new Error("The imported question count does not match the source bank.");
console.log(JSON.stringify({ imported: questions.length, stored: count }));
