import { NextRequest, NextResponse } from "next/server";
import { Part } from "@google/genai";
import { getAIProvider, MissingApiKeyError } from "@/lib/ai/provider";

interface CompanionMessage {
  role: "user" | "assistant";
  content: string;
}

interface CompanionRequestBody {
  message?: string;
  screenFrameBase64?: string;
  cameraFrameBase64?: string;
  audioBase64?: string;
  audioMimeType?: string;
  history?: CompanionMessage[];
}

function stripDataUrlPrefix(b64: string): string {
  const idx = b64.indexOf(",");
  return idx >= 0 ? b64.slice(idx + 1) : b64;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CompanionRequestBody;
    const message = body.message?.trim() ?? "";
    const hasScreen = Boolean(body.screenFrameBase64);
    const hasCamera = Boolean(body.cameraFrameBase64);
    const hasAudio = Boolean(body.audioBase64);

    if (!message && !hasScreen && !hasCamera && !hasAudio) {
      return NextResponse.json(
        {
          error: "MISSING_INPUT",
          message: "Provide a message, voice recording, screen frame, or camera frame.",
        },
        { status: 400 }
      );
    }

    const historyText = Array.isArray(body.history)
      ? body.history
          .slice(-8)
          .map((m) => `${m.role === "user" ? "User" : "AEGIS"}: ${m.content}`)
          .join("\n")
      : "";

    const systemInstruction = `You are JEE AEGIS Live Companion — a calm, practical, real-time multimodal AI assistant.
Current visual context:
- Screen sharing active: ${hasScreen ? "YES (screen frame attached)" : "NO"}
- Camera sharing active: ${hasCamera ? "YES (camera frame attached)" : "NO"}

Rules:
1. If screen sharing is active, inspect the attached screen frame carefully to explain pages, UI elements, error messages, forms, or where the user should click.
2. If camera sharing is active, inspect the attached camera frame to identify objects, read printed text/documents, or assist with accessibility.
3. NEVER invent or guess what is on the user's screen or camera if no frame is attached. If they ask about their screen/camera when none is attached, clearly tell them to click "Share Screen" or "Camera" first.
4. Keep responses concise, natural for spoken playback, and structured with clear step-by-step guidance when helping with tasks.`;

    const parts: Part[] = [];
    if (hasScreen && body.screenFrameBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: stripDataUrlPrefix(body.screenFrameBase64),
        },
      });
    }
    if (hasCamera && body.cameraFrameBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: stripDataUrlPrefix(body.cameraFrameBase64),
        },
      });
    }
    if (hasAudio && body.audioBase64) {
      parts.push({
        inlineData: {
          mimeType: body.audioMimeType || "audio/webm",
          data: stripDataUrlPrefix(body.audioBase64),
        },
      });
    }

    const promptLines = [
      historyText ? `Recent conversation:\n${historyText}` : "",
      message
        ? `User request: ${message}`
        : hasAudio
        ? "Respond to the user's spoken audio request using the attached visual context if present."
        : "Describe what you see in the attached visual frame and offer helpful next steps.",
    ]
      .filter(Boolean)
      .join("\n\n");

    parts.push({ text: promptLines });

    const provider = getAIProvider();
    const { response, modelUsed, provider: providerName } = await provider.generate({
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction,
      },
    });

    const reply = (response.text ?? "").trim() || "I received your input, please try again.";

    return NextResponse.json({
      reply,
      modelUsed,
      provider: providerName,
      sawScreen: hasScreen,
      sawCamera: hasCamera,
    });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json(
        { error: "MISSING_API_KEY", message: err.message },
        { status: 503 }
      );
    }
    const msg = err instanceof Error ? err.message : "Live Companion request failed";
    return NextResponse.json(
      { error: "COMPANION_ERROR", message: msg },
      { status: 500 }
    );
  }
}
