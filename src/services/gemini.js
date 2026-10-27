import { GoogleGenAI, Modality } from "@google/genai";

export const GEMINI_LIVE_MODEL = "gemini-3.5-transcribe-live";

let client;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export function getFriendlyGeminiError(error) {
  const detail = `${error?.message ?? error ?? ""} ${error?.status ?? ""}`;
  if (/GEMINI_API_KEY is not configured/i.test(detail)) {
    return "Gemini API key is missing on the server. Add GEMINI_API_KEY to your local .env file.";
  }
  if (/429|quota|resource_exhausted/i.test(detail)) {
    return "Gemini's free-tier quota was reached. Please try again later.";
  }

  return "The speech transcription service encountered an error. Please try again.";
}

export function connectGeminiLive({ onTranscript, onTurnComplete, onError, onClose }) {
  return getClient().live.connect({
    model: GEMINI_LIVE_MODEL,
    config: {
      responseModalities: [Modality.TEXT],
      inputAudioTranscription: {},
    },
    callbacks: {
      onmessage(message) {
        const text = message.serverContent?.inputTranscription?.text;
        if (text) onTranscript(text);
        if (message.serverContent?.turnComplete) onTurnComplete();
      },
      onerror(error) {
        onError(error);
      },
      onclose(event) {
        onClose(event);
      },
    },
  });
}
