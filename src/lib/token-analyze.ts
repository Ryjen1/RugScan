import { PublicKey } from "@solana/web3.js";
import { searchToken, honeypotTest, type JupToken, type HoneypotReport } from "./jupiter";
import { fetchMintInfo, assertMintAddress, type TokenMintInfo } from "./token";
import { scoreToken, type TokenRiskReport } from "./token-risk";
import { generateRecommendation, type Recommendation } from "./recommendation";

/**
 * The fully assembled analysis object that backs the report UI.
 *
 * Two data sources fan out in parallel:
 *   1. Jupiter Tokens V2 (primary — gives us almost everything in one call)
 *   2. On-chain RPC (fallback — only used if Jupiter has no record of the mint)
 * Plus honeypot test via Jupiter swap quote.
 */
export interface TokenAnalysis {
  input: string;
  /** Whether Jupiter knows about this token. False = unlisted / very new. */
  jupiterKnown: boolean;
  /** Authoritative token data (Jupiter V2 if known, otherwise on-chain RPC) */
  token: {
    mint: string;
    name?: string;
    symbol?: string;
    icon?: string;
    decimals: number;
    /** Total or circulating supply (Jupiter prefers totalSupply, otherwise raw on-chain) */
    supply: number;
    mintAuthorityRevoked: boolean;
    mintAuthority?: string;
    freezeAuthorityRevoked: boolean;
    freezeAuthority?: string;
    isToken2022: boolean;
    /** Token age in hours, when known */
    ageHours?: number;
    /** Token age source: "jupiter" or "rpc" */
    ageSource?: "jupiter" | "rpc";
    /** Total USD market cap */
    mcap?: number;
    /** Total USD liquidity across all DEXs */
    liquidityUsd?: number;
    /** USD price */
    priceUsd?: number;
    /** Total holder count (Jupiter only) */
    holderCount?: number;
    /** % of supply held by top 10 holders (Jupiter only) */
    top10Pct?: number;
    /** Dev wallet address */
    dev?: string;
    /** % of supply held by dev */
    devBalancePct?: number;
    /** How many times the dev has minted before (history of rugs) */
    devMints?: number;
    /** Jupiter's 0-100 organic score */
    organicScore?: number;
    organicScoreLabel?: "high" | "medium" | "low";
    /** Jupiter verification status */
    isVerified?: boolean;
    /** Jupiter has flagged this token as suspicious */
    isSus?: boolean;
    tags?: string[];
    /** Twitter handle / link */
    twitter?: string;
    /** Project website */
    website?: string;
    /** Launchpad if applicable (e.g. "pump") */
    launchpad?: string;
    /** First DEX pool address & creation time (the "real" launch moment) */
    firstPool?: { id: string; createdAt?: string };
    /** Trading stats over multiple windows */
    stats5m?: TokenStats;
    stats1h?: TokenStats;
    stats6h?: TokenStats;
    stats24h?: TokenStats;
  };
  honeypot: HoneypotReport;
  risk: TokenRiskReport;
  recommendation: Recommendation;
  durationMs: number;
}

export interface TokenStats {
  priceChange?: number;
  liquidityChange?: number;
  holderChange?: number;
  volumeChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  numBuys?: number;
  numSells?: number;
  numTraders?: number;
  numNetBuyers?: number;
  numOrganicBuyers?: number;
}

export async function analyzeToken(input: string): Promise<TokenAnalysis> {
  const start = Date.now();
  const mintPubkey = assertMintAddress(input);
  const mint = mintPubkey.toBase58();

  // Try Jupiter first — gives us the richest data
  const jup = await searchToken(mint).catch((e) => {
    console.warn("jupiter token error:", e);
    return null;
  });

  // We always need decimals for the honeypot test. If Jupiter doesn't know,
  // we have to fall back to RPC.
  let decimals: number | undefined = jup?.decimals;
  let onChainMint: TokenMintInfo | undefined;
  if (!jup) {
    onChainMint = await fetchMintInfo(mintPubkey);
    decimals = onChainMint.decimals;
  }

  // Honeypot test runs in parallel; we already have the mint at this point
  const honeypot = await honeypotTest(mint, decimals!);

  const token = jup ? buildTokenFromJupiter(jup, honeypot) : buildTokenFromOnChain(onChainMint!, honeypot);

  const risk = scoreToken({
    mint: { ...token, stats24h: token.stats24h },
    honeypot,
  });

  const result: TokenAnalysis = {
    input,
    jupiterKnown: !!jup,
    token,
    honeypot,
    risk,
    // Recommendation is generated AFTER risk so it can lean on the verdict
    // and flags. We patch it in below.
    recommendation: undefined as unknown as Recommendation,
    durationMs: 0,
  };
  result.recommendation = generateRecommendation(result);
  result.durationMs = Date.now() - start;
  return result;
}

