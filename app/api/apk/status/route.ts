import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

const APK_RELATIVE_PATH = path.join("public", "downloads", "jee-aegis.apk");

export async function GET() {
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

  return NextResponse.json({
    available,
    version: "1.0.0",
    fileName: "JEE-AEGIS.apk",
    downloadUrl: "/api/apk/download",
    expectedPath: "public/downloads/jee-aegis.apk",
    sizeBytes,
    missingBuildTools: available ? [] : ["JDK 17", "Android SDK 35", "Gradle"],
    buildCommand: "cd android && .\\gradlew assembleDebug",
  });
}
