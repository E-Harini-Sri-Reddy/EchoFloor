const SILENCE_MS = 1100;
const MIN_SPEECH_MS = 500;
const CALIBRATE_MS = 500;
const HARD_STOP_MS = 30_000;

export type VadPhase = "listening" | "hearing";

export interface LiveRecorderOptions {
  onPhase: (phase: VadPhase) => void;
  onUtterance: (blob: Blob) => void;
  /** When true, VAD will not start a new clip (e.g. while waiting on n8n). */
  isPaused?: () => boolean;
}

export interface LiveRecorderHandle {
  /** Manual capture: start recording immediately (push-to-talk). */
  beginManualCapture: () => void;
  /** Manual capture: stop and emit the blob. */
  endManualCapture: () => Promise<void>;
  dispose: () => void;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}

export async function createLiveRecorder(
  options: LiveRecorderOptions,
): Promise<LiveRecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const audioContext = new AudioContext();
  // Critical: without resume(), RMS stays ~0 and speech is never detected.
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const mimeType = pickMimeType();
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  let phase: VadPhase = "listening";
  let speechStartedAt: number | null = null;
  let lastLoudAt = 0;
  let raf = 0;
  let stopped = false;
  let finishing = false;
  let manual = false;
  let noiseFloor = 0.01;
  let calibrated = false;
  const calibrateStarted = performance.now();

  function setPhase(next: VadPhase) {
    if (phase === next) return;
    phase = next;
    options.onPhase(next);
  }

  function startRecorder(fromManual: boolean) {
    if (finishing || stopped) return;
    if (!fromManual && options.isPaused?.()) return;
    chunks.length = 0;
    manual = fromManual;
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(200);
    speechStartedAt = performance.now();
    lastLoudAt = speechStartedAt;
    setPhase("hearing");
  }

  async function finishRecording(): Promise<void> {
    if (finishing) return;
    finishing = true;
    const wasManual = manual;
    const active = recorder;
    recorder = null;
    const started = speechStartedAt;
    speechStartedAt = null;
    manual = false;
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
    if (!chunks.length) return;
    if (
      !wasManual &&
      started !== null &&
      performance.now() - started < MIN_SPEECH_MS
    ) {
      return;
    }
    const blob = new Blob(chunks, { type: active.mimeType || mimeType });
    if (blob.size < 256) return;
    options.onUtterance(blob);
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

    if (!calibrated) {
      noiseFloor = Math.max(noiseFloor, rms);
      if (now - calibrateStarted >= CALIBRATE_MS) {
        calibrated = true;
        noiseFloor = Math.max(0.008, noiseFloor * 1.15);
      }
      raf = window.requestAnimationFrame(tick);
      return;
    }

    const threshold = Math.max(0.015, noiseFloor * 2.2);

    if (manual) {
      if (
        speechStartedAt !== null &&
        now - speechStartedAt >= HARD_STOP_MS &&
        !finishing
      ) {
        void finishRecording();
      }
      raf = window.requestAnimationFrame(tick);
      return;
    }

    if (options.isPaused?.()) {
      raf = window.requestAnimationFrame(tick);
      return;
    }

    if (rms >= threshold) {
      lastLoudAt = now;
      if (phase === "listening" && !finishing) startRecorder(false);
    } else if (phase === "hearing" && speechStartedAt !== null && !finishing) {
      const spokeLongEnough = now - speechStartedAt >= MIN_SPEECH_MS;
      if (spokeLongEnough && now - lastLoudAt >= SILENCE_MS) {
        void finishRecording();
      } else if (now - speechStartedAt >= HARD_STOP_MS) {
        void finishRecording();
      }
    }
    raf = window.requestAnimationFrame(tick);
  };
  raf = window.requestAnimationFrame(tick);

  return {
    beginManualCapture: () => {
      if (phase === "hearing" || finishing) return;
      startRecorder(true);
    },
    endManualCapture: () => finishRecording(),
    dispose: () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
    },
  };
}

export function blobFilename(blob: Blob): string {
  if (blob.type.includes("webm")) return "recording.webm";
  if (blob.type.includes("ogg")) return "recording.ogg";
  if (blob.type.includes("mp4") || blob.type.includes("m4a")) return "recording.m4a";
  return "recording.webm";
}
