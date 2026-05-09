import { NextResponse } from "next/server";
import { DEMO_TOKENS } from "@/lib/demo";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(DEMO_TOKENS);
}
