import { StudyScenario } from "./types";

export const STUDY_SCENARIOS: StudyScenario[] = [
  {
    id: "math-ibp",
    title: "Calculus: Integration by Parts",
    subject: "Calculus II • Handwritten Work",
    recommendedSource: "webcam",
    durationMinutes: 10,
    sampleProblem: "Evaluate ∫ x² · eˣ dx step by step on paper.",
    promptContext:
      "The student is solving an Integration by Parts problem on paper (e.g., ∫ x² eˣ dx or ∫ x ln(x) dx). Watch for LIATE choice of u and dv, missing du/v terms, sign errors during repeated integration by parts, and the constant of integration + C.",
    rubric: [
      {
        id: "id_u_dv",
        label: "Choice of u & dv (LIATE)",
        description: "Correctly identifies u and dv so the integral simplifies.",
        maxScore: 25,
      },
      {
        id: "ibp_formula",
        label: "IBP Formula Application",
        description: "Applies u·v − ∫ v·du accurately without dropping terms.",
        maxScore: 25,
      },
      {
        id: "algebra_signs",
        label: "Algebra & Sign Distribution",
        description: "Distributes negative signs cleanly across nested steps.",
        maxScore: 25,
      },
      {
        id: "final_eval",
        label: "Final Simplification & + C",
        description: "Completes remaining integral and includes + C or bounds.",
        maxScore: 25,
      },
    ],
  },
  {
    id: "circuits-ohms",
    title: "Ohm's Law & Breadboard Check",
    subject: "Physics / ECE Lab Practical",
    recommendedSource: "webcam",
    durationMinutes: 12,
    sampleProblem:
      "Verify a 5V LED series-resistor circuit on a breadboard or schematic.",
    promptContext:
      "The student is building or sketching an LED + current-limiting resistor circuit on a breadboard or schematic (e.g., 5V supply, 220Ω–330Ω resistor, LED). Watch for shorted power rails, missing series resistor, reversed LED polarity (anode/cathode), and Ohm's law current calculation I = (Vs - Vf) / R.",
    rubric: [
      {
        id: "power_rails",
        label: "Power & Ground Isolation",
        description: "No direct short between +V and GND rails on breadboard.",
        maxScore: 25,
      },
      {
        id: "series_resistor",
        label: "Current-Limiting Resistor",
        description: "Resistor placed in series with LED and sized via Ohm's law.",
        maxScore: 25,
      },
      {
        id: "led_polarity",
        label: "Component Polarity",
        description: "LED anode (+) and cathode (−) oriented correctly.",
        maxScore: 25,
      },
      {
        id: "kvl_check",
        label: "KVL & Current Verification",
        description: "Correctly computes loop voltage drop and expected mA.",
        maxScore: 25,
      },
    ],
  },
  {
    id: "cs-python-debug",
    title: "Python Algorithm Debugging",
    subject: "CS Practical • Live Screen Share",
    recommendedSource: "screen",
    durationMinutes: 15,
    sampleProblem:
      "Debug binary search or recursive DP in your IDE with zero off-by-one bugs.",
    promptContext:
      "The student is sharing their IDE/editor screen while writing or debugging a Python algorithm (e.g., binary search, sliding window, or recursion). Watch for off-by-one bounds (left <= right vs left < right), mid calculation, infinite loops when updating pointers, and missing base cases.",
    rubric: [
      {
        id: "base_case",
        label: "Base Cases & Edge Inputs",
        description: "Handles empty input, single element, and missing targets.",
        maxScore: 25,
      },
      {
        id: "loop_invariant",
        label: "Loop Invariant & Bounds",
        description: "Pointer updates guarantee termination without skipping.",
        maxScore: 25,
      },
      {
        id: "logic_correctness",
        label: "Core Algorithm Logic",
        description: "Comparisons and state transitions match problem spec.",
        maxScore: 25,
      },
      {
        id: "complexity",
        label: "Time & Space Analysis",
        description: "Articulates Big-O time and space complexity accurately.",
        maxScore: 25,
      },
    ],
  },
  {
    id: "jamb-waec-stem",
    title: "JAMB & WAEC Exam Companion",
    subject: "UTME / SSCE • Physics, Chem, Bio & Math",
    recommendedSource: "webcam",
    durationMinutes: 15,
    sampleProblem:
      "Point your camera at a JAMB or WAEC past question, diagram, or equation.",
    promptContext:
      "The student is preparing for JAMB UTME or WAEC SSCE exams (Mathematics, Physics, Chemistry, or Biology). Read the printed or handwritten question, diagram, or equation from the camera, explain difficult concepts clearly, and guide them step by step without rushing.",
    rubric: [
      {
        id: "concept_id",
        label: "Topic & Formula Identification",
        description: "Identifies the syllabus topic and governing principle.",
        maxScore: 25,
      },
      {
        id: "diagram_reading",
        label: "Diagram / Data Extraction",
        description: "Reads values, units, and labels accurately from the question.",
        maxScore: 25,
      },
      {
        id: "step_working",
        label: "Step-by-Step Working",
        description: "Shows clear intermediate steps and unit conversions.",
        maxScore: 25,
      },
      {
        id: "exam_accuracy",
        label: "Final Answer Verification",
        description: "Verifies the final choice against common exam traps.",
        maxScore: 25,
      },
    ],
  },
  {
    id: "aegis-accessibility",
    title: "Accessibility & Visual Reader",
    subject: "AEGIS Vision • Scene & Document Audio",
    recommendedSource: "webcam",
    durationMinutes: 20,
    sampleProblem:
      "Show any printed document, medicine label, product, or surroundings to hear a clear description.",
    promptContext:
      "You are JEE AEGIS Accessibility Assistant helping a visually impaired or low-vision user understand their surroundings, read printed documents or labels aloud, and identify common objects safely. Describe spatial layout, text content, and key details clearly in concise spoken sentences.",
    rubric: [
      {
        id: "scene_clarity",
        label: "Scene & Object Recognition",
        description: "Identifies key objects, hazards, and spatial context.",
        maxScore: 25,
      },
      {
        id: "text_ocr",
        label: "Document & Label Reading",
        description: "Reads visible printed text accurately and in logical order.",
        maxScore: 25,
      },
      {
        id: "spoken_conciseness",
        label: "Voice-First Clarity",
        description: "Provides calm, structured, easy-to-follow spoken guidance.",
        maxScore: 25,
      },
      {
        id: "safety_notes",
        label: "Safety & Practical Cues",
        description: "Highlights expiry dates, warnings, or physical obstacles.",
        maxScore: 25,
      },
    ],
  },
  {
    id: "aegis-phone-helper",
    title: "Android Phone & Settings Guide",
    subject: "AEGIS Device Care • Permissions & Setup",
    recommendedSource: "screen",
    durationMinutes: 10,
    sampleProblem:
      "Ask how to manage Android permissions, battery optimization, Wi-Fi, or AEGIS Connector.",
    promptContext:
      "You are JEE AEGIS Phone Assistant helping the user understand Android settings, permissions (Location, Camera, Microphone, Notifications), battery optimization, and safe device recovery practices. Give accurate, step-by-step Android instructions without claiming impossible hardware capabilities.",
    rubric: [
      {
        id: "setting_location",
        label: "Menu Navigation",
        description: "Points to the exact Android Settings section.",
        maxScore: 25,
      },
      {
        id: "privacy_clarity",
        label: "Permission Purpose",
        description: "Explains why the permission is needed and how to revoke it.",
        maxScore: 25,
      },
      {
        id: "troubleshooting",
        label: "Step-by-Step Resolution",
        description: "Guides the user through verifying the change.",
        maxScore: 25,
      },
      {
        id: "accuracy",
        label: "Platform Accuracy",
        description: "Respects actual Android security and background limits.",
        maxScore: 25,
      },
    ],
  },
];

export function getScenarioById(id: string): StudyScenario {
  return (
    STUDY_SCENARIOS.find((scenario) => scenario.id === id) ??
    STUDY_SCENARIOS[0]
  );
}
