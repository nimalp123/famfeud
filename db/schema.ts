import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(0),
  isPublic: integer("is_public").notNull().default(0),
  phase: text("phase").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("rooms_public_lobby_idx").on(table.isPublic, table.phase, table.updatedAt)]);

export const rateLimits = sqliteTable("rate_limits", {
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  windowStart: integer("window_start").notNull(),
  hits: integer("hits").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [primaryKey({ columns: [table.scope, table.key] })]);

export const questionBank = sqliteTable("question_bank", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  prompt: text("prompt").notNull().unique(),
  answers: text("answers").notNull(),
}, (table) => [index("question_bank_category_idx").on(table.category)]);
