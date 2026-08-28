import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json({ limit: "2mb" }));

const startedAt = Date.now();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    data: {
      status: "ok",
      version: "0.1.0",
      uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    },
  });
});

// TODO M2: 其餘 10 支端點見「07_共用介面規格」

const port = Number(process.env.API_PORT ?? 3001);
app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
