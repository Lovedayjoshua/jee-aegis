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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2.5 backdrop-blur-xs sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-modal-title"
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wider text-blue-700 uppercase sm:text-xs">
              Post-Session Diagnostic Summary
            </p>
            <h2
              id="summary-modal-title"
              className="truncate text-base font-semibold text-slate-900 sm:text-lg"
            >
              {summary.scenarioTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
            aria-label="Close diagnostic summary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:space-y-5 sm:p-6">
          {/* Top KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Rubric Mastery</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {percentage}%
              </p>
              <p className="text-xs text-slate-500">
                {summary.totalScore}/{summary.maxScore} pts
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
              <p className="text-xs text-emerald-700">Steps Verified</p>
              <p className="mt-1 text-2xl font-bold text-emerald-800">
                {verifiedCount}
              </p>
              <p className="text-xs text-emerald-700">Validated logic</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-xs text-amber-800">Mistakes Caught</p>
              <p className="mt-1 text-2xl font-bold text-amber-900">
                {issueSteps.length}
              </p>
              <p className="text-xs text-amber-800">Warnings & errors</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Session Time</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {formatDuration(summary.durationSeconds)}
              </p>
              <p className="text-xs text-slate-500">
                {summary.hintsUsed} visual hints
              </p>
            </div>
          </div>

          {/* Rubric Scorecard */}
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
              Rubric Scorecard
            </h3>
            <div className="space-y-2">
              {summary.rubric.map((item) => {
                const ratio =
                  item.maxScore > 0 ? (item.score / item.maxScore) * 100 : 0;
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-900">
                        {item.label}
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-700">
                        {item.score} / {item.maxScore}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                    {item.feedback && (
                      <p className="mt-1.5 text-xs text-slate-600">
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
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
              Concepts to Review ({issueSteps.length})
            </h3>
            {issueSteps.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
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
                    className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                  >
                    {step.status === "error" ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <div>
                      <p className="font-medium text-slate-900">
                        Step {step.stepNumber}: {step.concept}
                      </p>
                      <p className="text-xs text-slate-600">{step.hintGiven}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3.5">
          <span className="text-xs text-slate-500">
            Saved locally for offline review
          </span>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[36px]"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 sm:min-h-[36px]"
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
