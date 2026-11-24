"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { StudySessionRecord } from "@/lib/study-coach/types";

interface SessionSummaryModalProps {
  summary: StudySessionRecord | null;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function buildMarkdownReport(summary: StudySessionRecord): string {
  const pct =
    summary.maxScore > 0
      ? Math.round((summary.totalScore / summary.maxScore) * 100)
      : 0;
  const lines = [
    `# SocraticLab Diagnostic Report — ${summary.scenarioTitle}`,
    `- **Mode:** ${summary.mode === "exam" ? "Timed Exam / Practical" : "Practice Coach"}`,
    `- **Duration:** ${formatDuration(summary.durationSeconds)}`,
    `- **Score:** ${summary.totalScore} / ${summary.maxScore} (${pct}%)`,
    `- **Hints Used:** ${summary.hintsUsed}`,
    "",
    "## Rubric Breakdown",
    ...summary.rubric.map(
      (r) =>
        `- **${r.label}:** ${r.score}/${r.maxScore}${r.feedback ? ` — ${r.feedback}` : ""}`
    ),
    "",
    "## Step-by-Step Assessment",
    ...(summary.steps.length === 0
      ? ["- No steps logged during this session."]
      : summary.steps.map(
          (s) =>
            `- **Step ${s.stepNumber} [${s.status.toUpperCase()}]** (${s.concept}): ${s.hintGiven}`
        )),
  ];
  return lines.join("\n");
}

export function SessionSummaryModal({
  summary,
  onClose,
}: SessionSummaryModalProps) {
  const [copied, setCopied] = useState(false);

  if (!summary) return null;

  const percentage =
    summary.maxScore > 0
      ? Math.round((summary.totalScore / summary.maxScore) * 100)
      : 0;
  const verifiedCount = summary.steps.filter(
    (s) => s.status === "correct"
  ).length;
  const issueSteps = summary.steps.filter(
    (s) => s.status === "error" || s.status === "warning"
  );

  const handleCopy = async () => {
    const md = buildMarkdownReport(summary);
    await navigator.clipboard.writeText(md).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const md = buildMarkdownReport(summary);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `socraticlab-${summary.scenarioId}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#070a18]/80 p-2.5 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-modal-title"
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-violet-500/30 bg-[#0f152d] text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#0b1024] px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wider text-violet-300 uppercase sm:text-xs">
              Post-Session Diagnostic Summary
            </p>
            <h2
              id="summary-modal-title"
              className="truncate text-base font-semibold text-white sm:text-lg"
            >
              {summary.scenarioTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close diagnostic summary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:space-y-5 sm:p-6">
          {/* Top KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-[#141b38] p-3">
              <p className="text-xs text-slate-400">Rubric Mastery</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {percentage}%
              </p>
              <p className="text-xs text-slate-400">
                {summary.totalScore}/{summary.maxScore} pts
              </p>
            </div>
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 p-3">
              <p className="text-xs text-emerald-300">Steps Verified</p>
              <p className="mt-1 text-2xl font-bold text-emerald-200">
                {verifiedCount}
              </p>
              <p className="text-xs text-emerald-300">Validated logic</p>
            </div>
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/15 p-3">
              <p className="text-xs text-amber-300">Mistakes Caught</p>
              <p className="mt-1 text-2xl font-bold text-amber-200">
                {issueSteps.length}
              </p>
              <p className="text-xs text-amber-300">Warnings &amp; errors</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#141b38] p-3">
              <p className="text-xs text-slate-400">Session Time</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {formatDuration(summary.durationSeconds)}
              </p>
              <p className="text-xs text-slate-400">
                {summary.hintsUsed} visual hints
              </p>
            </div>
          </div>

          {/* Rubric Scorecard */}
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Rubric Scorecard
            </h3>
            <div className="space-y-2">
              {summary.rubric.map((item) => {
                const ratio =
                  item.maxScore > 0 ? (item.score / item.maxScore) * 100 : 0;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-white/10 bg-[#141b38] p-3"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-white">
                        {item.label}
                      </span>
                      <span className="font-mono text-xs font-semibold text-violet-300">
                        {item.score} / {item.maxScore}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                    {item.feedback && (
                      <p className="mt-1.5 text-xs text-slate-300">
                        {item.feedback}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Concepts to Review */}
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Concepts to Review ({issueSteps.length})
            </h3>
            {issueSteps.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 p-3 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Clean execution — no unresolved errors were flagged during this
                  session.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {issueSteps.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#141b38] p-3 text-sm"
                  >
                    {step.status === "error" ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    )}
                    <div>
                      <p className="font-medium text-white">
                        Step {step.stepNumber}: {step.concept}
                      </p>
                      <p className="text-xs text-slate-300">{step.hintGiven}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-white/10 bg-[#0b1024] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3.5">
          <span className="text-xs text-slate-400">
            Saved locally for offline review
          </span>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 sm:min-h-[36px]"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:from-violet-500 hover:to-indigo-500 sm:min-h-[36px]"
            >
              <Download className="h-3.5 w-3.5" />
              Export .md
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
