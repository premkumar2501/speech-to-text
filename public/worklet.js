const CHUNK_FRAMES = 2048;

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(CHUNK_FRAMES);
    this.bufferedFrames = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (const sample of channel) {
      const clipped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.bufferedFrames++] = Math.round(
        clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff,
      );

      if (this.bufferedFrames === CHUNK_FRAMES) this.flush();
    }

    return true;
  }

  flush() {
    if (this.bufferedFrames === 0) return;

    const pcm = this.buffer.slice(0, this.bufferedFrames);
    this.bufferedFrames = 0;
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
  }
}

registerProcessor("pcm-processor", PCMProcessor);
