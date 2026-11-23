"use client";

import {
  Camera,
  CameraOff,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { captureScaledJpegFrame } from "@/lib/video/frame-capturer";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sawScreen?: boolean;
  sawCamera?: boolean;
  modelUsed?: string;
}

type VoiceState = "idle" | "listening" | "processing" | "speaking";

const QUICK_PROMPTS = [
  "What am I looking at?",
  "Where should I click?",
  "Explain this error message",
  "Help me complete this form",
];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = String(reader.result ?? "");
      const idx = str.indexOf(",");
      resolve(idx >= 0 ? str.slice(idx + 1) : str);
    };
    reader.onerror = () => reject(new Error("Failed to read audio recording"));
    reader.readAsDataURL(blob);
  });
}

export function LiveCompanionWorkspace() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [screenActive, setScreenActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [ttsMuted, setTtsMuted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const getCaptureCanvas = useCallback(() => {
    if (!captureCanvasRef.current && typeof document !== "undefined") {
      captureCanvasRef.current = document.createElement("canvas");
    }
    return captureCanvasRef.current;
  }, []);

  const speakText = useCallback(
    (text: string) => {
      if (ttsMuted || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      utter.onstart = () => setVoiceState("speaking");
      utter.onend = () => setVoiceState("idle");
      utter.onerror = () => setVoiceState("idle");
      window.speechSynthesis.speak(utter);
    },
    [ttsMuted]
  );

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    setScreenActive(false);
  }, []);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const endConversation = useCallback(() => {
    stopScreenShare();
    stopCamera();
    stopRecording();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setVoiceState("idle");
    setMessages([]);
    setError(null);
  }, [stopScreenShare, stopCamera, stopRecording]);

  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  async function toggleScreenShare() {
    setError(null);
    if (screenActive) {
      stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "Screen sharing via getDisplayMedia is not supported in this browser. On Android, use the JEE AEGIS Connector app's MediaProjection Screen Share."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 15 } },
        audio: false,
      });
      const [track] = stream.getVideoTracks();
      if (track) {
        track.onended = () => stopScreenShare();
      }
      screenStreamRef.current = stream;
      setScreenActive(true);
      requestAnimationFrame(() => {
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = stream;
          screenVideoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Screen sharing permission was declined."
      );
    }
  }

  async function toggleCamera() {
    setError(null);
    if (cameraActive) {
      stopCamera();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          cameraVideoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera permission was declined.");
    }
  }

  const sendToCompanion = useCallback(
    async (textMsg?: string, audioBlob?: Blob) => {
      const trimmed = (textMsg ?? input).trim();
      if (!trimmed && !audioBlob && !screenActive && !cameraActive) return;

      setError(null);
      setSending(true);
      setVoiceState("processing");

      let screenFrameBase64: string | undefined;
      let cameraFrameBase64: string | undefined;

      const canvas = getCaptureCanvas();
      if (screenActive && screenVideoRef.current && canvas) {
        const frame = captureScaledJpegFrame(screenVideoRef.current, canvas, 1024, 576, 0.78);
        if (frame) screenFrameBase64 = frame;
      }
      if (cameraActive && cameraVideoRef.current && canvas) {
        const frame = captureScaledJpegFrame(cameraVideoRef.current, canvas, 768, 768, 0.78);
        if (frame) cameraFrameBase64 = frame;
      }

      let audioBase64: string | undefined;
      if (audioBlob) {
        audioBase64 = await blobToBase64(audioBlob);
      }

      const userEntry: ChatMessage = {
        id: `${Date.now()}-u`,
        role: "user",
        content: trimmed || (audioBlob ? "🎤 [Spoken voice message]" : "Inspect current view"),
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, userEntry]);
      if (!textMsg) setInput("");

      try {
        const res = await fetch("/api/companion/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            screenFrameBase64,
            cameraFrameBase64,
            audioBase64,
            audioMimeType: audioBlob?.type || "audio/webm",
            history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || data.error || "Live Companion failed");
        }

        const assistantEntry: ChatMessage = {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          sawScreen: data.sawScreen,
          sawCamera: data.sawCamera,
          modelUsed: data.modelUsed,
        };
        setMessages((prev) => [...prev, assistantEntry]);
        setVoiceState("idle");
        speakText(data.reply);
      } catch (err) {
        setVoiceState("idle");
        setError(err instanceof Error ? err.message : "Failed to reach AEGIS AI");
      } finally {
        setSending(false);
      }
    },
    [input, screenActive, cameraActive, messages, speakText, getCaptureCanvas]
  );

  async function toggleMicRecording() {
    setError(null);
    if (voiceState === "listening") {
      stopRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone access is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) {
          sendToCompanion("", blob);
        } else {
          setVoiceState("idle");
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setVoiceState("listening");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone permission was declined.");
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendToCompanion();
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 text-slate-100 sm:gap-4">
      {/* Companion Status Header */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-violet-500/20 bg-[#0f152d]/90 px-3 py-2.5 backdrop-blur sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-900/40 sm:h-9 sm:w-9">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">
              AEGIS Live Companion
            </h2>
            <p className="truncate text-[11px] text-slate-400 sm:text-xs">
              Screen-aware &amp; voice-enabled multimodal assistant
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              voiceState === "listening"
                ? "border-rose-400/40 bg-rose-500/20 text-rose-200"
                : voiceState === "processing"
                ? "border-amber-400/40 bg-amber-500/20 text-amber-200"
                : voiceState === "speaking"
                ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {voiceState === "listening"
              ? "Listening..."
              : voiceState === "processing"
              ? "Processing..."
              : voiceState === "speaking"
              ? "AI Speaking"
              : "Ready"}
          </span>

          <button
            type="button"
            onClick={() => {
              const next = !ttsMuted;
              setTtsMuted(next);
              if (next && typeof window !== "undefined" && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
              }
            }}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10"
            title={ttsMuted ? "Unmute AI Voice" : "Mute AI Voice"}
          >
            {ttsMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {ttsMuted ? "Muted" : "Voice On"}
          </button>

          <button
            type="button"
            onClick={endConversation}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            End
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/50 px-4 py-2.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Active Visual Previews (Screen Share & Camera) */}
      {(screenActive || cameraActive) && (
        <div className="grid gap-4 md:grid-cols-2">
          {screenActive && (
            <div className="overflow-hidden rounded-2xl border border-violet-500/40 bg-[#0b1024]">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-violet-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Screen Sharing Active
                </span>
                <button
                  type="button"
                  onClick={stopScreenShare}
                  className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30"
                >
                  Stop Sharing
                </button>
              </div>
              <video
                ref={screenVideoRef}
                muted
                playsInline
                className="aspect-video w-full bg-black object-contain"
              />
            </div>
          )}

          {cameraActive && (
            <div className="overflow-hidden rounded-2xl border border-indigo-500/40 bg-[#0b1024]">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-indigo-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Camera Assistance Active
                </span>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30"
                >
                  Stop Camera
                </button>
              </div>
              <video
                ref={cameraVideoRef}
                muted
                playsInline
                className="aspect-video w-full bg-black object-cover"
              />
            </div>
          )}
        </div>
      )}

      {/* Conversation Transcript */}
      <div className="min-h-[220px] max-h-[52dvh] flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1024]/80 p-3 sm:min-h-[280px] sm:max-h-[460px] sm:p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-4 text-center sm:py-8">
            <Sparkles className="mb-2.5 h-7 w-7 text-violet-400 sm:mb-3 sm:h-8 sm:w-8" />
            <h3 className="text-sm font-semibold text-white sm:text-base">
              Share your screen, camera, or speak with AEGIS
            </h3>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">
              Ask about errors on your screen, get step-by-step guidance on websites or apps, or
              read documents aloud.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendToCompanion(q)}
                  className="min-h-[40px] rounded-full border border-violet-500/30 bg-violet-500/10 px-3.5 py-2 text-xs text-violet-200 transition hover:bg-violet-500/20"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[92%] break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] sm:px-4 ${
                  m.role === "user"
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                    : "border border-white/10 bg-[#141b38] text-slate-100"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] opacity-75">
                  <span>{m.timestamp}</span>
                  {m.sawScreen && <span>• Screen Context</span>}
                  {m.sawCamera && <span>• Camera Context</span>}
                  {m.modelUsed && <span>• {m.modelUsed}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom Control Bar — mobile-first stacked input + 3-button media toolbar, unified on sm+ */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#0f152d] p-2.5 sm:flex-row sm:items-center"
      >
        <div className="grid grid-cols-3 gap-1.5 sm:flex sm:shrink-0 sm:items-center sm:gap-2">
          <button
            type="button"
            onClick={toggleMicRecording}
            disabled={sending}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:px-3 ${
              voiceState === "listening"
                ? "bg-rose-600 text-white"
                : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
            title="Speak with Microphone"
          >
            {voiceState === "listening" ? (
              <MicOff className="h-4 w-4 shrink-0" />
            ) : (
              <Mic className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              {voiceState === "listening" ? "Stop" : "Voice"}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleScreenShare}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:px-3 ${
              screenActive
                ? "bg-emerald-600 text-white"
                : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
            title="Share Screen (getDisplayMedia)"
          >
            {screenActive ? (
              <MonitorOff className="h-4 w-4 shrink-0" />
            ) : (
              <Monitor className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              {screenActive ? "Stop" : "Screen"}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleCamera}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:px-3 ${
              cameraActive
                ? "bg-indigo-600 text-white"
                : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
            title="Share Camera"
          >
            {cameraActive ? (
              <CameraOff className="h-4 w-4 shrink-0" />
            ) : (
              <Camera className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              {cameraActive ? "Stop" : "Camera"}
            </span>
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              screenActive
                ? "Ask AEGIS about your screen..."
                : "Message AEGIS Live Companion..."
            }
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/10 bg-[#080c1d] px-3.5 py-2.5 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none sm:text-sm"
          />

          <button
            type="submit"
            disabled={sending}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>Send</span>
          </button>
        </div>
      </form>
    </div>
  );
}
