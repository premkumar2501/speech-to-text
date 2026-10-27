import "dotenv/config";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import {
  connectGeminiLive,
  getFriendlyGeminiError,
} from "./src/services/gemini.js";

const app = express();
const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));
app.use(express.static(publicDirectory));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

wss.on("connection", async (ws) => {
  let session;
  let chunksReceived = 0;
  let stopping = false;
  const send = (message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  try {
    session = await connectGeminiLive({
      onTranscript: (text) => send({ type: "transcript", text }),
      onTurnComplete: () => send({ type: "turn_complete" }),
      onError: (error) => {
        console.error("Gemini Live error:", error);
        send({ type: "error", message: getFriendlyGeminiError(error) });
      },
      onClose: () => send({ type: "closed" }),
    });
    send({ type: "ready" });
  } catch (error) {
    console.error("Could not connect to Gemini Live:", error);
    send({ type: "error", message: getFriendlyGeminiError(error) });
    ws.close(1011, "Speech service unavailable");
    return;
  }

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        send({ type: "error", message: "Invalid WebSocket control message." });
        return;
      }

      if (message.type === "stop" && !stopping) {
        stopping = true;
        session.sendRealtimeInput({ audioStreamEnd: true });
      }
      return;
    }

    if (stopping || data.length === 0 || data.length % 2 !== 0) return;

    try {
      session.sendRealtimeInput({
        audio: {
          data: data.toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      });
      chunksReceived += 1;
      if (chunksReceived === 1 || chunksReceived % 25 === 0) {
        send({ type: "audio_received", chunks: chunksReceived });
      }
    } catch (error) {
      console.error("Could not send audio to Gemini Live:", error);
      send({ type: "error", message: getFriendlyGeminiError(error) });
    }
  });

  ws.on("close", () => {
    session?.close();
  });
});

const port = Number(process.env.PORT) || 3000;
let activePort = port;

wss.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !process.env.PORT && activePort < 65535) {
    activePort += 1;
    console.warn(`Port ${activePort - 1} is in use; trying port ${activePort}.`);
    server.listen(activePort);
    return;
  }

  if (error.code === "EADDRINUSE") {
    console.error(`Port ${activePort} is already in use. Set PORT in .env to use a different port.`);
  } else {
    console.error("Could not start the speech to text server:", error.message);
  }
  process.exitCode = 1;
});

server.listen(activePort, () =>
  console.log(`Speech to Text listening on port ${activePort}`),
);
