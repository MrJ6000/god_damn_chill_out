import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "127.0.0.1";
const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`[api] listening on http://${host}:${port}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
