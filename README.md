# Speech to Text

A small browser app that captures microphone audio and displays a live transcript. The browser sends audio to the local Node.js server over WebSocket; the server forwards it to the Gemini Live transcription API and relays transcript updates back to the page.

## Requirements

- Node.js (the project was checked with Node.js 22)
- A Gemini API key with access to the Gemini Live API
- A modern browser with microphone and AudioWorklet support

## Run the app

1. Open a terminal in the project folder.
2. Install the dependencies:

   ```sh
   npm install
   ```

3. Add your Gemini API key to the root `.env` file:

   ```env
   GEMINI_API_KEY=your_gemini_api_key
   ```

   Keep this key in `.env`. Do not put it in browser code or commit it to source control; `.env` is ignored by Git.

4. Start the server:

   ```sh
   npm start
   ```

   For automatic restarts while developing, use `npm run dev`.

5. Open the address printed in the terminal, usually [http://localhost:3000](http://localhost:3000), and allow microphone access.

If port 3000 is already in use and `PORT` is not set, the server tries the next port and prints the address to use. To choose a port yourself, add a `PORT` value to `.env`, for example `PORT=3100`.

## How the flow works

```mermaid
flowchart LR
    A[Start recording] --> B[Browser requests microphone]
    B --> C[AudioWorklet converts audio to mono 16 kHz PCM]
    C -->|Binary audio chunks| D[WebSocket /ws on Node server]
    D --> E[Gemini Live transcription session]
    E -->|Transcript and turn events| D
    D -->|JSON messages| F[Browser updates transcript and status]
    G[Stop recording] --> H[Flush final audio chunk]
    H -->|stop control message| D
    D -->|audioStreamEnd| E
```

### Start recording

1. `public/recorder.js` opens a WebSocket to `/ws` on the same host as the page.
2. `server.js` opens a Gemini session through `src/services/gemini.js`. The browser enables the microphone only after the server reports that the Gemini session is ready.
3. The browser creates an `AudioContext` at 16 kHz and loads `public/worklet.js` as an AudioWorklet processor.
4. The worklet converts microphone samples to signed 16-bit PCM and sends them to the main page in chunks of 2,048 samples (about 128 ms of audio).
5. `recorder.js` sends each chunk as a binary WebSocket message. `server.js` base64-encodes it and sends it to Gemini with the MIME type `audio/pcm;rate=16000`.
6. Gemini returns finalized input transcription events. The server sends each transcript update to the page as a JSON message, and the page appends it to the transcript area.

### Stop recording

1. The browser asks the worklet to flush any remaining audio samples.
2. After the flush, the browser sends `{ "type": "stop" }` to the server.
3. The server sends `audioStreamEnd` to Gemini so it can finalize the current speech segment.
4. When the turn completes, the browser closes the connection and releases the microphone and audio resources.

## Project files

| File | Purpose |
| --- | --- |
| `server.js` | Serves the static page, hosts `/ws`, manages Gemini sessions, and forwards audio and transcript messages. |
| `src/services/gemini.js` | Configures the Gemini client and live transcription model. The API key is read on the server from `GEMINI_API_KEY`. |
| `public/index.html` | The page structure and styling. |
| `public/recorder.js` | Recording button behavior, microphone setup, WebSocket messages, and transcript display. |
| `public/worklet.js` | Converts microphone audio samples to signed 16-bit PCM chunks. |
| `.env` | Local configuration such as `GEMINI_API_KEY` and optional `PORT`; ignored by Git. |

## Messages between the browser and server

The WebSocket endpoint is `/ws`.

| Direction | Message | Meaning |
| --- | --- | --- |
| Server → browser | `{ "type": "ready" }` | Gemini session is ready for audio. |
| Browser → server | Binary PCM data | A chunk of microphone audio. |
| Server → browser | `{ "type": "audio_received", "chunks": 25 }` | Progress update about audio chunks received. |
| Browser → server | `{ "type": "stop" }` | End the current audio stream and finalize transcription. |
| Server → browser | `{ "type": "transcript", "text": "..." }` | A finalized transcript segment. |
| Server → browser | `{ "type": "turn_complete" }` | Gemini has completed the current speech turn. |
| Server → browser | `{ "type": "error", "message": "..." }` | A service or connection error suitable for display. |

## Troubleshooting

- **The page opens, but recording does not start:** Check the server terminal for a Gemini connection error. Confirm that `GEMINI_API_KEY` is set in the root `.env` file and that the key can access the Gemini API.
- **Microphone permission is denied:** Allow microphone access in the browser and reload the page. Microphone access is available on `localhost` or from a secure HTTPS page.
- **Port 3000 is busy:** If no `PORT` is configured, use the port printed by the server (it will try 3001, then the next available port). If `PORT` is configured, choose a free port in `.env`.
- **The browser reports that 16 kHz audio is unavailable:** Use a current browser that supports requesting a 16 kHz `AudioContext` and AudioWorklet.
- **Gemini reports a quota or API error:** Check the key, API access, and account quota. The browser displays a short error; the server terminal contains the service-side diagnostic.
- **No transcript appears:** Speak clearly after the status changes to listening. Transcription segments are added when Gemini finalizes them, which may happen after a pause or when recording stops.

## Notes

- Audio is streamed to Gemini while recording; this is not an offline transcription app.
- The Gemini API key stays on the Node.js server and is not sent to the browser.
- The current page displays finalized transcription segments; it does not render interim partial hypotheses.
- The server uses the `gemini-3.5-transcribe-live` model with text responses and automatic language detection.
