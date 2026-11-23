import { NextRequest, NextResponse } from "next/server";
import { Part, Schema, ThinkingLevel, Type } from "@google/genai";
import {
  generateContentWithFallback,
  MissingApiKeyError,
} from "@/lib/gemini/client";
import { buildStage1CoachPrompt } from "@/lib/study-coach/prompts";
import { getScenarioById } from "@/lib/study-coach/scenarios";
import {
  CoachMode,
  DrillQuestion,
  GroundingCitation,
  Stage1AnalysisResult,
  StepAssessment,
} from "@/lib/study-coach/types";

interface AnalyzeWorkRequestBody {
  imageBase64?: string;
  audioBase64?: string;
  audioMimeType?: string;
  referencePdfBase64?: string;
  textQuestion?: string;
  scenarioId?: string;
  mode?: CoachMode;
  previousSteps?: StepAssessment[];
}

const STAGE1_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    transcribed_work: {
      type: Type.STRING,
      description:
        "Exact line-by-line transcription of handwritten equations, code, or circuit diagrams visible in the image.",
    },
    voice_transcript: {
      type: Type.STRING,
      description:
        "Transcription of what the student asked in their audio recording, or empty string if no audio.",
    },
    step_checks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          step_number: { type: Type.INTEGER },
          status: {
            type: Type.STRING,
            enum: ["correct", "warning", "error"],
          },
          concept: { type: Type.STRING },
          line_quote: {
            type: Type.STRING,
            description: "Exact quote of the line/component from the student's work.",
          },
          feedback: { type: Type.STRING },
        },
        required: ["step_number", "status", "concept", "line_quote", "feedback"],
      },
    },
    rubric_updates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          criterion_id: { type: Type.STRING },
          score_delta: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
        },
        required: ["criterion_id", "score_delta", "feedback"],
      },
    },
    socratic_reply: {
      type: Type.STRING,
      description:
        "Concise 2-3 sentence spoken-style Socratic coaching response pointing to the exact line/component and asking a guiding question without spoiling the final answer.",
    },
    visual_hint: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        formula_or_code: { type: Type.STRING },
        explanation: { type: Type.STRING },
      },
      required: ["title", "formula_or_code", "explanation"],
    },
    weakness_topic: {
      type: Type.STRING,
      description:
        "Specific STEM concept missed or currently being practiced, for grounded drill generation.",
    },
  },
  required: [
    "transcribed_work",
    "voice_transcript",
    "step_checks",
    "rubric_updates",
    "socratic_reply",
    "visual_hint",
    "weakness_topic",
  ],
};

function stripDataUrlPrefix(b64: string): string {
  const idx = b64.indexOf(",");
  return idx >= 0 ? b64.slice(idx + 1) : b64;
}

function parseJsonFromText<T>(raw: string): T {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(candidate) as T;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AnalyzeWorkRequestBody;

    if (!body.imageBase64 && !body.textQuestion?.trim() && !body.audioBase64) {
      return NextResponse.json(
        {
          error: "MISSING_INPUT",
          message: "Provide a camera snapshot, voice recording, or text question.",
        },
        { status: 400 }
      );
    }

    const scenario = getScenarioById(body.scenarioId ?? "math-ibp");
    const mode: CoachMode = body.mode === "exam" ? "exam" : "coach";
    const previousSteps = Array.isArray(body.previousSteps)
      ? body.previousSteps
      : [];

    // ------------------------------------------------------------------
    // Stage 1: Multimodal Work & Voice Analyzer (ThinkingLevel.HIGH)
    // ------------------------------------------------------------------
    const stage1Parts: Part[] = [];
    if (body.imageBase64) {
      stage1Parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: stripDataUrlPrefix(body.imageBase64),
        },
      });
    }

    if (body.audioBase64) {
      stage1Parts.push({
        inlineData: {
          mimeType: body.audioMimeType || "audio/webm",
          data: stripDataUrlPrefix(body.audioBase64),
        },
      });
    }

    if (body.referencePdfBase64) {
      stage1Parts.push({
        inlineData: {
          mimeType: "application/pdf",
          data: stripDataUrlPrefix(body.referencePdfBase64),
        },
      });
    }

    stage1Parts.push({
      text: buildStage1CoachPrompt(
        scenario,
        mode,
        previousSteps,
        body.textQuestion?.trim()
      ),
    });

    const stage1Call = await generateContentWithFallback({
      contents: [{ role: "user", parts: stage1Parts }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: "application/json",
        responseSchema: STAGE1_RESPONSE_SCHEMA,
      },
    });

    const stage1Text = stage1Call.response.text ?? "";
    const stage1 = parseJsonFromText<Stage1AnalysisResult>(stage1Text);

    // ------------------------------------------------------------------
    // Stage 2: Grounded Exam Micro-Drill Generator (ThinkingLevel.LOW + Google Search)
    // ------------------------------------------------------------------
    const weakness = stage1.weakness_topic || scenario.title;
    const stage2Prompt = `Search for real WAEC, JAMB, or undergraduate STEM exam standards and practice problems on the topic: "${weakness}" (in the context of ${scenario.subject}).

Generate a 2-question rapid practice drill (multiple-choice with 4 options each) that tests this exact concept so the student can immediately verify their understanding.

Return ONLY valid JSON matching this exact structure (no extra commentary):
{
  "questions": [
    {
      "id": "q1",
      "question": "Clear question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Concise step-by-step explanation of why this option is correct",
      "examStandard": "e.g., WAEC / JAMB / Undergraduate Calculus"
    },
    {
      "id": "q2",
      "question": "Second question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 1,
      "explanation": "Concise explanation",
      "examStandard": "e.g., Undergraduate STEM Practical"
    }
  ]
}`;

    let drill: DrillQuestion[] = [];
    let citations: GroundingCitation[] = [];
    let stage2Model = stage1Call.modelUsed;

    try {
      const stage2Call = await generateContentWithFallback({
        contents: [{ role: "user", parts: [{ text: stage2Prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: [{ googleSearch: {} }],
        },
      });
      stage2Model = stage2Call.modelUsed;

      const stage2Text = stage2Call.response.text ?? "";
      const parsedDrill = parseJsonFromText<{ questions?: DrillQuestion[] }>(
        stage2Text
      );
      if (Array.isArray(parsedDrill.questions)) {
        drill = parsedDrill.questions.slice(0, 2);
      }

      const chunks =
        stage2Call.response.candidates?.[0]?.groundingMetadata?.groundingChunks ??
        [];
      const seenUrls = new Set<string>();
      for (const chunk of chunks) {
        const uri = chunk.web?.uri;
        if (uri && !seenUrls.has(uri)) {
          seenUrls.add(uri);
          citations.push({
            title: chunk.web?.title || uri,
            url: uri,
          });
        }
      }
    } catch {
      // Non-fatal: Stage 1 coaching still succeeds even if Stage 2 search grounding fails
    }

    return NextResponse.json({
      stage1,
      drill,
      citations,
      models: {
        stage1: stage1Call.modelUsed,
        stage2: stage2Model,
      },
    });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json(
        { error: "MISSING_API_KEY", message: err.message },
        { status: 500 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to analyze student work.";
    return NextResponse.json(
      { error: "ANALYZE_WORK_FAILED", message },
      { status: 500 }
    );
  }
}