function buildTokenFromJupiter(j: JupToken, honeypot: HoneypotReport): TokenAnalysis["token"] {
  const ageHours =
    j.createdAt
      ? Math.max(0, (Date.now() - new Date(j.createdAt).getTime()) / (1000 * 60 * 60))
      : undefined;

  const audit = j.audit ?? {};
  return {
    mint: j.id,
    name: j.name,
    symbol: j.symbol,
    icon: j.icon,
    decimals: j.decimals,
    supply: j.totalSupply ?? j.circSupply ?? 0,
    mintAuthorityRevoked: audit.mintAuthorityDisabled === true || j.mintAuthority == null,
    mintAuthority: j.mintAuthority ?? undefined,
    freezeAuthorityRevoked: audit.freezeAuthorityDisabled === true || j.freezeAuthority == null,
    freezeAuthority: j.freezeAuthority ?? undefined,
    isToken2022: j.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    ageHours,
    ageSource: ageHours !== undefined ? "jupiter" : undefined,
    mcap: j.mcap ?? j.fdv,
    liquidityUsd: j.liquidity,
    priceUsd: j.usdPrice ?? honeypot.priceUsd,
    holderCount: j.holderCount,
    top10Pct: audit.topHoldersPercentage,
    dev: j.dev,
    devBalancePct: audit.devBalancePercentage,
    devMints: audit.devMints,
    organicScore: j.organicScore,
    organicScoreLabel: j.organicScoreLabel,
    isVerified: j.isVerified,
    isSus: audit.isSus,
    tags: j.tags,
    twitter: j.twitter,
    website: j.website,
    launchpad: j.launchpad,
    firstPool: j.firstPool,
    stats5m: j.stats5m,
    stats1h: j.stats1h,
    stats6h: j.stats6h,
    stats24h: j.stats24h,
  };
}

function buildTokenFromOnChain(m: TokenMintInfo, honeypot: HoneypotReport): TokenAnalysis["token"] {
  return {
    mint: m.mint,
    decimals: m.decimals,
    supply: m.supply,
    mintAuthorityRevoked: m.mintAuthorityRevoked,
    mintAuthority: m.mintAuthority,
    freezeAuthorityRevoked: m.freezeAuthorityRevoked,
    freezeAuthority: m.freezeAuthority,
    isToken2022: m.isToken2022,
    ageHours: m.ageHours,
    ageSource: m.ageHours !== undefined ? "rpc" : undefined,
    priceUsd: honeypot.priceUsd,
  };
}

/**
 * Pack the full analysis into a compact, LLM-friendly context string.
 */
