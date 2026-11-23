import { CoachMode, StepAssessment, StudyScenario } from "./types";

export function buildStage1CoachPrompt(
  scenario: StudyScenario,
  mode: CoachMode,
  previousSteps: StepAssessment[],
  textQuestion?: string
): string {
  const rubricList = scenario.rubric
    .map(
      (item) =>
        `- criterion_id: "${item.id}" | "${item.label}" (max ${item.maxScore} pts): ${item.description}`
    )
    .join("\n");

  const priorStepsSummary =
    previousSteps.length === 0
      ? "None logged yet."
      : previousSteps
          .map(
            (s) =>
              `Step ${s.stepNumber} [${s.status.toUpperCase()}] (${s.concept}): ${s.hintGiven}`
          )
          .join("\n");

  const modeDirective =
    mode === "coach"
      ? `MODE: PRACTICE COACH
- Warm, Socratic, encouraging tone.
- Point out the exact line, equation, circuit connection, or code token where logic diverged and ask ONE guiding question without giving away the final answer.`
      : `MODE: TIMED EXAM / LAB PRACTICAL
- Calm, rigorous examiner tone.
- Minimal hints; rigorously grade rubric criteria and flag exact errors.`;

  return `You are SocraticLab, a precision STEM Exam & Lab Practical Study Coach.
Analyze the student's submitted image (handwritten paper, breadboard/circuit, or IDE screen), optional voice recording, and optional attached lab/exam reference PDF.

ACTIVE SCENARIO: ${scenario.title} (${scenario.subject})
SAMPLE TASK: ${scenario.sampleProblem}
CONTEXT: ${scenario.promptContext}

${modeDirective}

RUBRIC CRITERIA (use these exact criterion_id strings in rubric_updates):
${rubricList}

PREVIOUSLY LOGGED STEPS:
${priorStepsSummary}

${textQuestion ? `STUDENT TYPED QUESTION: "${textQuestion}"` : ""}

INSTRUCTIONS:
1. Transcribe the visible handwritten math, circuit diagram, or code line-by-line in \`transcribed_work\`.
2. If an audio recording was provided, transcribe what the student asked in \`voice_transcript\` (otherwise return empty string "").
3. Evaluate new or updated reasoning steps in \`step_checks\` with exact \`line_quote\` from the image.
4. Return \`rubric_updates\` using ONLY the exact \`criterion_id\` values listed above.
5. Write \`socratic_reply\` as 2–3 natural spoken sentences pointing to the exact line/component and asking a Socratic guiding question. NEVER spoil the final answer.
6. Provide a helpful \`visual_hint\` (LaTeX formula or short code/circuit pattern) that guides without giving away the final answer.
7. Identify one specific STEM \`weakness_topic\` (or the key concept being practiced if all steps are correct) for a follow-up grounded micro-drill.`;
}
