import { createApp } from "./app.js";
import { createDatabase } from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const { db, sqlite } = createDatabase();
const server = createApp(db).listen(port, host, () => {
  console.log(`Gatio Swarm listening at http://${host}:${port}`);
});

const shutdown = () =>
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
