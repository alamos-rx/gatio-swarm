import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["topic", "direct"] }).notNull(),
  topicId: text("topic_id").references(() => topics.id),
  senderId: text("sender_id").notNull().references(() => users.id),
  recipientId: text("recipient_id").references(() => users.id),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const suggestions = sqliteTable("suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  authorId: text("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type User = typeof users.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Suggestion = typeof suggestions.$inferSelect;
