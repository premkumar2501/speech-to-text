const button = document.querySelector("#record-button");
const status = document.querySelector("#status");
const transcript = document.querySelector("#transcript");
const historyList = document.querySelector("#history-list");
const historyStatus = document.querySelector("#history-status");

let socket;
let audioContext;
let mediaStream;
let source;
let worklet;
let isRecording = false;
let isStopping = false;
let chunksSent = 0;
let stopTimeout;
let currentTranscript = "";

function setStatus(message, kind = "normal") {
  status.textContent = message;
  status.dataset.kind = kind;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function setHistoryStatus(message, kind = "normal") {
  historyStatus.textContent = message;
  historyStatus.dataset.kind = kind;
}

function makeHistoryButton(label, className, onClick) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = className;
  action.textContent = label;
  action.addEventListener("click", onClick);
  return action;
}

function renderHistory(items) {
  historyList.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-date";
    empty.textContent = "No saved transcriptions yet. Finish a recording to add one.";
    historyList.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "history-card";

    const heading = document.createElement("div");
    heading.className = "history-card-heading";
    const title = document.createElement("h3");
    title.textContent = item.title;
    heading.append(title);

    const date = document.createElement("p");
    date.className = "history-date";
    date.textContent = `Saved ${new Date(item.createdAt).toLocaleString()}`;

    const text = document.createElement("p");
    text.className = "history-text";
    text.textContent = item.text;

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const edit = makeHistoryButton("Edit", "secondary small", () => editHistoryItem(item, card));
    const remove = makeHistoryButton("Delete", "danger small", async () => {
      if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
      remove.disabled = true;
      try {
        await apiRequest(`/api/transcriptions/${item.id}`, { method: "DELETE" });
        await loadHistory("Transcription deleted.");
      } catch (error) {
        setHistoryStatus(error.message, "error");
        remove.disabled = false;
      }
    });
    actions.append(edit, remove);
    card.append(heading, date, text, actions);
    historyList.append(card);
  }
}

async function loadHistory(message = "") {
  setHistoryStatus("Loading history...");
  try {
    const items = await apiRequest("/api/transcriptions");
    renderHistory(items);
    setHistoryStatus(message || `${items.length} saved transcription${items.length === 1 ? "" : "s"}`);
  } catch (error) {
    historyList.replaceChildren();
    setHistoryStatus(error.message, "error");
  }
}

