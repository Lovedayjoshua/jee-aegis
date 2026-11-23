import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

const APK_PATH = path.join(process.cwd(), "public", "downloads", "jee-aegis.apk");

export async function GET() {
  if (!fs.existsSync(APK_PATH)) {
    return NextResponse.json(
      {
        error: "APK_NOT_COMPILED",
        message:
          "JEE-AEGIS.apk has not been compiled yet. Build the Android project on a machine with JDK 17 and Android SDK 35, then place the output at public/downloads/jee-aegis.apk.",
      },
      { status: 404 }
    );
  }

  const stat = fs.statSync(APK_PATH);
  if (stat.size === 0) {
    return NextResponse.json(
      { error: "APK_EMPTY", message: "The APK file on disk is empty." },
      { status: 500 }
    );
  }

  const fileBuffer = fs.readFileSync(APK_PATH);
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="JEE-AEGIS.apk"',
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
    },
  });
}
