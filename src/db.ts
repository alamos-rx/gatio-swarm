import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDatabase>["db"];

export function createDatabase(filename = process.env.DATABASE_PATH ?? "data/gatio.sqlite") {
  const target = filename === ":memory:" ? filename : resolve(filename);
  if (target !== ":memory:") mkdirSync(dirname(target), { recursive: true });

  const sqlite = new Database(target);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('topic', 'direct')),
      topic_id TEXT REFERENCES topics(id),
      sender_id TEXT NOT NULL REFERENCES users(id),
      recipient_id TEXT REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (kind = 'topic' AND topic_id IS NOT NULL AND recipient_id IS NULL) OR
        (kind = 'direct' AND topic_id IS NULL AND recipient_id IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS messages_topic_id_idx ON messages(topic_id, id);
    CREATE INDEX IF NOT EXISTS messages_recipient_id_idx ON messages(recipient_id, id);
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS suggestions_id_idx ON suggestions(id);
  `);

  return { db: drizzle(sqlite, { schema }), sqlite };
}
