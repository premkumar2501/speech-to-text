import "dotenv/config";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import {
  getTranscription,
  fetchTranscription,
  updateTranscription,
  deleteTranscription,
} from "./src/controller/transcription.js";
import connectWebSocket from "./src/config/webSocket.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));

app.get("/api/transcriptions", getTranscription);

app.post("/api/transcriptions", fetchTranscription);

app.patch("/api/transcriptions/:id", updateTranscription);

app.delete("/api/transcriptions/:id", deleteTranscription);

app.use(express.static(publicDirectory));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

wss.on("connection", connectWebSocket);

const port = Number(process.env.PORT) || 3000;
let activePort = port;

wss.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !process.env.PORT && activePort < 65535) {
    activePort += 1;
    console.warn(
      `Port ${activePort - 1} is in use; trying port ${activePort}.`,
    );
    server.listen(activePort);
    return;
  }

  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${activePort} is already in use. Set PORT in .env to use a different port.`,
    );
  } else {
    console.error("Could not start the speech to text server:", error.message);
  }
  process.exitCode = 1;
});

server.listen(activePort, () => {
  console.log(`Speech to Text listening on port ${activePort}`);
  if (!process.env.DATABASE_URL) {
    console.warn(
      "DATABASE_URL is not configured; transcription history will be unavailable.",
    );
  }
});
