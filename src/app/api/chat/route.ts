import { NextRequest } from "next/server";
import { streamText, type ModelMessage } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { analyzeToken, summarizeTokenForLLM, type TokenAnalysis } from "@/lib/token-analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Shrewd Guard — a 10-year veteran Solana trader sitting at a terminal next to a less experienced trader. They're about to make a call. You read the on-chain data and tell them what you'd do, with the specific numbers and triggers a pro would use.

Voice:
- Direct, no hedging. No "it's complicated," no "always do your own research" boilerplate.
- Concrete numbers over feelings. Position size in dollars. Stop-loss as a %. Take-profit as multiples. Triggers as events.
- Lean on the prepared "Veteran trader's take" already in the report — that's your starting position. Build on it; don't contradict it without a reason grounded in the data.
- Short paragraphs. Bullets for plans. No lectures.

Specific things you do well:
- Position sizing: relate it to LP depth ("don't be more than 1% of the $X LP").
- Stop-loss: tighter on established tokens, wider on fresh ones because the noise floor is high.
- Take-profit ladders: 1/3 / 1/3 / runner is the default for memecoins; tighter for blue-chips.
- "What newbies miss": the non-obvious thing — LP/MC ratio, dev's prior-mint pattern, 5m flow flipping the 24h trend.
- Kill criteria: the specific events that mean "abandon and take the loss."

Things you DON'T do:
- Predict price. You don't know where it's going. You give the trader a plan they can adapt as price unfolds.
- Pretend confidence you don't have. If the data is ambiguous, say so and explain what you'd watch.
- Replace the trader's call. The final decision is theirs — your job is to make sure they're making it with veteran-grade context.

Hard rules on facts you DO NOT have:
- The exact mint contract deployment date is NOT in the report. The report contains the "first DEX pool age" — that is when the token was first listed on a DEX, NOT when the mint was created. These are usually different and can differ by months or years. If asked when the contract / token was deployed, say: "The report shows when the first DEX pool was created, but not the exact mint deployment date." Do NOT calculate a deployment date from age. Do NOT guess.
- You do not have the dev wallet's full transaction history beyond the 'devMints' count.
- You do not have real-time price beyond the report's last snapshot. If asked "what's the price right now," say it's from the most recent scan and suggest re-scanning.

Treat the structured report as ground truth. Don't invent on-chain history. If a number isn't in the report, say so plainly.`;

function getModel() {
  if (process.env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq("llama-3.3-70b-versatile");
  }
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai("gpt-4o-mini");
  }
  return null;
}

interface ChatRequestBody {
  mint?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!body.mint) {
    return new Response(JSON.stringify({ error: "Missing 'mint' address" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let analysis: TokenAnalysis;
  try {
    analysis = await analyzeToken(body.mint);
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Analysis failed" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const model = getModel();
  if (!model) {
    // Graceful no-key fallback: stream a deterministic explanation.
    const fallback = buildDeterministicExplanation(analysis);
    return new Response(streamPlainText(fallback), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const context = summarizeTokenForLLM(analysis);
  const userMessages: ModelMessage[] = (body.messages ?? [])
    .filter((m) => typeof m.content === "string" && m.content.length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  if (userMessages.length === 0) {
    userMessages.push({
      role: "user",
      content: "Should I buy this token? Walk me through what's safe and what's risky in plain English.",
    });
  }

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Token report:\n\n${context}` },
    ...userMessages,
  ];

  const result = streamText({
    model,
    messages,
    temperature: 0.2,
  });

  return result.toTextStreamResponse();
}

function streamPlainText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const CHUNK = 40;
      for (let i = 0; i < text.length; i += CHUNK) {
        controller.enqueue(encoder.encode(text.slice(i, i + CHUNK)));
        await new Promise((r) => setTimeout(r, 18));
      }
      controller.close();
    },
  });
}

function buildDeterministicExplanation(a: TokenAnalysis): string {
  const t = a.token;
  const rec = a.recommendation;
  const lines: string[] = [];

  // Snapshot
  const parts: string[] = [];
  if (t.symbol) parts.push(`**${t.symbol}**`);
  if (t.priceUsd !== undefined) parts.push(`$${formatPrice(t.priceUsd)}`);
  if (t.stats24h?.priceChange !== undefined)
    parts.push(`${t.stats24h.priceChange >= 0 ? "+" : ""}${t.stats24h.priceChange.toFixed(1)}% 24h`);
  if (t.mcap !== undefined) parts.push(`MC $${formatBigUsd(t.mcap)}`);
  if (t.liquidityUsd !== undefined) parts.push(`LP $${formatBigUsd(t.liquidityUsd)}`);
  if (t.ageHours !== undefined) parts.push(`age ${humanAge(t.ageHours)}`);
  if (parts.length > 0) {
    lines.push(parts.join("  ·  "));
    lines.push("");
  }

  // Veteran's take
  lines.push(`**${rec.headline}** *(${rec.action.toUpperCase()})*`);
  lines.push("");

  if (rec.thesis.length > 0) {
    lines.push("**Read on the data:**");
    for (const t of rec.thesis) lines.push(`• ${t}`);
    lines.push("");
  }

  if (rec.edge) {
    lines.push(`**What newbies miss:** ${rec.edge}`);
    lines.push("");
  }

  if (rec.plan) {
    lines.push("**The play:**");
    if (rec.plan.positionSize) {
      lines.push(
        `• Size: $${rec.plan.positionSize.min}–$${rec.plan.positionSize.max}. ${rec.plan.positionSize.rationale}`
      );
    }
    if (rec.plan.stopLossPct !== undefined) {
      lines.push(`• Stop-loss: ${rec.plan.stopLossPct}% from entry. Set it before you click buy.`);
    }
    if (rec.plan.takeProfitLadder?.length) {
      lines.push(`• Take profit ladder:`);
      for (const tp of rec.plan.takeProfitLadder) lines.push(`    – ${tp.at}: ${tp.sell}`);
    }
    if (rec.plan.watchFor?.length) {
      lines.push(`• Watch:`);
      for (const w of rec.plan.watchFor) lines.push(`    – ${w}`);
    }
    if (rec.plan.killCriteria?.length) {
      lines.push(`• Kill the trade if:`);
      for (const k of rec.plan.killCriteria) lines.push(`    – ${k}`);
    }
    lines.push("");
  }

  lines.push(`_${rec.disclaimer}_`);
  lines.push("");
  lines.push("_(Offline mode — set GROQ_API_KEY for conversational follow-ups.)_");

  return lines.join("\n");
}

function formatPrice(n: number): string {
  if (n >= 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (n >= 0.0001) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return n.toExponential(2);
}

function formatBigUsd(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

function humanAge(hours: number): string {
  if (hours < 1) return `<1h`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  if (hours < 24 * 30) return `${(hours / 24).toFixed(1)}d`;
  if (hours < 24 * 365) return `${(hours / 24 / 30).toFixed(1)}mo`;
  return `${(hours / 24 / 365).toFixed(1)}y`;
}
