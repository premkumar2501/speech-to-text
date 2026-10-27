const button = document.querySelector("#record-button");
const status = document.querySelector("#status");
const transcript = document.querySelector("#transcript");

let socket;
let audioContext;
let mediaStream;
let source;
let worklet;
let isRecording = false;
let isStopping = false;
let chunksSent = 0;
let stopTimeout;

function setStatus(message, kind = "normal") {
  status.textContent = message;
  status.dataset.kind = kind;
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

function finishStop() {
  window.clearTimeout(stopTimeout);
  stopAudio();
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  socket = undefined;
  isStopping = false;
  button.disabled = false;
  button.textContent = "Start recording";
  setStatus("Recording stopped.");
}

function handleSocketMessage(event) {
  const message = parseMessage(event);
  if (!message) return;

  switch (message.type) {
    case "transcript":
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
