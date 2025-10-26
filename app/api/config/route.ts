import { NextResponse } from "next/server";
import { getRealtimeConfig } from "@/lib/realtimeServerConfig";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getRealtimeConfig());
}