export function summarizeTokenForLLM(a: TokenAnalysis): string {
  const t = a.token;
  const lines: string[] = [];
  lines.push(`# Solana Token Safety Report`);
  lines.push(`Mint: ${t.mint}`);
  if (t.symbol || t.name) lines.push(`Name: ${t.name ?? "?"} (${t.symbol ?? "?"})`);
  lines.push(`Verdict: ${a.risk.verdict.toUpperCase()} (risk score ${a.risk.score}/100)`);
  lines.push(`Headline: ${a.risk.headline}`);
  lines.push(``);

  lines.push(`## Authorities`);
  lines.push(`- Mint authority: ${t.mintAuthorityRevoked ? "REVOKED ✓" : `ACTIVE — owner ${t.mintAuthority}`}`);
  lines.push(`- Freeze authority: ${t.freezeAuthorityRevoked ? "REVOKED ✓" : `ACTIVE — owner ${t.freezeAuthority}`}`);
  if (t.isToken2022) lines.push(`- Uses Token-2022 program (extra extensions possible)`);
  if (t.firstPool?.createdAt) {
    // Treat the first DEX pool date as the "deployment / launch" date — that
    // is what traders mean colloquially when asking "when was this deployed?"
    // (i.e. when did this token become tradeable).
    const date = new Date(t.firstPool.createdAt);
    const dateStr = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const ageDays = t.ageHours ? Math.round(t.ageHours / 24) : null;
    lines.push(
      `- Token launch date (first DEX pool created): ${dateStr}${ageDays !== null ? ` (~${ageDays} days ago)` : ""}.`
    );
    lines.push(
      `  When the user asks "when was this deployed/launched/created?", USE THIS DATE.`
    );
  } else if (t.ageHours !== undefined) {
    const days = (t.ageHours / 24).toFixed(1);
    lines.push(`- Token age: ~${days} days.`);
  } else {
    lines.push(`- Token launch date: not available in this report.`);
  }
  lines.push(``);

  if (t.holderCount !== undefined || t.top10Pct !== undefined) {
    lines.push(`## Holders`);
    if (t.holderCount !== undefined) lines.push(`- Total holders: ${t.holderCount.toLocaleString()}`);
    if (t.top10Pct !== undefined) lines.push(`- Top 10 holders: ${t.top10Pct.toFixed(2)}% of supply`);
    if (t.devBalancePct !== undefined) lines.push(`- Dev holds: ${t.devBalancePct.toFixed(2)}% of supply`);
    if (t.devMints !== undefined) lines.push(`- Dev has previously minted ${t.devMints} other tokens`);
    lines.push(``);
  }

  lines.push(`## Liquidity`);
  if (t.priceUsd !== undefined) lines.push(`- Live price: $${t.priceUsd.toPrecision(4)}`);
  if (t.mcap !== undefined) lines.push(`- Market cap: $${Math.round(t.mcap).toLocaleString()}`);
  if (t.liquidityUsd !== undefined) lines.push(`- Total DEX liquidity: $${Math.round(t.liquidityUsd).toLocaleString()}`);
  lines.push(`- Buyable on Jupiter: ${a.honeypot.canBuy ? "yes" : "NO"}`);
  lines.push(`- Sellable on Jupiter: ${a.honeypot.canSell ? "yes" : "NO"}`);
  if (a.honeypot.isHoneypot) lines.push(`- ⚠️ HONEYPOT: buy works but sell fails`);
  if (a.honeypot.smallBuyImpactPct !== undefined) lines.push(`- $10 buy impact: ${a.honeypot.smallBuyImpactPct.toFixed(2)}%`);
  if (a.honeypot.largeBuyImpactPct !== undefined) lines.push(`- $1,000 buy impact: ${a.honeypot.largeBuyImpactPct.toFixed(2)}%`);
  if (a.honeypot.routesCount !== undefined) lines.push(`- Distinct DEX routes: ${a.honeypot.routesCount}`);
  lines.push(``);

  if (t.organicScore !== undefined || t.isVerified !== undefined) {
    lines.push(`## Reputation`);
    if (t.organicScore !== undefined) lines.push(`- Jupiter organic score: ${t.organicScore.toFixed(1)} / 100 (${t.organicScoreLabel ?? "?"})`);
    if (t.isVerified) lines.push(`- Jupiter VERIFIED ✓`);
    if (t.isSus) lines.push(`- ⚠️ Jupiter has flagged this token as SUSPICIOUS`);
    if (t.tags?.length) lines.push(`- Tags: ${t.tags.join(", ")}`);
    if (t.launchpad) lines.push(`- Launchpad: ${t.launchpad}`);
    lines.push(``);
  }

  // Trading stats — what a trader actually wants to know
  const windows: Array<["24h" | "6h" | "1h" | "5m", TokenStats | undefined]> = [
    ["24h", t.stats24h],
    ["6h", t.stats6h],
    ["1h", t.stats1h],
    ["5m", t.stats5m],
  ];
  if (windows.some(([, s]) => s)) {
    lines.push(`## Trading activity`);
    for (const [w, s] of windows) {
      if (!s) continue;
      const parts: string[] = [];
      if (s.priceChange !== undefined) parts.push(`price ${formatPct(s.priceChange)}`);
      if (s.buyVolume !== undefined && s.sellVolume !== undefined) {
        parts.push(`vol $${Math.round(s.buyVolume + s.sellVolume).toLocaleString()}`);
      }
      if (s.numBuys !== undefined && s.numSells !== undefined) {
        parts.push(`${s.numBuys} buys / ${s.numSells} sells`);
      }
      if (s.numTraders !== undefined) parts.push(`${s.numTraders} traders`);
      if (s.liquidityChange !== undefined) parts.push(`LP ${formatPct(s.liquidityChange)}`);
      if (s.holderChange !== undefined) parts.push(`holders ${formatPct(s.holderChange)}`);
      lines.push(`- ${w}: ${parts.join(", ")}`);
    }
    lines.push(``);
  }

  if (t.firstPool?.createdAt) {
    lines.push(`## Launch`);
    lines.push(`- First DEX pool created: ${t.firstPool.createdAt}`);
    lines.push(``);
  }

  lines.push(`## Risk flags (${a.risk.flags.length})`);
  for (const f of a.risk.flags) {
    lines.push(`- [${f.severity.toUpperCase()}] ${f.title} — ${f.detail}`);
  }
  lines.push(``);

  lines.push(`## Veteran trader's take (assistive — trader has the final call)`);
  lines.push(`- Action: ${a.recommendation.action.toUpperCase()}`);
  lines.push(`- Headline: ${a.recommendation.headline}`);
  for (const r of a.recommendation.thesis) lines.push(`- Thesis: ${r}`);
  if (a.recommendation.edge) lines.push(`- Edge / what newbies miss: ${a.recommendation.edge}`);
  if (a.recommendation.plan) {
    const p = a.recommendation.plan;
    if (p.positionSize) {
      lines.push(`- Suggested position size: $${p.positionSize.min}-$${p.positionSize.max} (${p.positionSize.rationale})`);
    }
    if (p.stopLossPct !== undefined) lines.push(`- Stop-loss: ${p.stopLossPct}% from entry`);
    if (p.takeProfitLadder?.length) {
      lines.push(`- Take-profit ladder:`);
      for (const tp of p.takeProfitLadder) lines.push(`  - ${tp.at}: ${tp.sell}`);
    }
    if (p.watchFor?.length) {
      lines.push(`- Watch for:`);
      for (const w of p.watchFor) lines.push(`  - ${w}`);
    }
    if (p.killCriteria?.length) {
      lines.push(`- Kill criteria:`);
      for (const k of p.killCriteria) lines.push(`  - ${k}`);
    }
  }

  return lines.join("\n");
}

function formatPct(n: number): string {
  if (n === 0) return "0%";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}
