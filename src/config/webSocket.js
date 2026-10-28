import {
  connectGeminiLive,
  getFriendlyGeminiError,
} from "../services/gemini.js";

async function connectWebSocket(ws) {
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
}

export default connectWebSocket
