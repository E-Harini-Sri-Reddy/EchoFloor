const SILENCE_MS = 800;
const MIN_SPEECH_MS = 350;
const CALIBRATE_MS = 400;
const MAX_UTTERANCE_MS = 15_000;
/** If we started hearing but never saw loud audio again, stop anyway. */
const NO_SPEECH_ABORT_MS = 2_500;

export type VadPhase = "listening" | "hearing";

export interface LiveRecorderOptions {
  onPhase: (phase: VadPhase) => void;
  onUtterance: (blob: Blob) => void;
  isPaused?: () => boolean;
  /** When true, never auto-start from ambient audio — only beginManualCapture(). */
  manualOnly?: boolean;
}

export interface LiveRecorderHandle {
  /** Start recording now (Hold to talk / tap to start). */
  beginManualCapture: () => void;
  /** Stop recording and emit the clip immediately (Stop Listening). */
  stopListening: () => Promise<void>;
  /** @deprecated use stopListening */
  endManualCapture: () => Promise<void>;
  isHearing: () => boolean;
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
  let heardLoud = false;
  let raf = 0;
  let stopped = false;
  let finishing = false;
  let noiseFloor = 0.012;
  let calibrated = false;
  const calibrateStarted = performance.now();

  function setPhase(next: VadPhase) {
    if (phase === next) return;
    phase = next;
    options.onPhase(next);
  }

  function startRecorder() {
    if (finishing || stopped || phase === "hearing") return;
    if (options.isPaused?.()) return;
    chunks.length = 0;
    heardLoud = false;
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(150);
    speechStartedAt = performance.now();
    lastLoudAt = speechStartedAt;
    setPhase("hearing");
  }

  async function finishRecording(force: boolean): Promise<void> {
    if (finishing) return;
    if (phase !== "hearing" && !recorder) return;
    finishing = true;
    const active = recorder;
    recorder = null;
    const started = speechStartedAt;
    speechStartedAt = null;
    setPhase("listening");
    if (!active || active.state === "inactive") {
      finishing = false;
      return;
    }
    await new Promise<void>((resolve) => {
      active.onstop = () => resolve();
      try {
        active.stop();
      } catch {
        resolve();
      }
    });
    finishing = false;
    if (!chunks.length) return;
    const duration = started !== null ? performance.now() - started : 0;
    if (!force && duration < MIN_SPEECH_MS) return;
    const blob = new Blob(chunks, { type: active.mimeType || mimeType });
    if (blob.size < 200) return;
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
        // Raise floor so room hum does not keep "hearing" forever.
        noiseFloor = Math.max(0.02, noiseFloor * 1.8);
      }
      raf = window.requestAnimationFrame(tick);
      return;
    }

    const threshold = Math.max(0.035, noiseFloor * 2.5);
    const paused = Boolean(options.isPaused?.());

    if (phase === "hearing" && speechStartedAt !== null && !finishing) {
      if (rms >= threshold) {
        lastLoudAt = now;
        heardLoud = true;
      }
      const maxLen = now - speechStartedAt >= MAX_UTTERANCE_MS;
      if (options.manualOnly) {
        // Tap-to-talk: only auto-stop at max length; user taps Stop & send otherwise.
        if (maxLen) void finishRecording(true);
      } else {
        const silentLongEnough = now - lastLoudAt >= SILENCE_MS;
        const neverSpoke =
          !heardLoud && now - speechStartedAt >= NO_SPEECH_ABORT_MS;
        if (maxLen || (heardLoud && silentLongEnough) || neverSpoke) {
          void finishRecording(heardLoud || maxLen);
        }
      }
      raf = window.requestAnimationFrame(tick);
      return;
    }

    // Push-to-talk / tap-to-talk: do not flood from ambient room noise.
    if (
      !options.manualOnly &&
      !paused &&
      phase === "listening" &&
      !finishing &&
      rms >= threshold
    ) {
      startRecorder();
    }
    raf = window.requestAnimationFrame(tick);
  };
  raf = window.requestAnimationFrame(tick);

  return {
    beginManualCapture: () => {
      if (options.isPaused?.()) return;
      startRecorder();
    },
    stopListening: () => finishRecording(true),
    endManualCapture: () => finishRecording(true),
    isHearing: () => phase === "hearing",
    dispose: () => {
      if (stopped) return;
      stopped = true;
      window.cancelAnimationFrame(raf);
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      recorder = null;
      stream.getTracks().forEach((track) => track.stop());
      if (audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
    },
  };
}

export function blobFilename(blob: Blob): string {
  if (blob.type.includes("webm")) return "recording.webm";
  if (blob.type.includes("ogg")) return "recording.ogg";
  if (blob.type.includes("mp4") || blob.type.includes("m4a")) return "recording.m4a";
  return "recording.webm";
}
