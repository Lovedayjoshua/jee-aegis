"use client";

import {
  Camera,
  CameraOff,
  ImagePlus,
  Info,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getStoredToken, saveUserPreferences } from "@/lib/aegis/api";
import { captureScaledJpegFrame } from "@/lib/video/frame-capturer";

const COMPANION_STORAGE_KEY = "jee_aegis_companion_state_v1";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sawScreen?: boolean;
  sawCamera?: boolean;
  sawScreenshot?: boolean;
  modelUsed?: string;
  streaming?: boolean;
}

interface ScreenshotAttachment {
  name: string;
  dataUrl: string;
  base64: string;
  mimeType: string;
}

type VoiceState = "idle" | "listening" | "processing" | "speaking";

const QUICK_PROMPTS = [
  "What am I looking at?",
  "Where should I click?",
  "Explain this error message",
  "Help me complete this form",
];

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024; // 15 MB raw upload cap

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = String(reader.result ?? "");
      const idx = str.indexOf(",");
      resolve(idx >= 0 ? str.slice(idx + 1) : str);
    };
    reader.onerror = () => reject(new Error("Failed to read media file"));
    reader.readAsDataURL(blob);
  });
}

function compressImageFile(file: File, maxDim = 1024, quality = 0.78): Promise<ScreenshotAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read selected image."));
    reader.onload = () => {
      const srcDataUrl = String(reader.result ?? "");
      const img = new Image();
      img.onerror = () => reject(new Error("Selected file is not a valid image."));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          const comma = srcDataUrl.indexOf(",");
          resolve({
            name: file.name,
            dataUrl: srcDataUrl,
            base64: comma >= 0 ? srcDataUrl.slice(comma + 1) : srcDataUrl,
            mimeType: file.type || "image/jpeg",
          });
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const compressedUrl = canvas.toDataURL("image/jpeg", quality);
        const comma = compressedUrl.indexOf(",");
        resolve({
          name: file.name,
          dataUrl: compressedUrl,
          base64: comma >= 0 ? compressedUrl.slice(comma + 1) : compressedUrl,
          mimeType: "image/jpeg",
        });
      };
      img.src = srcDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function LiveCompanionWorkspace() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  // Media streams managed in React state so video elements attach reliably after mounting on iOS Safari/Chrome
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [switchingCamera, setSwitchingCamera] = useState(false);

  // iOS / browser screen-share capability detection
  const [screenShareSupported, setScreenShareSupported] = useState(true);

  // Screenshot upload state
  const [screenshot, setScreenshot] = useState<ScreenshotAttachment | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [ttsMuted, setTtsMuted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);

  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const screenActive = Boolean(screenStream);
  const cameraActive = Boolean(cameraStream);

  useEffect(() => {
    const supported =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function";
    setScreenShareSupported(supported);

    function restoreCompanionState() {
      try {
        const raw = window.localStorage.getItem(COMPANION_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          messages?: ChatMessage[];
          ttsMuted?: boolean;
        };
        if (Array.isArray(parsed.messages)) {
          setMessages(parsed.messages.filter((m) => !m.streaming));
        }
        if (typeof parsed.ttsMuted === "boolean") {
          setTtsMuted(parsed.ttsMuted);
        }
      } catch {
        // ignore storage errors
      }
    }

    restoreCompanionState();
    window.addEventListener("aegis:preferences-restored", restoreCompanionState);
    return () => window.removeEventListener("aegis:preferences-restored", restoreCompanionState);
  }, []);

  useEffect(() => {
    const settled = messages.filter((m) => !m.streaming).slice(-30);
    const snapshot = { messages: settled, ttsMuted };
    try {
      window.localStorage.setItem(COMPANION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage errors
    }
    const token = getStoredToken();
    if (token) {
      void saveUserPreferences(token, { companion_state: snapshot }).catch(() => {});
    }
  }, [messages, ttsMuted]);

  // Attach cameraStream to cameraVideoRef AFTER the <video> element mounts (fixes iOS Safari/Chrome black screen)
  useEffect(() => {
    const video = cameraVideoRef.current;
    if (!video || !cameraStream) return;

    video.srcObject = cameraStream;
    video.play().catch((err) => {
      console.error("Camera video playback error:", err);
    });

    return () => {
      if (video.srcObject === cameraStream) {
        video.srcObject = null;
      }
    };
  }, [cameraStream]);

  // Attach screenStream to screenVideoRef AFTER the <video> element mounts
  useEffect(() => {
    const video = screenVideoRef.current;
    if (!video || !screenStream) return;

    video.srcObject = screenStream;
    video.play().catch((err) => {
      console.error("Screen share playback error:", err);
    });

    return () => {
      if (video.srcObject === screenStream) {
        video.srcObject = null;
      }
    };
  }, [screenStream]);

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
    setScreenStream(null);
  }, []);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setCameraStream(null);
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const endConversation = useCallback(() => {
    abortControllerRef.current?.abort();
    stopScreenShare();
    stopCamera();
    stopRecording();
    setScreenshot(null);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setVoiceState("idle");
    setMessages([]);
    setError(null);
    setLastFailedPrompt(null);
  }, [stopScreenShare, stopCamera, stopRecording]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  async function requestCameraStream(preferredFacing: "environment" | "user") {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not supported in this browser.");
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: preferredFacing },
        audio: false,
      });
    } catch {
      // Fallback for devices/browsers that reject specific facingMode constraints
      return await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    }
  }

  async function toggleCamera() {
    setError(null);
    if (cameraActive) {
      stopCamera();
      return;
    }
    try {
      const stream = await requestCameraStream(cameraFacing);
      const [track] = stream.getVideoTracks();
      if (track) {
        track.onended = () => stopCamera();
      }
      cameraStreamRef.current = stream;
      setCameraStream(stream);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Camera unavailable: ${err.message}`
          : "Camera permission was declined or no camera was found."
      );
    }
  }

  async function flipCamera() {
    if (switchingCamera) return;
    setError(null);
    const nextFacing = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(nextFacing);

    if (!cameraActive) return;

    setSwitchingCamera(true);
    try {
      // Stop existing tracks first so iOS/Android hardware releases the camera cleanly
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;

      const stream = await requestCameraStream(nextFacing);
      const [track] = stream.getVideoTracks();
      if (track) {
        track.onended = () => stopCamera();
      }
      cameraStreamRef.current = stream;
      setCameraStream(stream);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not switch camera: ${err.message}`
          : "Unable to switch camera on this device."
      );
      stopCamera();
    } finally {
      setSwitchingCamera(false);
    }
  }

  async function toggleScreenShare() {
    setError(null);
    if (screenActive) {
      stopScreenShare();
      return;
    }
    if (!screenShareSupported || !navigator.mediaDevices?.getDisplayMedia) {
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
      setScreenStream(stream);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Screen sharing permission was declined."
      );
    }
  }

  async function handleScreenshotSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
      setError("Unsupported image format. Please choose a PNG, JPG, JPEG, or WEBP screenshot.");
      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError("Image is too large (maximum 15 MB). Please choose a smaller screenshot.");
      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
      return;
    }

    setUploadingScreenshot(true);
    try {
      const compressed = await compressImageFile(file, 1024, 0.78);
      setScreenshot(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process screenshot.");
    } finally {
      setUploadingScreenshot(false);
    }
  }

  const sendToCompanion = useCallback(
    async (textMsg?: string, audioBlob?: Blob) => {
      if (sending) return;
      const trimmed = (textMsg ?? input).trim();
      if (!trimmed && !audioBlob && !screenActive && !cameraActive && !screenshot) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 25000);

      setError(null);
      setLastFailedPrompt(null);
      setSending(true);
      setVoiceState("processing");

      let screenFrameBase64: string | undefined;
      let cameraFrameBase64: string | undefined;

      const canvas = getCaptureCanvas();
      if (screenActive && screenVideoRef.current && canvas) {
        const frame = captureScaledJpegFrame(screenVideoRef.current, canvas, 960, 540, 0.72);
        if (frame) screenFrameBase64 = frame;
      }
      if (cameraActive && cameraVideoRef.current && canvas) {
        const frame = captureScaledJpegFrame(cameraVideoRef.current, canvas, 720, 720, 0.72);
        if (frame) cameraFrameBase64 = frame;
      }

      let audioBase64: string | undefined;
      if (audioBlob) {
        audioBase64 = await blobToBase64(audioBlob);
      }

      const displayPrompt =
        trimmed ||
        (audioBlob
          ? "🎤 [Spoken voice message]"
          : screenshot
          ? `📸 Analyze screenshot (${screenshot.name})`
          : "Inspect current view");

      const nowTs = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const userEntry: ChatMessage = {
        id: `${Date.now()}-u`,
        role: "user",
        content: displayPrompt,
        timestamp: nowTs,
      };
      const assistantId = `${Date.now()}-a`;
      const placeholderAssistant: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: nowTs,
        sawScreen: Boolean(screenFrameBase64),
        sawCamera: Boolean(cameraFrameBase64),
        sawScreenshot: Boolean(screenshot),
        streaming: true,
      };

      const historySnapshot = messages
        .slice(-5)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userEntry, placeholderAssistant]);
      if (!textMsg) setInput("");

      try {
        const res = await fetch("/api/companion/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: trimmed,
            screenFrameBase64,
            cameraFrameBase64,
            screenshotBase64: screenshot?.base64,
            screenshotMimeType: screenshot?.mimeType,
            audioBase64,
            audioMimeType: audioBlob?.type || "audio/webm",
            history: historySnapshot,
            stream: true,
          }),
        });

        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          const errData = contentType.includes("application/json")
            ? await res.json()
            : { message: await res.text() };
          throw new Error(errData.message || errData.error || "Live Companion failed");
        }

        if (contentType.includes("application/x-ndjson") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let accumulated = "";
          let resolvedModel = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;
              const event = JSON.parse(line) as {
                type: string;
                text?: string;
                modelUsed?: string;
                message?: string;
              };
              if (event.type === "meta" && event.modelUsed) {
                resolvedModel = event.modelUsed;
              } else if (event.type === "delta" && event.text) {
                accumulated += event.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: accumulated,
                          modelUsed: resolvedModel || m.modelUsed,
                        }
                      : m
                  )
                );
              } else if (event.type === "error") {
                throw new Error(event.message || "Streaming response interrupted");
              }
            }
          }

          const finalContent =
            accumulated.trim() || "I received your input, please try again.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: finalContent,
                    modelUsed: resolvedModel || m.modelUsed,
                    streaming: false,
                  }
                : m
            )
          );
          setVoiceState("idle");
          speakText(finalContent);
        } else {
          const data = await res.json();
          const reply = data.reply || "I received your input, please try again.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: reply,
                    modelUsed: data.modelUsed,
                    sawScreen: data.sawScreen,
                    sawCamera: data.sawCamera,
                    sawScreenshot: data.sawScreenshot,
                    streaming: false,
                  }
                : m
            )
          );
          setVoiceState("idle");
          speakText(reply);
        }
      } catch (err) {
        setVoiceState("idle");
        // Remove empty streaming placeholder and preserve user's prompt for retry
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.message.toUpperCase().includes("TIMEOUT"));
        setError(
          isAbort
            ? "Request timed out after 25 seconds. Check your connection or tap Retry."
            : err instanceof Error
            ? err.message
            : "Failed to reach AEGIS AI"
        );
        if (trimmed) {
          setLastFailedPrompt(trimmed);
          setInput(trimmed);
        } else {
          setLastFailedPrompt("");
        }
      } finally {
        window.clearTimeout(timeoutId);
        setSending(false);
      }
    },
    [
      sending,
      input,
      screenActive,
      cameraActive,
      screenshot,
      messages,
      speakText,
      getCaptureCanvas,
    ]
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
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size > 0) {
          void sendToCompanion("", blob);
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
    void sendToCompanion();
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
              Streaming multimodal vision, screenshot &amp; voice assistant
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
              ? "AEGIS Thinking..."
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

      {/* Informational notice when browser does not support getDisplayMedia (e.g. iOS Safari/Chrome) */}
      {!screenShareSupported && (
        <div className="flex items-start gap-2.5 rounded-xl border border-indigo-400/25 bg-indigo-950/40 px-3.5 py-2.5 text-xs text-indigo-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
          <span>
            Screen sharing isn&apos;t supported in this browser. You can use Camera or Voice
            instead, or upload a screenshot for AEGIS to analyse.
          </span>
        </div>
      )}

      {/* Error banner with one-click Retry */}
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-950/50 px-4 py-2.5 text-xs text-rose-200">
          <span>{error}</span>
          {lastFailedPrompt !== null && !sending && (
            <button
              type="button"
              onClick={() => void sendToCompanion(lastFailedPrompt || undefined)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1 font-semibold text-rose-100 hover:bg-rose-500/30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      )}

      {/* Active Visual Previews (Screen Share, Camera, or Uploaded Screenshot) */}
      {(screenActive || cameraActive || screenshot) && (
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
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
                  className="min-h-[32px] rounded-lg bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30"
                >
                  Stop Sharing
                </button>
              </div>
              <video
                ref={screenVideoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full bg-black object-contain"
              />
            </div>
          )}

          {cameraActive && (
            <div className="overflow-hidden rounded-2xl border border-indigo-500/40 bg-[#0b1024]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-indigo-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Camera Assistance Active ({cameraFacing === "environment" ? "Rear" : "Front"})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void flipCamera()}
                    disabled={switchingCamera}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-100 hover:bg-white/15 disabled:opacity-50"
                    title="Flip Camera"
                  >
                    <RefreshCw className={`h-3 w-3 ${switchingCamera ? "animate-spin" : ""}`} />
                    Flip Camera
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="min-h-[32px] rounded-lg bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30"
                  >
                    Stop Camera
                  </button>
                </div>
              </div>
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full bg-black object-cover"
              />
            </div>
          )}

          {screenshot && (
            <div className="overflow-hidden rounded-2xl border border-emerald-500/40 bg-[#0b1024]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
                <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="truncate">Screenshot: {screenshot.name}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void sendToCompanion("Analyze this screenshot and explain what I should do.")}
                    className="min-h-[32px] rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    Analyze Now
                  </button>
                  <button
                    type="button"
                    onClick={() => screenshotInputRef.current?.click()}
                    className="min-h-[32px] rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/10"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScreenshot(null);
                      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
                    }}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30"
                    title="Remove Screenshot"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshot.dataUrl}
                alt="Selected screenshot preview"
                className="aspect-video w-full bg-black object-contain"
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
              Share your camera, screenshot, screen, or speak with AEGIS
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
                  disabled={sending}
                  onClick={() => void sendToCompanion(q)}
                  className="min-h-[40px] rounded-full border border-violet-500/30 bg-violet-500/10 px-3.5 py-2 text-xs text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
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
                {m.streaming && !m.content ? (
                  <div className="flex items-center gap-2 py-0.5 text-xs text-violet-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>AEGIS is thinking...</span>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] opacity-75">
                  <span>{m.timestamp}</span>
                  {m.sawScreen && <span>• Screen Context</span>}
                  {m.sawCamera && <span>• Camera Context</span>}
                  {m.sawScreenshot && <span>• Screenshot Context</span>}
                  {m.modelUsed && <span>• {m.modelUsed}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Hidden Screenshot File Input */}
      <input
        ref={screenshotInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleScreenshotSelect}
        className="hidden"
      />

      {/* Bottom Control Bar */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#0f152d] p-2.5 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:shrink-0 sm:flex-wrap sm:items-center sm:gap-2">
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
              {voiceState === "listening" ? "Stop Mic" : "Voice"}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleScreenShare}
            disabled={!screenShareSupported}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:px-3 ${
              !screenShareSupported
                ? "cursor-not-allowed border border-white/5 bg-white/5 text-slate-500"
                : screenActive
                ? "bg-emerald-600 text-white"
                : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
            title={
              screenShareSupported
                ? "Share Screen (getDisplayMedia)"
                : "Screen sharing requires a desktop browser or the Android Connector app"
            }
          >
            {screenActive ? (
              <MonitorOff className="h-4 w-4 shrink-0" />
            ) : (
              <Monitor className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              {!screenShareSupported
                ? "Screen (Desktop / Android App)"
                : screenActive
                ? "Stop Screen"
                : "Screen"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void toggleCamera()}
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
              {cameraActive ? "Stop Cam" : "Camera"}
            </span>
          </button>

          {cameraActive && (
            <button
              type="button"
              onClick={() => void flipCamera()}
              disabled={switchingCamera}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-indigo-400/30 bg-indigo-500/15 px-2.5 py-2 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-50 sm:px-3"
              title="Switch Front / Rear Camera"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 ${switchingCamera ? "animate-spin" : ""}`} />
              <span className="truncate">Flip Cam</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => screenshotInputRef.current?.click()}
            disabled={uploadingScreenshot}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:px-3 ${
              screenshot
                ? "border border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
                : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
            title="Upload Screenshot (PNG, JPG, WEBP)"
          >
            {uploadingScreenshot ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">Upload Screenshot</span>
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              screenshot
                ? "Ask about your uploaded screenshot..."
                : screenActive
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
