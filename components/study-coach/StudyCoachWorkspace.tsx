"use client";

import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Lightbulb,
  Loader2,
  Mic,
  Monitor,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from "lucide-react";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { captureScaledJpegFrame } from "@/lib/video/frame-capturer";
import { getScenarioById, STUDY_SCENARIOS } from "@/lib/study-coach/scenarios";
import {
  AnalyzeWorkApiResponse,
  CoachMode,
  DrillQuestion,
  GroundingCitation,
  RubricCriterion,
  StepAssessment,
  StudySessionRecord,
  TranscriptEntry,
  VideoSourceMode,
  VisualHintCard,
} from "@/lib/study-coach/types";
import { KaTeXBlock } from "./KaTeXBlock";
import { SessionSummaryModal } from "./SessionSummaryModal";

type SidebarTab = "logic" | "hints" | "drill";

const LOCAL_STORAGE_KEY = "socraticlab_study_sessions_v1";

function nowLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function buildInitialRubric(scenarioId: string): RubricCriterion[] {
  return getScenarioById(scenarioId).rubric.map((item) => ({
    ...item,
    score: 0,
  }));
}

function detectSnippetKind(snippet: string): "latex" | "code" {
  const hasCodeSignals =
    snippet.includes("\n") ||
    /\b(def|for|while|if|return|const|let|function)\b/.test(snippet);
  const hasLatexSignals =
    snippet.includes("\\") ||
    snippet.includes("\\int") ||
    snippet.includes("\\frac") ||
    snippet.includes("^");
  if (hasCodeSignals && !snippet.includes("\\int") && !snippet.includes("\\frac")) {
    return "code";
  }
  return hasLatexSignals ? "latex" : "code";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = String(reader.result ?? "");
      const commaIdx = res.indexOf(",");
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(new Error("Failed to read media blob."));
    reader.readAsDataURL(blob);
  });
}

