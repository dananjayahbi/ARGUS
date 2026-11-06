import { describe, expect, it } from "vitest";

import {
  audioExtension,
  chooseAudioMimeType,
  formatDuration,
} from "./audio";

describe("audio helpers", () => {
  it("prefers WebM/Opus, then WebM, then MP4", () => {
    expect(chooseAudioMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(
      chooseAudioMimeType((mime) => mime === "audio/webm" || mime === "audio/mp4"),
    ).toBe("audio/webm");
    expect(chooseAudioMimeType((mime) => mime === "audio/mp4")).toBe(
      "audio/mp4",
    );
    expect(chooseAudioMimeType(() => false)).toBe("");
  });

  it("maps MIME types to file extensions", () => {
    expect(audioExtension("audio/webm;codecs=opus")).toBe(".webm");
    expect(audioExtension("audio/mp4")).toBe(".m4a");
    expect(audioExtension("audio/ogg")).toBe(".ogg");
    expect(audioExtension("audio/wav")).toBe(".wav");
  });

  it("formats short and long durations without truncating hours", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(-5)).toBe("0:00");
  });
});
