import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const APK_PATH = path.join(process.cwd(), "public", "downloads", "jee-aegis.apk");

export async function GET(request: NextRequest) {
  void request.nextUrl.searchParams.get("t");

  if (!fs.existsSync(APK_PATH)) {
    return NextResponse.json(
      {
        error: "APK_BUILD_PENDING",
        message:
          "The JEE AEGIS Android application is currently being prepared by our automated build system.",
      },
      { status: 404 }
    );
  }

  const stat = fs.statSync(APK_PATH);
  if (stat.size === 0) {
    return NextResponse.json(
      { error: "APK_EMPTY", message: "The APK package is empty." },
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