export function StudyCoachWorkspace() {
  const [scenarioId, setScenarioId] = useState<string>("math-ibp");
  const [mode, setMode] = useState<CoachMode>("coach");
  const [videoSource, setVideoSource] = useState<VideoSourceMode>("webcam");
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment"
  );
  const [activeTab, setActiveTab] = useState<SidebarTab>("logic");

  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState<boolean>(false);
  const [voiceReadoutEnabled, setVoiceReadoutEnabled] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [activeModelBadge, setActiveModelBadge] = useState<string>(
    "gemini-3.5-flash"
  );

  const [textQuestion, setTextQuestion] = useState<string>("");
  const [pdfAttachment, setPdfAttachment] = useState<{
    name: string;
    base64: string;
  } | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [steps, setSteps] = useState<StepAssessment[]>([]);
  const [rubric, setRubric] = useState<RubricCriterion[]>(() =>
    buildInitialRubric("math-ibp")
  );
  const [hints, setHints] = useState<VisualHintCard[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [latestReply, setLatestReply] = useState<string | null>(null);

  const [weaknessTopic, setWeaknessTopic] = useState<string | null>(null);
  const [drillQuestions, setDrillQuestions] = useState<DrillQuestion[]>([]);
  const [citations, setCitations] = useState<GroundingCitation[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>(
    {}
  );

  const [completedSummary, setCompletedSummary] =
    useState<StudySessionRecord | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const startedAtRef = useRef<string>("");

  const scenario = getScenarioById(scenarioId);

  const speakText = useCallback(
    (text: string, force = false) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      if (!force && !voiceReadoutEnabled) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    },
    [voiceReadoutEnabled]
  );

  const stopVideoStream = useCallback(() => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setVideoStream(null);
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoStream) return;
    video.srcObject = videoStream;
    video.play().catch((err) => {
      console.error("StudyCoach video play error:", err);
    });
    return () => {
      if (video.srcObject === videoStream) {
        video.srcObject = null;
      }
    };
  }, [videoStream]);

  const startVideoStream = useCallback(
    async (source: VideoSourceMode, cameraFacing: "environment" | "user") => {
      stopVideoStream();
      setErrorBanner(null);

      try {
        let stream: MediaStream;
        if (source === "webcam") {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: cameraFacing },
              audio: false,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        } else {
          if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
            setErrorBanner(
              "Screen sharing isn't supported in this browser. Switch to Webcam or type your question below."
            );
            return;
          }
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 10, max: 15 } },
            audio: false,
          });
        }

        videoStreamRef.current = stream;
        setVideoStream(stream);
        setIsCameraActive(true);

        const track = stream.getVideoTracks()[0];
        if (track) {
          track.onended = () => {
            setVideoStream(null);
            setIsCameraActive(false);
          };
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Camera or screen share permission denied.";
        setErrorBanner(msg);
      }
    },
    [stopVideoStream]
  );

  // Start webcam preview on mount & run session timer
  useEffect(() => {
    startedAtRef.current = new Date().toISOString();
    void startVideoStream("webcam", "environment");
    const timer = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    return () => {
      window.clearInterval(timer);
      stopVideoStream();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [startVideoStream, stopVideoStream]);

  const handleSelectScenario = (nextId: string) => {
    const next = getScenarioById(nextId);
    setScenarioId(next.id);
    setVideoSource(next.recommendedSource);
    setRubric(buildInitialRubric(next.id));
    setSteps([]);
    setHints([]);
    setTranscripts([]);
    setLatestReply(null);
    setWeaknessTopic(null);
    setDrillQuestions([]);
    setCitations([]);
    setSelectedAnswers({});
    setElapsedSeconds(0);
    startedAtRef.current = new Date().toISOString();
    void startVideoStream(next.recommendedSource, facingMode);
  };

  const handleSwitchVideoSource = (nextSource: VideoSourceMode) => {
    setVideoSource(nextSource);
    void startVideoStream(nextSource, facingMode);
  };

  const handleFlipCamera = () => {
    const nextFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextFacing);
    if (videoSource === "webcam") {
      void startVideoStream("webcam", nextFacing);
    }
  };

  const handlePdfUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setErrorBanner("Please attach a valid PDF lab manual or exam sheet.");
      return;
    }
    try {
      const base64 = await blobToBase64(file);
      setPdfAttachment({ name: file.name, base64 });
      setErrorBanner(null);
    } catch {
      setErrorBanner("Failed to read the attached PDF file.");
    }
  };

  const analyzeSnapshot = useCallback(
    async (audioBase64?: string, audioMimeType?: string) => {
      const hasText = Boolean(textQuestion.trim());
      const hasAudio = Boolean(audioBase64);
      let imageBase64: string | undefined;

      if (videoRef.current && isCameraActive) {
        if (!captureCanvasRef.current) {
          captureCanvasRef.current = document.createElement("canvas");
        }
        const captured = captureScaledJpegFrame(
          videoRef.current,
          captureCanvasRef.current,
          960,
          540,
          0.75
        );
        if (captured) imageBase64 = captured;
      }

      if (!imageBase64 && !hasText && !hasAudio) {
        setErrorBanner(
          "Enable your camera/screen or type a question below to get help."
        );
        return;
      }

      setIsAnalyzing(true);
      setErrorBanner(null);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 28000);

      try {
        const res = await fetch("/api/analyze-work", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            imageBase64,
            audioBase64,
            audioMimeType,
            referencePdfBase64: pdfAttachment?.base64,
            textQuestion: textQuestion.trim() || undefined,
            scenarioId,
            mode,
            previousSteps: steps,
          }),
        });

        const data = (await res.json()) as AnalyzeWorkApiResponse & {
          error?: string;
          message?: string;
        };

        if (!res.ok || !data.stage1) {
          throw new Error(data.message || "Analysis request failed.");
        }

        const { stage1, drill, citations: nextCitations, models } = data;
        setActiveModelBadge(models.stage1);
        setTextQuestion("");

        const ts = nowLabel();

        // Update Step Checks
        if (stage1.step_checks.length > 0) {
          setSteps((prev) => [
            ...prev,
            ...stage1.step_checks.map((sc) => ({
              id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              stepNumber: sc.step_number,
              status: sc.status,
              concept: sc.concept,
              lineQuote: sc.line_quote,
              hintGiven: sc.feedback,
              timestamp: ts,
            })),
          ]);
        }

        // Update Rubric
        if (stage1.rubric_updates.length > 0) {
          setRubric((prev) =>
            prev.map((item) => {
              const update = stage1.rubric_updates.find(
                (u) => u.criterion_id === item.id
              );
              if (!update) return item;
              return {
                ...item,
                score: Math.max(
                  0,
                  Math.min(item.maxScore, item.score + update.score_delta)
                ),
                feedback: update.feedback,
                lastUpdated: ts,
              };
            })
          );
        }

        // Update Visual Hint Card
        if (stage1.visual_hint?.formula_or_code) {
          setHints((prev) => [
            {
              id: `hint-${Date.now()}`,
              title: stage1.visual_hint.title || "Socratic Hint",
              snippet: stage1.visual_hint.formula_or_code,
              explanation: stage1.visual_hint.explanation,
              kind: detectSnippetKind(stage1.visual_hint.formula_or_code),
              timestamp: ts,
            },
            ...prev,
          ]);
        }

        // Update Transcripts (work, student voice, coach reply)
        const newEntries: TranscriptEntry[] = [];
        if (stage1.transcribed_work) {
          newEntries.push({
            id: `work-${Date.now()}`,
            speaker: "work",
            text: stage1.transcribed_work,
            timestamp: ts,
          });
        }
        if (stage1.voice_transcript) {
          newEntries.push({
            id: `student-${Date.now()}`,
            speaker: "student",
            text: stage1.voice_transcript,
            timestamp: ts,
          });
        }
        if (stage1.socratic_reply) {
          newEntries.push({
            id: `coach-${Date.now()}`,
            speaker: "coach",
            text: stage1.socratic_reply,
            timestamp: ts,
          });
          setLatestReply(stage1.socratic_reply);
          speakText(stage1.socratic_reply);
        }
        if (newEntries.length > 0) {
          setTranscripts((prev) => [...prev, ...newEntries]);
        }

        // Update Stage 2 Grounded Drill
        if (Array.isArray(drill) && drill.length > 0) {
          setWeaknessTopic(stage1.weakness_topic);
          setDrillQuestions(drill);
          setCitations(nextCitations ?? []);
          setSelectedAnswers({});
        }
      } catch (err) {
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.message.toUpperCase().includes("TIMEOUT"));
        const msg = isAbort
          ? "Analysis timed out. Please tap Retry or check your connection."
          : err instanceof Error
          ? err.message
          : "Failed to analyze work.";
        setErrorBanner(msg);
      } finally {
        window.clearTimeout(timeoutId);
        setIsAnalyzing(false);
      }
    },
    [
      isCameraActive,
      mode,
      pdfAttachment?.base64,
      scenarioId,
      speakText,
      steps,
      textQuestion,
    ]
  );

  // Push-to-Talk via MediaRecorder
  const startVoiceRecording = async () => {
    if (isAnalyzing || isRecordingVoice) return;
    setErrorBanner(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;

        if (blob.size > 0) {
          const audioBase64 = await blobToBase64(blob);
          void analyzeSnapshot(audioBase64, mimeType);
        } else {
          void analyzeSnapshot();
        }
      };

      recorder.start();
      setIsRecordingVoice(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Microphone permission denied.";
      setErrorBanner(msg);
    }
  };

  const stopVoiceRecording = () => {
    if (!isRecordingVoice || !mediaRecorderRef.current) return;
    setIsRecordingVoice(false);
    if (mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleEndAndGrade = () => {
    const endedAt = new Date().toISOString();
    const totalScore = rubric.reduce((acc, r) => acc + r.score, 0);
    const maxScore = rubric.reduce((acc, r) => acc + r.maxScore, 0);

    const record: StudySessionRecord = {
      id: `sess-${Date.now()}`,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      mode,
      startedAt: startedAtRef.current || endedAt,
      endedAt,
      durationSeconds: elapsedSeconds,
      totalScore,
      maxScore,
      steps: [...steps],
      rubric: [...rubric],
      hintsUsed: hints.length,
    };

    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      const prev = raw ? (JSON.parse(raw) as StudySessionRecord[]) : [];
      window.localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify([record, ...prev].slice(0, 20))
      );
    } catch {
      // Ignore storage errors
    }

    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).catch(() => {});

    setCompletedSummary(record);
  };

  const totalScore = rubric.reduce((sum, r) => sum + r.score, 0);
  const maxScore = rubric.reduce((sum, r) => sum + r.maxScore, 0);
  const masteryPct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const examRemaining = Math.max(
    0,
    scenario.durationMinutes * 60 - elapsedSeconds
  );

  return (
    <div className="flex min-h-0 flex-col bg-[#0b1024] text-slate-100">
      {/* Top Academic Header */}
      <header className="border-b border-white/10 bg-[#0f152d] px-3 py-2.5 sm:px-6 sm:py-3">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-900/40 sm:h-9 sm:w-9">
                <GraduationCap className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h1 className="text-sm font-bold tracking-tight text-white sm:text-base">
                    AEGIS Study Coach
                  </h1>
                  <span className="truncate rounded border border-violet-400/30 bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-200">
                    {activeModelBadge}
                  </span>
                </div>
                <p className="truncate text-[11px] text-slate-400 sm:text-xs">
                  Multimodal Exam &amp; Lab Practical Study Coach
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-[#141b38] px-2 py-1.5 font-mono text-xs font-semibold text-slate-200 lg:hidden">
              <Clock className="h-3.5 w-3.5 text-violet-400" />
              <span>
                {mode === "exam"
                  ? formatTimer(examRemaining)
                  : formatTimer(elapsedSeconds)}
              </span>
            </div>
          </div>

          {/* Scenario Quick-Load Pills — horizontal scroll on mobile, wrapped on desktop */}
          <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {STUDY_SCENARIOS.map((item) => {
              const active = item.id === scenarioId;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => handleSelectScenario(item.id)}
                  className={`min-h-[38px] shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-violet-400/50 bg-violet-500/20 text-violet-100"
                      : "border-white/10 bg-[#141b38] text-slate-300 hover:border-white/20 hover:bg-white/10"
                  } disabled:opacity-60`}
                >
                  {item.title}
                </button>
              );
            })}
          </div>

          {/* Mode Toggle + Timer + End & Grade */}
          <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
            <div className="inline-flex rounded-lg border border-white/10 bg-[#080c1d] p-0.5">
              <button
                type="button"
                onClick={() => setMode("coach")}
                className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "coach"
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Practice Coach
              </button>
              <button
                type="button"
                onClick={() => setMode("exam")}
                className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "exam"
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Timed Exam
              </button>
            </div>

            <div className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-[#141b38] px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-200 lg:flex">
              <Clock className="h-3.5 w-3.5 text-violet-400" />
              <span>
                {mode === "exam"
                  ? formatTimer(examRemaining)
                  : formatTimer(elapsedSeconds)}
              </span>
            </div>

            <button
              type="button"
              onClick={handleEndAndGrade}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/25"
            >
              <Square className="h-3 w-3 fill-current text-rose-400" />
              End &amp; Grade
            </button>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {errorBanner && (
        <div className="border-b border-rose-500/30 bg-rose-950/60 px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 text-sm text-rose-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{errorBanner}</span>
            </div>
            <div className="flex items-center gap-3">
              {(isCameraActive || textQuestion.trim()) && !isAnalyzing && (
                <button
                  type="button"
                  onClick={() => void analyzeSnapshot()}
                  className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="text-xs font-semibold text-rose-300 underline hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace (65% Stage / 35% Sidebar) */}
      <main className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-3 p-2.5 sm:gap-4 sm:p-4 lg:grid-cols-12 lg:p-6">
        {/* Left Stage */}
        <section className="flex min-w-0 flex-col gap-3 sm:gap-3.5 lg:col-span-7 xl:col-span-8">
          {/* Scenario Task Strip */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-[#0f152d] px-3.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wider text-violet-300 uppercase">
                  {scenario.subject}
                </p>
                <p className="text-sm font-medium leading-snug text-white">
                  {scenario.sampleProblem}
                </p>
              </div>
            </div>

            {/* Attach Lab / Exam PDF Pill */}
            <div className="flex items-center gap-2">
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                onChange={handlePdfUpload}
                className="hidden"
              />
              {pdfAttachment ? (
                <div className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/20 px-3 py-1 text-xs font-medium text-violet-100">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[160px] truncate">
                    {pdfAttachment.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPdfAttachment(null);
                      if (pdfInputRef.current) pdfInputRef.current.value = "";
                    }}
                    className="rounded-full p-1 hover:bg-violet-500/30"
                    aria-label="Remove attached PDF"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-white/10 bg-[#141b38] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
                >
                  <Paperclip className="h-3.5 w-3.5 text-violet-300" />
                  Attach Lab/Exam PDF
                </button>
              )}
            </div>
          </div>

          {/* Live Camera / Screen Preview */}
          <div className="relative flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#070a18] shadow-xs sm:min-h-[340px] lg:min-h-[460px]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full flex-1 object-contain"
            />

            {/* Status Overlay */}
            <div className="pointer-events-none absolute top-2.5 left-2.5 right-2.5 flex items-center gap-2 sm:top-3 sm:left-3">
              <div
                className={`inline-flex max-w-full items-center gap-2 truncate rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold backdrop-blur-xs sm:px-3 sm:text-[11px] ${
                  isAnalyzing
                    ? "border-amber-400/40 bg-[#0f152d]/90 text-amber-300"
                    : isRecordingVoice
                      ? "border-rose-400/50 bg-[#0f152d]/90 text-rose-300"
                      : isCameraActive
                        ? "border-emerald-400/40 bg-[#0f152d]/90 text-emerald-300"
                        : "border-white/15 bg-[#0f152d]/90 text-slate-300"
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    isAnalyzing
                      ? "animate-pulse bg-amber-400"
                      : isRecordingVoice
                        ? "animate-ping bg-rose-400"
                        : isCameraActive
                           ? "bg-emerald-400"
                           : "bg-slate-400"
                  }`}
                />
                <span className="truncate">
                  {isAnalyzing
                    ? `ANALYZING (${activeModelBadge.toUpperCase()})...`
                    : isRecordingVoice
                      ? "RECORDING VOICE QUESTION..."
                      : isCameraActive
                        ? `${videoSource === "webcam" ? "WEBCAM" : "SCREEN"} READY`
                        : "VIDEO INACTIVE"}
                </span>
              </div>
            </div>

            {!isCameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center sm:p-6">
                <button
                  type="button"
                  onClick={() => startVideoStream(videoSource, facingMode)}
                  className="min-h-[44px] rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-violet-900/30 hover:from-violet-500 hover:to-indigo-500"
                >
                  Enable {videoSource === "webcam" ? "Webcam" : "Screen Share"}
                </button>
              </div>
            )}
          </div>

          {/* Latest Spoken Coach Reply Banner */}
          {latestReply && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-[11px] font-bold tracking-wider text-violet-300 uppercase">
                  Coach Socratic Feedback
                </p>
                <p className="text-sm leading-relaxed text-slate-100">
                  {latestReply}
                </p>
              </div>
              <button
                type="button"
                onClick={() => speakText(latestReply, true)}
                className="shrink-0 rounded-lg border border-violet-400/30 bg-[#141b38] p-2 text-violet-200 hover:bg-violet-500/25"
                title="Replay spoken feedback"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Multimodal Capture & Action Controls */}
          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0f152d] px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <div className="inline-flex rounded-lg border border-white/10 bg-[#080c1d] p-0.5">
                  <button
                    type="button"
                    onClick={() => handleSwitchVideoSource("webcam")}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      videoSource === "webcam"
                        ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Webcam
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchVideoSource("screen")}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      videoSource === "screen"
                        ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    Screen
                  </button>
                </div>

                {videoSource === "webcam" && (
                  <button
                    type="button"
                    onClick={handleFlipCamera}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#141b38] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {facingMode === "environment" ? "Rear" : "Front"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const next = !voiceReadoutEnabled;
                    setVoiceReadoutEnabled(next);
                    if (!next && "speechSynthesis" in window) {
                      window.speechSynthesis.cancel();
                    }
                  }}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    voiceReadoutEnabled
                      ? "border-white/10 bg-[#141b38] text-slate-200 hover:bg-white/10"
                      : "border-white/10 bg-[#080c1d] text-slate-400"
                  }`}
                >
                  {voiceReadoutEnabled ? (
                    <>
                      <Volume2 className="h-3.5 w-3.5 text-violet-400" />
                      Voice On
                    </>
                  ) : (
                    <>
                      <VolumeX className="h-3.5 w-3.5" />
                      Muted
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                {/* Push-to-Talk */}
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onMouseDown={startVoiceRecording}
                  onMouseUp={stopVoiceRecording}
                  onMouseLeave={() => {
                    if (isRecordingVoice) stopVoiceRecording();
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    void startVoiceRecording();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    stopVoiceRecording();
                  }}
                  className={`inline-flex min-h-[44px] select-none items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors sm:min-h-[38px] sm:gap-2 sm:px-3.5 ${
                    isRecordingVoice
                      ? "border-rose-500 bg-rose-600 text-white shadow-sm"
                      : "border-white/15 bg-[#141b38] text-slate-100 hover:bg-white/10"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Mic className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {isRecordingVoice ? "Release..." : "Hold to Ask"}
                  </span>
                </button>

                {/* Primary Snap & Grade Step CTA */}
                <button
                  type="button"
                  disabled={isAnalyzing || (!isCameraActive && !textQuestion.trim())}
                  onClick={() => void analyzeSnapshot()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[38px] sm:gap-2 sm:px-4"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      <span className="truncate">Grading...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Snap &amp; Grade</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Optional quick text question — 16px on mobile prevents iOS zoom */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isAnalyzing && (isCameraActive || textQuestion.trim())) {
                  void analyzeSnapshot();
                }
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={textQuestion}
                onChange={(e) => setTextQuestion(e.target.value)}
                placeholder="Type a JAMB/WAEC or step question..."
                className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-white/10 bg-[#141b38] px-3 py-2 text-base text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none sm:min-h-[38px] sm:text-xs"
              />
              <button
                type="submit"
                disabled={isAnalyzing || !textQuestion.trim()}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-500/20 px-3.5 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/30 disabled:opacity-50 sm:min-h-[38px]"
              >
                <Send className="h-3.5 w-3.5" />
                Ask
              </button>
            </form>
          </div>
        </section>

        {/* Right Sidebar (3 Tabs) */}
        <aside className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-[#0f152d] lg:col-span-5 xl:col-span-4">
          {/* Tab Switcher */}
          <div className="grid grid-cols-3 gap-1 border-b border-white/10 bg-[#080c1d] p-1">
            <button
              type="button"
              onClick={() => setActiveTab("logic")}
              className={`min-h-[42px] rounded-lg px-1.5 py-1.5 text-[11px] font-semibold leading-tight transition-colors sm:text-xs ${
                activeTab === "logic"
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Rubric ({steps.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("hints")}
              className={`min-h-[42px] rounded-lg px-1.5 py-1.5 text-[11px] font-semibold leading-tight transition-colors sm:text-xs ${
                activeTab === "hints"
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Hints ({hints.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("drill")}
              className={`min-h-[42px] rounded-lg px-1.5 py-1.5 text-[11px] font-semibold leading-tight transition-colors sm:text-xs ${
                activeTab === "drill"
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Drill ({drillQuestions.length})
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* TAB 1: Logic & Rubric */}
            {activeTab === "logic" && (
              <>
                {/* Mastery Meter */}
                <div className="rounded-xl border border-white/10 bg-[#141b38]/60 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold tracking-wider text-slate-300 uppercase">
                      Rubric Mastery
                    </span>
                    <span className="font-mono text-xs font-bold text-violet-300">
                      {totalScore}/{maxScore} ({masteryPct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
                      style={{ width: `${masteryPct}%` }}
                    />
                  </div>
                  <div className="mt-3 space-y-2">
                    {rubric.map((item) => {
                      const pct =
                        item.maxScore > 0
                          ? Math.round((item.score / item.maxScore) * 100)
                          : 0;
                      return (
                        <div
                          key={item.id}
                          className="rounded-lg border border-white/10 bg-[#0b1024] p-2.5"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-white">
                              {item.label}
                            </span>
                            <span className="font-mono font-semibold text-slate-300">
                              {item.score}/{item.maxScore}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {item.feedback || item.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step-by-Step Logic Tracker */}
                <div>
                  <h2 className="mb-2 text-xs font-bold tracking-wider text-slate-300 uppercase">
                    Step-by-Step Verification
                  </h2>
                  {steps.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 bg-[#0b1024]/60 p-6 text-center text-xs text-slate-400">
                      Click <strong className="text-white">Snap &amp; Grade</strong> or{" "}
                      <strong className="text-white">Hold to Ask</strong> to transcribe and grade
                      your work.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {steps.map((step) => {
                        const style =
                          step.status === "correct"
                            ? "border-emerald-400/30 bg-emerald-500/15"
                            : step.status === "warning"
                              ? "border-amber-400/30 bg-amber-500/15"
                              : "border-rose-400/30 bg-rose-500/15";
                        return (
                          <div
                            key={step.id}
                            className={`rounded-lg border p-3 ${style}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                {step.status === "correct" ? (
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                ) : step.status === "warning" ? (
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                                ) : (
                                  <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
                                )}
                                <span className="text-xs font-semibold text-white">
                                  Step {step.stepNumber}: {step.concept}
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-slate-400">
                                {step.timestamp}
                              </span>
                            </div>
                            {step.lineQuote && (
                              <pre className="mt-1.5 overflow-x-auto rounded border border-white/10 bg-[#080c1d] px-2 py-1 font-mono text-[11px] text-slate-200">
                                {step.lineQuote}
                              </pre>
                            )}
                            <p className="mt-1.5 text-xs leading-snug text-slate-200">
                              {step.hintGiven}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* TAB 2: Socratic Hint & Transcripts */}
            {activeTab === "hints" && (
              <>
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <Lightbulb className="h-4 w-4 text-amber-400" />
                    <h2 className="text-xs font-bold tracking-wider text-slate-300 uppercase">
                      Visual Hint Cards
                    </h2>
                  </div>
                  {hints.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 bg-[#0b1024]/60 p-5 text-center text-xs text-slate-400">
                      KaTeX formulas and code pattern hints appear here after
                      analysis.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {hints.map((hint) => (
                        <div
                          key={hint.id}
                          className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-white">
                              {hint.title}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              {hint.timestamp}
                            </span>
                          </div>
                          <KaTeXBlock snippet={hint.snippet} kind={hint.kind} />
                          {hint.explanation && (
                            <p className="mt-1.5 text-xs text-slate-300">
                              {hint.explanation}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h2 className="mb-2 text-xs font-bold tracking-wider text-slate-300 uppercase">
                    Work &amp; Voice Log
                  </h2>
                  {transcripts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 bg-[#0b1024]/60 p-5 text-center text-xs text-slate-400">
                      Transcribed handwriting, voice questions, and coach
                      replies will be logged here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {transcripts.map((entry) => (
                        <div
                          key={entry.id}
                          className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                            entry.speaker === "coach"
                              ? "border-violet-400/30 bg-violet-500/15"
                              : entry.speaker === "work"
                                ? "border-white/10 bg-[#080c1d] font-mono text-[11px]"
                                : "border-emerald-400/30 bg-emerald-500/15"
                          }`}
                        >
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="text-[10px] font-bold tracking-wide text-slate-300 uppercase">
                              {entry.speaker === "coach"
                                ? "Coach"
                                : entry.speaker === "work"
                                  ? "Transcribed Work"
                                  : "Student Voice"}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              {entry.timestamp}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-slate-100">
                            {entry.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* TAB 3: Grounded Exam Micro-Drill */}
            {activeTab === "drill" && (
              <>
                {drillQuestions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/15 bg-[#0b1024]/60 p-6 text-center text-xs text-slate-400">
                    After you snap a step, Gemini generates a 2-question
                    practice drill grounded in real exam standards via Google
                    Search.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {weaknessTopic && (
                      <div className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-3 py-2">
                        <p className="text-[10px] font-bold tracking-wider text-violet-300 uppercase">
                          Targeted Practice Topic
                        </p>
                        <p className="text-xs font-semibold text-white">
                          {weaknessTopic}
                        </p>
                      </div>
                    )}

                    {drillQuestions.map((q, qIdx) => {
                      const chosen = selectedAnswers[q.id];
                      const answered = chosen !== undefined;
                      return (
                        <div
                          key={q.id}
                          className="rounded-xl border border-white/10 bg-[#141b38]/70 p-3.5"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-bold text-slate-400 uppercase">
                              Question {qIdx + 1}
                            </span>
                            <span className="rounded border border-white/10 bg-[#0b1024] px-2 py-0.5 text-[10px] font-medium text-violet-200">
                              {q.examStandard}
                            </span>
                          </div>
                          <p className="text-xs font-semibold leading-relaxed text-white">
                            {q.question}
                          </p>
                          <div className="mt-2.5 space-y-1.5">
                            {q.options.map((opt, optIdx) => {
                              const isSelected = chosen === optIdx;
                              const isCorrect = optIdx === q.correctIndex;
                              let btnClass =
                                "border-white/10 bg-[#0b1024] text-slate-200 hover:bg-white/10";
                              if (answered) {
                                if (isCorrect) {
                                  btnClass =
                                    "border-emerald-400/50 bg-emerald-500/20 text-emerald-100 font-semibold";
                                } else if (isSelected) {
                                  btnClass =
                                    "border-rose-400/50 bg-rose-500/20 text-rose-100";
                                }
                              }
                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  onClick={() =>
                                    setSelectedAnswers((prev) => ({
                                      ...prev,
                                      [q.id]: optIdx,
                                    }))
                                  }
                                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${btnClass}`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                          {answered && (
                            <div className="mt-2.5 rounded-lg border border-white/10 bg-[#0b1024] p-2.5 text-xs text-slate-300">
                              <span className="font-semibold text-white">
                                Explanation:{" "}
                              </span>
                              {q.explanation}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {citations.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-[#0b1024] p-3">
                        <p className="mb-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          Google Search Grounding Sources
                        </p>
                        <ul className="space-y-1.5">
                          {citations.map((c) => (
                            <li key={c.url}>
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:underline"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="line-clamp-1">{c.title}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </main>

      <SessionSummaryModal
        summary={completedSummary}
        onClose={() => setCompletedSummary(null)}
      />
    </div>
  );
}
