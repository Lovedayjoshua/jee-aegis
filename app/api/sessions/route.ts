import { NextRequest, NextResponse } from "next/server";
import { StudySessionRecord } from "@/lib/study-coach/types";

const memorySessions: StudySessionRecord[] = [];

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export async function GET() {
  const supabase = getSupabaseConfig();
  if (supabase) {
    try {
      const res = await fetch(
        `${supabase.url}/rest/v1/study_sessions?select=*&order=started_at.desc&limit=20`,
        {
          headers: {
            apikey: supabase.key,
            Authorization: `Bearer ${supabase.key}`,
          },
          cache: "no-store",
        }
      );
      if (res.ok) {
        const rows = await res.json();
        return NextResponse.json({ source: "supabase", sessions: rows });
      }
    } catch {
      // Fall back to local memory store seamlessly
    }
  }

  return NextResponse.json({
    source: "local",
    sessions: memorySessions.slice(0, 20),
  });
}

export async function POST(request: NextRequest) {
  try {
    const record = (await request.json()) as StudySessionRecord;
    if (!record || !record.id || !record.scenarioId) {
      return NextResponse.json(
        { error: "Invalid session payload" },
        { status: 400 }
      );
    }

    memorySessions.unshift(record);
    if (memorySessions.length > 50) {
      memorySessions.length = 50;
    }

    const supabase = getSupabaseConfig();
    if (supabase) {
      try {
        await fetch(`${supabase.url}/rest/v1/study_sessions`, {
          method: "POST",
          headers: {
            apikey: supabase.key,
            Authorization: `Bearer ${supabase.key}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: record.id,
            scenario_id: record.scenarioId,
            scenario_title: record.scenarioTitle,
            mode: record.mode,
            started_at: record.startedAt,
            ended_at: record.endedAt,
            duration_seconds: record.durationSeconds,
            total_score: record.totalScore,
            max_score: record.maxScore,
            hints_used: record.hintsUsed,
            rubric: record.rubric,
          }),
        });

        if (record.steps.length > 0) {
          await fetch(`${supabase.url}/rest/v1/step_assessments`, {
            method: "POST",
            headers: {
              apikey: supabase.key,
              Authorization: `Bearer ${supabase.key}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify(
              record.steps.map((s) => ({
                id: s.id,
                session_id: record.id,
                step_number: s.stepNumber,
                status: s.status,
                concept: s.concept,
                hint_given: s.hintGiven,
                created_at: s.timestamp,
              }))
            ),
          });
        }
      } catch {
        // Non-blocking: local memory + client localStorage remain authoritative
      }
    }

    return NextResponse.json({ ok: true, id: record.id });
  } catch {
    return NextResponse.json(
      { error: "Failed to parse session payload" },
      { status: 400 }
    );
  }
}
