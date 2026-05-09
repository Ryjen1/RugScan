import { NextRequest, NextResponse } from "next/server";
import { analyzeToken } from "@/lib/token-analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { mint?: string };
    const mint = body.mint?.trim();
    if (!mint) {
      return NextResponse.json({ error: "Paste a Solana token address." }, { status: 400 });
    }

    const result = await analyzeToken(mint);

    // BigInts don't serialize natively
    return NextResponse.json(serializeBigInts(result));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Token analysis failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function serializeBigInts<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  ) as T;
}
