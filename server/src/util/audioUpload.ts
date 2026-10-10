const ALLOWED_EXTENSIONS = new Set([
  "flac",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "ogg",
  "wav",
  "webm",
]);

const ALLOWED_MIMES = new Set([
  "audio/flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
]);

export function extensionFromFilename(filename: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  if (!match) return null;
  return match[1].toLowerCase();
}

export function validateAudioUpload(
  file: Express.Multer.File | undefined,
  maxBytes: number,
): { ok: true; filename: string; mimetype: string } | { ok: false; message: string } {
  if (!file || !file.buffer?.length) {
    return { ok: false, message: "audioFile is required." };
  }
  if (file.size > maxBytes) {
    return { ok: false, message: "Audio file exceeds the maximum size." };
  }
  const ext = extensionFromFilename(file.originalname);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, message: "Audio filename must use a supported extension." };
  }
  const mimetype = file.mimetype || "application/octet-stream";
  if (!ALLOWED_MIMES.has(mimetype) && mimetype !== "application/octet-stream") {
    return { ok: false, message: "Unsupported audio content type." };
  }
  const filename =
    file.originalname && extFromName(file.originalname)
      ? file.originalname
      : `audio.${ext}`;
  return { ok: true, filename, mimetype };
}

function extFromName(filename: string): boolean {
  return Boolean(extensionFromFilename(filename));
}

export const VOICE_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
