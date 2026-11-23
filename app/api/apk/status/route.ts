import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const APK_RELATIVE_PATH = path.join("public", "downloads", "jee-aegis.apk");

export async function GET(request: NextRequest) {
  // Reference request URL so this route is evaluated dynamically on Check Again
  void request.nextUrl.searchParams.get("t");

  const fullPath = path.join(process.cwd(), APK_RELATIVE_PATH);
  const exists = fs.existsSync(fullPath);
  let sizeBytes = 0;

  if (exists) {
    try {
      sizeBytes = fs.statSync(fullPath).size;
    } catch {
      sizeBytes = 0;
    }
  }

  const available = exists && sizeBytes > 0;

  return NextResponse.json(
    {
      available,
      version: "1.0.0",
      fileName: "JEE-AEGIS.apk",
      downloadUrl: "/downloads/jee-aegis.apk",
      expectedPath: "public/downloads/jee-aegis.apk",
      sizeBytes,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
