"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  audioExtension,
  chooseAudioMimeType,
  formatDuration,
} from "@/lib/audio";

type RecorderStatus = "idle" | "recording" | "paused" | "ready" | "error";

interface VoiceRecorderProps {
  onRecorded: (blob: Blob | null, mimeType: string | null) => void;
}

const buttonClass =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";

export function VoiceRecorder({ onRecorded }: VoiceRecorderProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupAnalyser = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      const elapsed =
        elapsedRef.current + (Date.now() - startedAtRef.current) / 1000;
      setDuration(elapsed);
    }, 250);
  }, [stopTimer]);

  const setupAnalyser = useCallback((stream: MediaStream) => {
    if (typeof AudioContext === "undefined") {
      return;
    }

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioContextRef.current = context;
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) {
        return;
      }
      analyserRef.current.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      animationRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setDuration(0);
    elapsedRef.current = 0;
    chunksRef.current = [];

    if (typeof MediaRecorder === "undefined") {
      setError(
        "This browser does not support audio recording. You can still submit the report without a voice note.",
      );
      setStatus("error");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser does not expose a microphone. You can still submit the report without a voice note.",
      );
      setStatus("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const selectedMime = chooseAudioMimeType((mime) =>
        MediaRecorder.isTypeSupported(mime),
      );
      const recorder = selectedMime
        ? new MediaRecorder(stream, { mimeType: selectedMime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || selectedMime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const url = URL.createObjectURL(blob);

        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
        }
        audioUrlRef.current = url;
        setAudioUrl(url);
        setMimeType(type);
        setLevel(0);
        setStatus("ready");
        onRecorded(blob, type);
        stopTimer();
        cleanupAnalyser();
        cleanupStream();
      };

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setError(
            "The microphone disconnected. The recording so far has been kept.",
          );
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
        };
      });

      stream.addEventListener("inactive", () => {
        setError(
          "The microphone disconnected. The recording so far has been kept.",
        );
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      });

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setStatus("recording");
      startTimer();
      setupAnalyser(stream);
    } catch (caught) {
      const denied =
        caught instanceof DOMException &&
        (caught.name === "NotAllowedError" ||
          caught.name === "SecurityError");

      setError(
        denied
          ? "Microphone access was denied. You can still submit the report without a voice note."
          : "No microphone is available. You can still submit the report without a voice note.",
      );
      setStatus("error");
      cleanupStream();
    }
  }, [
    cleanupAnalyser,
    cleanupStream,
    onRecorded,
    setupAnalyser,
    startTimer,
    stopTimer,
  ]);

  const handlePause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }
    recorder.pause();
    elapsedRef.current += (Date.now() - startedAtRef.current) / 1000;
    stopTimer();
    setStatus("paused");
  }, [stopTimer]);

  const handleResume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") {
      return;
    }
    recorder.resume();
    startedAtRef.current = Date.now();
    startTimer();
    setStatus("recording");
  }, [startTimer]);

  const handleStop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    if (recorder.state === "recording") {
      elapsedRef.current += (Date.now() - startedAtRef.current) / 1000;
    }
    recorder.stop();
    stopTimer();
    cleanupAnalyser();
    setLevel(0);
  }, [cleanupAnalyser, stopTimer]);

  const handleDiscard = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioUrl(null);
    setDuration(0);
    setLevel(0);
    setMimeType("");
    setError(null);
    setStatus("idle");
    chunksRef.current = [];
    onRecorded(null, null);
  }, [onRecorded]);

  const handleReRecord = useCallback(() => {
    handleDiscard();
    void handleStart();
  }, [handleDiscard, handleStart]);

  useEffect(() => {
    return () => {
      stopTimer();
      cleanupAnalyser();
      cleanupStream();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, [cleanupAnalyser, cleanupStream, stopTimer]);

  return (
    <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
          Voice note
        </h3>
        <span className="font-mono text-xs tabular-nums text-slate-300">
          {formatDuration(duration)}
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-cyan-400 transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>

      {error ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-5 text-amber-200">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {status === "idle" || status === "error" ? (
          <button
            type="button"
            onClick={() => void handleStart()}
            className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-rose-400"
          >
            ● Record
          </button>
        ) : null}

        {status === "recording" ? (
          <>
            <button type="button" onClick={handlePause} className={buttonClass}>
              Pause
            </button>
            <button type="button" onClick={handleStop} className={buttonClass}>
              Stop
            </button>
          </>
        ) : null}

        {status === "paused" ? (
          <>
            <button type="button" onClick={handleResume} className={buttonClass}>
              Resume
            </button>
            <button type="button" onClick={handleStop} className={buttonClass}>
              Stop
            </button>
          </>
        ) : null}

        {status === "ready" ? (
          <>
            <button
              type="button"
              onClick={handleDiscard}
              className={buttonClass}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleReRecord}
              className={buttonClass}
            >
              Re-record
            </button>
            {audioUrl ? (
              <a
                href={audioUrl}
                download={`voice-note${audioExtension(mimeType)}`}
                className="text-xs text-cyan-300 underline-offset-2 hover:underline"
              >
                Download
              </a>
            ) : null}
          </>
        ) : null}
      </div>

      {audioUrl ? (
        <audio controls src={audioUrl} className="w-full">
          <track kind="captions" />
        </audio>
      ) : null}

      <p className="text-xs leading-5 text-slate-500">
        No duration limit. Audio uploads when you submit the report.
      </p>
    </section>
  );
}
