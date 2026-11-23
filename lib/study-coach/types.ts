export type CoachMode = "coach" | "exam";

export type VideoSourceMode = "webcam" | "screen";

export type StepStatus = "correct" | "warning" | "error";

export interface StepAssessment {
  id: string;
  stepNumber: number;
  status: StepStatus;
  concept: string;
  lineQuote?: string;
  hintGiven: string;
  timestamp: string;
}

export interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  maxScore: number;
  score: number;
  feedback?: string;
  lastUpdated?: string;
}

export interface VisualHintCard {
  id: string;
  title: string;
  snippet: string;
  explanation?: string;
  kind: "latex" | "code";
  timestamp: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: "student" | "coach" | "work";
  text: string;
  timestamp: string;
}

export interface DrillQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  examStandard: string;
}

export interface GroundingCitation {
  title: string;
  url: string;
}

export interface Stage1AnalysisResult {
  transcribed_work: string;
  voice_transcript: string;
  step_checks: Array<{
    step_number: number;
    status: StepStatus;
    concept: string;
    line_quote: string;
    feedback: string;
  }>;
  rubric_updates: Array<{
    criterion_id: string;
    score_delta: number;
    feedback: string;
  }>;
  socratic_reply: string;
  visual_hint: {
    title: string;
    formula_or_code: string;
    explanation: string;
  };
  weakness_topic: string;
}

export interface AnalyzeWorkApiResponse {
  stage1: Stage1AnalysisResult;
  drill: DrillQuestion[];
  citations: GroundingCitation[];
  models: {
    stage1: string;
    stage2: string;
  };
}

export interface StudyScenario {
  id: string;
  title: string;
  subject: string;
  recommendedSource: VideoSourceMode;
  durationMinutes: number;
  promptContext: string;
  sampleProblem: string;
  rubric: Omit<RubricCriterion, "score" | "feedback" | "lastUpdated">[];
}

export interface StudySessionRecord {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  mode: CoachMode;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  totalScore: number;
  maxScore: number;
  steps: StepAssessment[];
  rubric: RubricCriterion[];
  hintsUsed: number;
}
