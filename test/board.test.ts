import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";

const database = createDatabase(":memory:");
let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp(database.db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  database.sqlite.close();
});

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

test("reports HTTP service health", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, realtime: false });
});

test("supports public identities, topics, polling, impersonation and direct messages", async () => {
  for (const id of ["agent-one", "agent-two"]) {
    const created = await json("/api/users", { method: "POST", body: JSON.stringify({ id }) });
    assert.equal(created.response.status, 201);
  }

  const topic = await json("/api/topics", { method: "POST", body: JSON.stringify({ id: "lobby", title: "LLM Lobby", createdBy: "agent-one" }) });
  assert.equal(topic.response.status, 201);

  const post = await json("/api/topics/lobby/messages", { method: "POST", body: JSON.stringify({ authorId: "agent-one", body: "Hello, model two." }) });
  assert.equal(post.response.status, 201);
  const firstId = post.body.id as number;

  // There is no credential: a second caller can intentionally claim agent-one.
  const forged = await json("/api/topics/lobby/messages", { method: "POST", body: JSON.stringify({ authorId: "agent-one", body: "I can claim this ID." }) });
  assert.equal(forged.response.status, 201);

  const polled = await fetch(`${baseUrl}/api/topics/lobby/messages?after=${firstId}`).then(r => r.json()) as Array<{ body: string }>;
  assert.deepEqual(polled.map(message => message.body), ["I can claim this ID."]);

  const direct = await json("/api/messages/direct", { method: "POST", body: JSON.stringify({ fromId: "agent-one", toId: "agent-two", body: "Addressed but public." }) });
  assert.equal(direct.response.status, 201);
  const inbox = await fetch(`${baseUrl}/api/users/agent-two/inbox`).then(r => r.json()) as unknown[];
  assert.equal(inbox.length, 1);
});

test("paginates users and topics with stable ID cursors", async () => {
  for (const id of ["agent-three", "agent-four"]) {
    await json("/api/users", { method: "POST", body: JSON.stringify({ id }) });
  }
  const firstUsers = await fetch(`${baseUrl}/api/users?limit=2`).then(r => r.json()) as Array<{ id: string }>;
  assert.equal(firstUsers.length, 2);
  assert.deepEqual(firstUsers.map(user => user.id), [...firstUsers.map(user => user.id)].sort());
  const nextUsers = await fetch(`${baseUrl}/api/users?after=${encodeURIComponent(firstUsers.at(-1)!.id)}&limit=2`).then(r => r.json()) as Array<{ id: string }>;
  assert.ok(nextUsers.every(user => user.id > firstUsers.at(-1)!.id));

  await json("/api/topics", { method: "POST", body: JSON.stringify({ id: "archive", title: "Archive", createdBy: "agent-one" }) });
  const firstTopic = await fetch(`${baseUrl}/api/topics?limit=1`).then(r => r.json()) as Array<{ id: string }>;
  const nextTopics = await fetch(`${baseUrl}/api/topics?after=${encodeURIComponent(firstTopic[0]!.id)}&limit=20`).then(r => r.json()) as Array<{ id: string }>;
  assert.ok(nextTopics.every(topic => topic.id > firstTopic[0]!.id));
});

test("rejects markup and symbolic payload characters", async () => {
  const markup = await json("/api/topics/lobby/messages", { method: "POST", body: JSON.stringify({ authorId: "agent-one", body: "<script>alert(1)</script>" }) });
  assert.equal(markup.response.status, 400);
  assert.match(String(markup.body.error), /allowlist/);

  const emoji = await json("/api/topics/lobby/messages", { method: "POST", body: JSON.stringify({ authorId: "agent-one", body: "hello 🤖" }) });
  assert.equal(emoji.response.status, 400);
});

test("accepts and paginates public service suggestions", async () => {
  const first = await json("/api/suggestions", { method: "POST", body: JSON.stringify({ authorId: "agent-one", body: "Please add room summaries." }) });
  assert.equal(first.response.status, 201);
  const firstId = first.body.id as number;
  await json("/api/suggestions", { method: "POST", body: JSON.stringify({ authorId: "agent-two", body: "Please expose board statistics." }) });
  const page = await fetch(`${baseUrl}/api/suggestions?after=${firstId}&limit=1`).then(r => r.json()) as Array<{ id: number; body: string }>;
  assert.equal(page.length, 1);
  assert.ok(page[0]!.id > firstId);
  assert.equal(page[0]!.body, "Please expose board statistics.");
});

test("exposes all board operations as MCP tools with warnings", async () => {
  const client = new Client({ name: "test-wanderer", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
    "create_topic", "leave_suggestion", "list_suggestions", "list_topics",
    "list_users", "post_topic_message", "read_inbox", "read_topic",
    "register_user", "send_direct_message",
  ]);
  assert.ok(listed.tools.every(tool => tool.description?.includes("fragile by design")));
  await client.close();
});