function editHistoryItem(item, card) {

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.maxLength = 200;
  titleInput.value = item.title;
  titleInput.setAttribute("aria-label", "Transcription title");

  const textInput = document.createElement("textarea");
  textInput.maxLength = 100_000;
  textInput.value = item.text;
  textInput.setAttribute("aria-label", "Transcript text");

  const actions = document.createElement("div");
  actions.className = "history-actions";
  const save = makeHistoryButton("Save changes", "small", async () => {
    save.disabled = true;
    try {
      await apiRequest(`/api/transcriptions/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: titleInput.value, text: textInput.value }),
      });
      await loadHistory("Changes saved.");
    } catch (error) {
      setHistoryStatus(error.message, "error");
      save.disabled = false;
    }
  });
  const cancel = makeHistoryButton("Cancel", "secondary small", () => loadHistory());
  actions.append(save, cancel);

  const date = card.querySelector(".history-date");
  const oldText = card.querySelector(".history-text");
  const oldActions = card.querySelector(".history-actions");
  date.after(titleInput, textInput);
  oldText.remove();
  oldActions.replaceWith(actions);
  card.querySelector("h3").remove();
}

// Message content change to object with type and text properties
function parseMessage(event) { 
  try {
    return JSON.parse(event.data);
  } catch {
    setStatus("The server sent an unreadable response.", "error");
    return null;
  }
}

function waitForReady(ws) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The speech service did not become ready in time."));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
    }

    function onMessage(event) {
      const message = parseMessage(event);
      if (!message) return;
      if (message.type === "ready") {
        cleanup();
        resolve();
      } else if (message.type === "error") {
        cleanup();
        reject(new Error(message.message));
      }
    }

    function onClose() {
      cleanup();
      reject(new Error("The connection closed before transcription could start."));
    }

    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
  });
}

function stopAudio() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  source?.disconnect();
  worklet?.disconnect();
  if (audioContext && audioContext.state !== "closed") {
    void audioContext.close();
  }
  mediaStream = undefined;
  source = undefined;
  worklet = undefined;
  audioContext = undefined;
}

async function finishStop() {
  const savedText = currentTranscript.trim();
  window.clearTimeout(stopTimeout);
  stopAudio();
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  socket = undefined;
  isStopping = false;
  button.textContent = "Start recording";
  if (!savedText) {
    button.disabled = false;
    setStatus("Recording stopped. No transcript was produced.");
    return;
  }

  button.disabled = true;
  setStatus("Recording stopped. Saving transcription...");
  try {
    await apiRequest("/api/transcriptions", {
      method: "POST",
      body: JSON.stringify({ text: savedText }),
    });
    setStatus("Recording stopped. Transcription saved to history.");
    await loadHistory("Transcription saved.");
  } catch (error) {
    setStatus(`Recording stopped, but it could not be saved: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

function handleSocketMessage(event) {
  const message = parseMessage(event);
  if (!message) return;

  switch (message.type) {
    case "transcript":
      currentTranscript += message.text;
      transcript.textContent += message.text;
      break;
    case "audio_received":
      console.log(message, 'MESSAGES');
      chunksSent = message.chunks;
      if (isRecording) {
        setStatus(`Listening · ${chunksSent} audio chunks sent`);
      }
      break;
    case "turn_complete":
      if (isStopping) finishStop();
      break;
    case "error":
      setStatus(message.message, "error");
      if (!isRecording && !isStopping) return;
      stopAudio();
      isRecording = false;
      isStopping = false;
      window.clearTimeout(stopTimeout);
      socket?.close();
      socket = undefined;
      button.disabled = false;
      button.textContent = "Start recording";
      break;
    case "closed":
      if (isRecording || isStopping) {
        stopAudio();
        isRecording = false;
        isStopping = false;
        window.clearTimeout(stopTimeout);
        button.disabled = false;
        button.textContent = "Start recording";
        setStatus("The speech service disconnected. Please try again.", "error");
      }
      break;
  }
}

async function startRecording() {
  button.disabled = true;
  currentTranscript = "";
  transcript.textContent = "";
  setStatus("Connecting to the speech service...");

  try {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket = ws;
    ws.addEventListener("message", handleSocketMessage);
    ws.addEventListener("close", () => {
      if (socket !== ws) return;
      socket = undefined;
      if (isRecording || isStopping) {
        stopAudio();
        isRecording = false;
        isStopping = false;
        window.clearTimeout(stopTimeout);
        button.disabled = false;
        button.textContent = "Start recording";
        setStatus("Connection lost. Please try again.", "error");
      }
    });

    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error("Could not connect to the speech service.")),
        { once: true },
      );
    });
    await waitForReady(ws);
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires localhost or a secure HTTPS connection.");
    }

    setStatus("Requesting microphone access...");
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
    });
    audioContext = new AudioContext({ sampleRate: 16000 });
    if (audioContext.sampleRate !== 16000) {
      throw new Error("This browser cannot provide 16 kHz microphone audio.");
    }
    await audioContext.audioWorklet.addModule("/worklet.js");
    await audioContext.resume();

    source = audioContext.createMediaStreamSource(mediaStream);
    worklet = new AudioWorkletNode(audioContext, "pcm-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      outputChannelCount: [1],
    });
    worklet.port.onmessage = ({ data }) => {
      if (data instanceof ArrayBuffer) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      } else if (data?.type === "flushed") {
        stopAudio();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stop" }));
          stopTimeout = window.setTimeout(finishStop, 5000);
        } else {
          finishStop();
        }
      }
    };

    source.connect(worklet);
    worklet.connect(audioContext.destination);
    chunksSent = 0;
    isRecording = true;
    button.disabled = false;
    button.textContent = "Stop recording";
    setStatus("Listening · speak naturally");
  } catch (error) {
    stopAudio();
    isRecording = false;
    isStopping = false;
    if (socket) socket.close();
    socket = undefined;
    button.disabled = false;
    button.textContent = "Start recording";
    const message =
      error.name === "NotAllowedError" || error.name === "SecurityError"
        ? "Microphone access was denied. Allow microphone access and try again."
        : error.message || "Could not start recording.";
    setStatus(message, "error");
  }
}

function stopRecording() {
  if (!isRecording || !worklet) return;

  isRecording = false;
  isStopping = true;
  button.disabled = true;
  setStatus("Finishing the current transcript...");
  worklet.port.postMessage({ type: "flush" });
}

button.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    void startRecording();
  }
});

void loadHistory();
