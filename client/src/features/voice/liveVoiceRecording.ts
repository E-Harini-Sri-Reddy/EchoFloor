const SILENCE_MS = 900;
const SPEECH_THRESHOLD = 0.018;
const MIN_SPEECH_MS = 400;

export type VadPhase = "listening" | "hearing";

export interface LiveRecorderOptions {
  onPhase: (phase: VadPhase) => void;
  onUtterance: (blob: Blob) => void;
}

export interface LiveRecorderHandle {
  stopAndCapture: () => Promise<void>;
  dispose: () => void;
}

export async function createLiveRecorder(
  options: LiveRecorderOptions,
): Promise<LiveRecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  let phase: VadPhase = "listening";
  let speechStartedAt: number | null = null;
  let lastLoudAt = 0;
  let raf = 0;
  let stopped = false;
  let finishing = false;

  function setPhase(next: VadPhase) {
    if (phase === next) return;
    phase = next;
    options.onPhase(next);
  }

  function startRecorder() {
    if (finishing) return;
    chunks.length = 0;
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(250);
    speechStartedAt = performance.now();
    lastLoudAt = speechStartedAt;
    setPhase("hearing");
  }

  async function finishRecording(): Promise<void> {
    if (finishing) return;
    finishing = true;
    const active = recorder;
    recorder = null;
    speechStartedAt = null;
    setPhase("listening");
    if (!active || active.state === "inactive") {
      finishing = false;
      return;
    }
    await new Promise<void>((resolve) => {
      active.onstop = () => resolve();
      active.stop();
    });
    finishing = false;
    if (chunks.length) {
      const blob = new Blob(chunks, { type: active.mimeType || "audio/webm" });
      options.onUtterance(blob);
    }
  }

  const buffer = new Uint8Array(analyser.fftSize);
  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const normalized = (buffer[index] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / buffer.length);
    const now = performance.now();
    if (rms >= SPEECH_THRESHOLD) {
      lastLoudAt = now;
      if (phase === "listening" && !finishing) startRecorder();
    } else if (phase === "hearing" && speechStartedAt !== null && !finishing) {
      const spokeLongEnough = now - speechStartedAt >= MIN_SPEECH_MS;
      if (spokeLongEnough && now - lastLoudAt >= SILENCE_MS) {
        void finishRecording();
      }
    }
    raf = window.requestAnimationFrame(tick);
  };
  raf = window.requestAnimationFrame(tick);

  return {
    stopAndCapture: finishRecording,
    dispose: () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
    },
  };
}

export function blobFilename(blob: Blob): string {
  if (blob.type.includes("webm")) return "recording.webm";
  if (blob.type.includes("ogg")) return "recording.ogg";
  return "recording.wav";
}
