export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export function chooseAudioMimeType(
  isSupported: (mime: string) => boolean,
): string {
  return AUDIO_MIME_CANDIDATES.find((mime) => isSupported(mime)) ?? "";
}

export function audioExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("mp4")) {
    return ".m4a";
  }
  if (normalized.includes("ogg")) {
    return ".ogg";
  }
  if (normalized.includes("wav")) {
    return ".wav";
  }
  return ".webm";
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(remaining).padStart(2, "0");

  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}
