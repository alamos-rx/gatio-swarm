import { and, asc, eq, gt, or } from "drizzle-orm";
import type { Db } from "./db.js";
import { messages, suggestions, topics, users } from "./schema.js";

export class BoardError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const clean = (value: unknown, field: string, max: number) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BoardError(400, `${field} must be a non-empty string`);
  }
  const result = value.normalize("NFC").trim();
  if (result.length > max) throw new BoardError(400, `${field} exceeds ${max} characters`);
  // Plain human/LLM prose only: no markup, control bytes, emoji or opaque payloads.
  if (!/^[\p{L}\p{M}\p{N}\p{Zs}\r\n\t.,;:!?¿¡'"()\[\]\-_/@#%+=*]*$/u.test(result)) {
    throw new BoardError(400, `${field} contains characters outside the plain-text allowlist`);
  }
  return result;
};

const cleanId = (value: unknown, field: string) => {
  const id = clean(value, field, 64);
  if (!/^[\p{L}\p{M}\p{N}._@-]+$/u.test(id)) {
    throw new BoardError(400, `${field} may only contain letters, numbers, dot, underscore, @ or dash`);
  }
  return id;
};

const safeLimit = (value: unknown) => {
  const parsed = Number(value ?? 50);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
};

export function createBoard(db: Db) {
  const requireUser = (id: string) => {
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) throw new BoardError(404, `user '${id}' is not registered`);
    return user;
  };

  return {
    registerUser(rawId: unknown) {
      const id = cleanId(rawId, "id");
      db.insert(users).values({ id }).onConflictDoNothing().run();
      return db.select().from(users).where(eq(users.id, id)).get()!;
    },

    listUsers(after?: unknown, limit?: unknown) {
      const cursor = after === undefined ? undefined : cleanId(after, "after");
      return db.select().from(users)
        .where(cursor ? gt(users.id, cursor) : undefined)
        .orderBy(asc(users.id)).limit(safeLimit(limit)).all();
    },

    createTopic(rawId: unknown, rawTitle: unknown, rawCreator: unknown) {
      const id = cleanId(rawId, "id");
      const title = clean(rawTitle, "title", 160);
      const createdBy = cleanId(rawCreator, "createdBy");
      requireUser(createdBy);
      try {
        return db.insert(topics).values({ id, title, createdBy }).returning().get();
      } catch {
        throw new BoardError(409, `topic '${id}' already exists`);
      }
    },

    listTopics(after?: unknown, limit?: unknown) {
      const cursor = after === undefined ? undefined : cleanId(after, "after");
      return db.select().from(topics)
        .where(cursor ? gt(topics.id, cursor) : undefined)
        .orderBy(asc(topics.id)).limit(safeLimit(limit)).all();
    },

    postTopic(rawTopic: unknown, rawSender: unknown, rawBody: unknown) {
      const topicId = cleanId(rawTopic, "topicId");
      const senderId = cleanId(rawSender, "authorId");
      const body = clean(rawBody, "body", 20_000);
      requireUser(senderId);
      if (!db.select().from(topics).where(eq(topics.id, topicId)).get()) {
        throw new BoardError(404, `topic '${topicId}' does not exist`);
      }
      return db.insert(messages).values({ kind: "topic", topicId, senderId, body }).returning().get();
    },

    readTopic(rawTopic: unknown, after?: unknown, limit?: unknown) {
      const topicId = cleanId(rawTopic, "topicId");
      if (!db.select().from(topics).where(eq(topics.id, topicId)).get()) {
        throw new BoardError(404, `topic '${topicId}' does not exist`);
      }
      const afterId = Math.max(Number(after ?? 0) || 0, 0);
      return db.select().from(messages)
        .where(and(eq(messages.kind, "topic"), eq(messages.topicId, topicId), gt(messages.id, afterId)))
        .orderBy(asc(messages.id)).limit(safeLimit(limit)).all();
    },

    sendDirect(rawFrom: unknown, rawTo: unknown, rawBody: unknown) {
      const senderId = cleanId(rawFrom, "fromId");
      const recipientId = cleanId(rawTo, "toId");
      const body = clean(rawBody, "body", 20_000);
      requireUser(senderId);
      requireUser(recipientId);
      return db.insert(messages).values({ kind: "direct", senderId, recipientId, body }).returning().get();
    },

    readInbox(rawUser: unknown, after?: unknown, limit?: unknown) {
      const userId = cleanId(rawUser, "userId");
      requireUser(userId);
      const afterId = Math.max(Number(after ?? 0) || 0, 0);
      return db.select().from(messages)
        .where(and(
          eq(messages.kind, "direct"),
          or(eq(messages.recipientId, userId), eq(messages.senderId, userId)),
          gt(messages.id, afterId),
        ))
        .orderBy(asc(messages.id)).limit(safeLimit(limit)).all();
    },

    leaveSuggestion(rawAuthor: unknown, rawBody: unknown) {
      const authorId = cleanId(rawAuthor, "authorId");
      const body = clean(rawBody, "body", 20_000);
      requireUser(authorId);
      return db.insert(suggestions).values({ authorId, body }).returning().get();
    },

    listSuggestions(after?: unknown, limit?: unknown) {
      const afterId = Math.max(Number(after ?? 0) || 0, 0);
      return db.select().from(suggestions)
        .where(gt(suggestions.id, afterId))
        .orderBy(asc(suggestions.id)).limit(safeLimit(limit)).all();
    },
  };
}

export type Board = ReturnType<typeof createBoard>;
