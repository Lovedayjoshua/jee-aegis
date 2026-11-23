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
  screenshotBase64?: string;
  screenshotMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  history?: CompanionMessage[];
  stream?: boolean;
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
    const hasScreenshot = Boolean(body.screenshotBase64);
    const hasAudio = Boolean(body.audioBase64);

    if (!message && !hasScreen && !hasCamera && !hasScreenshot && !hasAudio) {
      return NextResponse.json(
        {
          error: "MISSING_INPUT",
          message:
            "Provide a message, voice recording, screenshot, screen frame, or camera frame.",
        },
        { status: 400 }
      );
    }

    const historyText = Array.isArray(body.history)
      ? body.history
          .slice(-5)
          .map((m) => `${m.role === "user" ? "User" : "AEGIS"}: ${m.content.slice(0, 400)}`)
          .join("\n")
      : "";

    const systemInstruction = `You are JEE AEGIS Live Companion — a fast, practical multimodal AI assistant.
Visual context attached:
- Live Screen Share: ${hasScreen ? "YES" : "NO"}
- Live Camera: ${hasCamera ? "YES" : "NO"}
- Uploaded Screenshot: ${hasScreenshot ? "YES" : "NO"}

Rules:
1. If a screen share frame or uploaded screenshot is attached, inspect it carefully to explain the page, error messages, buttons, forms, or exact next steps.
2. If a camera frame is attached, identify visible objects, read printed text/documents, or assist with accessibility.
3. NEVER invent what is on the screen or camera if no image is attached. If none is attached and the user asks about their screen, tell them to use Camera, Upload Screenshot, or Share Screen.
4. Be concise, clear, and natural for spoken playback.`;

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
    if (hasScreenshot && body.screenshotBase64) {
      parts.push({
        inlineData: {
          mimeType: body.screenshotMimeType || "image/jpeg",
          data: stripDataUrlPrefix(body.screenshotBase64),
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
      historyText ? `Recent context:\n${historyText}` : "",
      message
        ? `User request: ${message}`
        : hasAudio
        ? "Respond to the user's spoken audio request using the attached visual context if present."
        : "Analyze the attached visual image/screenshot clearly and offer actionable guidance.",
    ]
      .filter(Boolean)
      .join("\n\n");

    parts.push({ text: promptLines });

    const provider = getAIProvider();

    if (body.stream) {
      const { stream, modelUsed, provider: providerName } = await provider.generateStream({
        contents: [{ role: "user", parts }],
        config: { systemInstruction },
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const sendEvent = (payload: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
          };
          sendEvent({
            type: "meta",
            modelUsed,
            provider: providerName,
            sawScreen: hasScreen,
            sawCamera: hasCamera,
            sawScreenshot: hasScreenshot,
          });
          try {
            for await (const chunk of stream) {
              const delta = chunk.text ?? "";
              if (delta) {
                sendEvent({ type: "delta", text: delta });
              }
            }
            sendEvent({ type: "done" });
          } catch (streamErr) {
            sendEvent({
              type: "error",
              message:
                streamErr instanceof Error
                  ? streamErr.message
                  : "Stream interrupted",
            });
          } finally {
            controller.close();
          }
        },
      });

      return new NextResponse(readable, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

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
      sawScreenshot: hasScreenshot,
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
