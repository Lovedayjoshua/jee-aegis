"use client";

import { BookOpen, GraduationCap } from "lucide-react";
import { StudyCoachWorkspace } from "@/components/study-coach/StudyCoachWorkspace";

const EXAM_BADGES = [
  "JAMB UTME",
  "WAEC SSCE",
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "PDF & Textbook Analysis",
];

export function StudySpaceWorkspace() {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-2.5 rounded-2xl border border-indigo-400/20 bg-gradient-to-r from-[#111938] via-[#131736] to-[#1a1338] px-3.5 py-3 text-slate-100 sm:px-5 sm:py-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 sm:h-9 sm:w-9">
            <GraduationCap className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">
              AEGIS Study Space
            </h2>
            <p className="text-xs text-slate-300">
              Step-by-step JAMB/WAEC prep, PDF/image analysis, and practice drills
            </p>
          </div>
        </div>
        <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {EXAM_BADGES.map((badge) => (
            <span
              key={badge}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-indigo-200"
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              {badge}
            </span>
          ))}
        </div>
      </div>

      {/* Preserved full educational workspace (scenarios, PDF/camera upload, KaTeX, drills, history) */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-50 shadow-xl">
        <StudyCoachWorkspace />
      </div>
    </div>
  );
}
