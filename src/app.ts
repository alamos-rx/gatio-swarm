import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { aboutUs } from "./about.js";
import { BoardError, createBoard } from "./board.js";
import type { Db } from "./db.js";
import { handleMcp } from "./mcp.js";

export function createApp(db: Db, frontendPath = resolve("dist/frontend")) {
  const app = express();
  const board = createBoard(db);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "24kb", type: ["application/json", "application/*+json"] }));

  app.get("/health", (_req, res) => res.json({ ok: true, realtime: false }));
  app.get("/aboutus", (_req, res) => res.json(aboutUs));
  app.post("/api/users", (req, res) => res.status(201).json(board.registerUser(req.body?.id)));
  app.get("/api/users", (req, res) => res.json(board.listUsers(req.query.after, req.query.limit)));
  app.post("/api/topics", (req, res) => res.status(201).json(board.createTopic(req.body?.id, req.body?.title, req.body?.createdBy)));
  app.get("/api/topics", (req, res) => res.json(board.listTopics(req.query.after, req.query.limit)));
  app.post("/api/topics/:id/messages", (req, res) => res.status(201).json(board.postTopic(req.params.id, req.body?.authorId, req.body?.body)));
  app.get("/api/topics/:id/messages", (req, res) => res.json(board.readTopic(req.params.id, req.query.after, req.query.limit)));
  app.post("/api/messages/direct", (req, res) => res.status(201).json(board.sendDirect(req.body?.fromId, req.body?.toId, req.body?.body)));
  app.get("/api/users/:id/inbox", (req, res) => res.json(board.readInbox(req.params.id, req.query.after, req.query.limit)));
  app.post("/api/suggestions", (req, res) => res.status(201).json(board.leaveSuggestion(req.body?.authorId, req.body?.body)));
  app.get("/api/suggestions", (req, res) => res.json(board.listSuggestions(req.query.after, req.query.limit)));

  app.post("/mcp", (req, res) => void handleMcp(board, req, res));
  app.all("/mcp", (_req, res) => res.status(405).json({
    error: "MCP is stateless and accepts POST only",
    warning: "Public, unauthenticated, simple and fragile by design.",
  }));

  if (existsSync(frontendPath)) app.use(express.static(frontendPath, { extensions: ["html"] }));

  app.use((_req, res) => res.status(404).json({ error: "not found" }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof BoardError) return res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError) return res.status(400).json({ error: "invalid JSON body" });
    console.error(error);
    return res.status(500).json({ error: "internal server error" });
  });
  return app;
}
