import { NextRequest, NextResponse } from "next/server";
import { getStoredContextMetadata } from "@/lib/backend-session-store";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  return NextResponse.json(getStoredContextMetadata(sessionId));
}
