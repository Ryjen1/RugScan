import type { TokenAnalysis, TokenStats } from "./token-analyze";

/**
 * Veteran trader's playbook generator.
 *
 * The goal: give the trader what an experienced operator would say after
 * reading the same data — not a junior analyst's "looks risky, size small"
 * hedge. Concrete numbers, specific triggers, the non-obvious insight that
 * a newbie would miss.
 *
 * Every output is *deterministic* and *grounded* in the structured analysis.
 * We do NOT predict price. We tell the trader:
 *   - what the on-chain mechanics imply
 *   - how to size given current liquidity
 *   - where to set stops and take-profits
 *   - what to watch for that would change the trade
 *   - what would kill it
 */

export type Action = "consider" | "size_small" | "watch" | "wait" | "skip";

export interface TradePlan {
  /**
   * Suggested USD position size as a range. Always relative to liquidity:
   * sized so the trader is at most a small % of LP depth.
   */
  positionSize?: { min: number; max: number; rationale: string };
  /**
   * Stop-loss percentage from entry. Memecoin volatility says ~15-20%; thin
   * liquidity says tighter; deep blue-chips say wider.
   */
  stopLossPct?: number;
  /**
   * Take-profit ladder: a list of (multiple, fraction) pairs.
   * e.g. [{ at: 1.5, sell: 0.33 }, { at: 3, sell: 0.33 }, { at: "trail 25%", sell: 0.34 }]
   */
  takeProfitLadder?: Array<{ at: string; sell: string }>;
  /** Concrete things to monitor while in the position */
  watchFor?: string[];
  /** Specific events that mean "abandon, take the loss, move on" */
  killCriteria?: string[];
}

export interface Recommendation {
  action: Action;
  /** Headline visible at the top of the recommendation card */
  headline: string;
  /**
   * Veteran's read on the situation — 2-4 short bullets that synthesize the
   * data into a thesis a trader can act on. Each references concrete numbers.
   */
  thesis: string[];
  /**
   * The non-obvious observation a newbie would miss.
   * Optional — only present when there's a real insight to surface.
   */
  edge?: string;
  /** Concrete trade plan (entry/stop/exit/watch/kill). Optional for SKIP/WAIT. */
  plan?: TradePlan;
  disclaimer: string;
}

const DISCLAIMER =
  "Shrewd Guard reads the chain so you can move faster. The trade is yours.";

export function generateRecommendation(a: TokenAnalysis): Recommendation {
  const t = a.token;
  const r = a.risk;
  const h = a.honeypot;
  const s24 = t.stats24h;
  const s5m = t.stats5m;
  const s1h = t.stats1h;

  // --- HARD SKIPS (no plan, just pass) ---

  if (h.isHoneypot) {
    return {
      action: "skip",
      headline: "Honeypot — buy works, sell fails",
      thesis: [
        "Jupiter quotes a successful BUY but the reverse SELL quote fails. There is no exit.",
        ...(t.isSus ? ["Jupiter has independently flagged this mint as suspicious."] : []),
      ],
      edge:
        "Most newbies think 'I'll just sell on a different DEX' — but Jupiter aggregates EVERY Solana DEX. If Jupiter can't sell it, no one can.",
      disclaimer: DISCLAIMER,
    };
  }

  if (t.isSus && (t.devMints ?? 0) > 5) {
    return {
      action: "skip",
      headline: "Hard pass — flagged by Jupiter, dev is a serial launcher",
      thesis: [
        `Jupiter's audit pipeline (the same one Phantom and Solflare use) has flagged this token as suspicious.`,
        `Dev wallet has minted ${t.devMints} other tokens — this is a launchpad professional, not a project builder.`,
        ...(t.organicScore !== undefined && t.organicScore < 20
          ? [`Organic score ${t.organicScore.toFixed(0)}/100 — the volume you see is bots, not buyers.`]
          : []),
      ],
      edge:
        "When dev-mints > 5, go check 3 of their prior tokens on Solscan. If most are dead at <$10K MC, this is a known rug pattern — never trust the next one.",
      disclaimer: DISCLAIMER,
    };
  }

  // Liquidity actively bleeding — rug in progress
  if (s24?.liquidityChange !== undefined && s24.liquidityChange < -30) {
    return {
      action: "skip",
      headline: "Liquidity is being pulled — rug in progress",
      thesis: [
        `LP dropped ${s24.liquidityChange.toFixed(1)}% in 24h. This is either an active rug or a panic exit by LPs.`,
        ...(s24.holderChange !== undefined && s24.holderChange < -5
          ? [`Holder count down ${s24.holderChange.toFixed(1)}% — confirms exit pressure.`]
          : []),
        ...(t.priceUsd !== undefined && s24.priceChange !== undefined && s24.priceChange < -50
          ? [`Price already down ${s24.priceChange.toFixed(1)}% in 24h.`]
          : []),
      ],
      edge:
        "The LP-pulling pattern almost always finishes within hours. Trying to catch the bottom here is a coin-flip with hostile odds.",
      disclaimer: DISCLAIMER,
    };
  }

  if (!h.canBuy) {
    return {
      action: "wait",
      headline: "No DEX route — wait for liquidity",
      thesis: [
        "Jupiter cannot route a $10 buy. Either pre-bonding, just-pulled liquidity, or never had a real market.",
        ...(t.firstPool?.createdAt
          ? [`First pool was created ${formatTimeAgo(t.firstPool.createdAt)}.`]
          : []),
      ],
      edge: "If this is a pump.fun token pre-bonding, sniping the bond unlock is a different game with different math. If it's post-rug, walk.",
      disclaimer: DISCLAIMER,
    };
  }

  // --- SCORE THE OPPORTUNITY ---

  const ageHours = t.ageHours;
  const lpUsd = t.liquidityUsd ?? 0;
  const mcUsd = t.mcap ?? 0;
  const lpToMcRatio = mcUsd > 0 ? lpUsd / mcUsd : 0; // healthy >0.05, ideal >0.10
  const buy24 = s24?.numBuys ?? 0;
  const sell24 = s24?.numSells ?? 0;
  const total24 = buy24 + sell24;
  const sellRatio24 = total24 > 0 ? sell24 / total24 : 0.5;
  const buy5m = s5m?.numBuys ?? 0;
  const sell5m = s5m?.numSells ?? 0;
  const total5m = buy5m + sell5m;
  const sellRatio5m = total5m > 0 ? sell5m / total5m : 0.5;
  const momentum5mFlip = total5m > 20 && total24 > 100 && Math.abs(sellRatio5m - sellRatio24) > 0.15;

  // --- DANGER VERDICT (skip with thesis, no playbook) ---

  if (r.verdict === "danger") {
    const thesis: string[] = [];

    if (ageHours !== undefined && ageHours < 1) {
      thesis.push(`Token is ${(ageHours * 60).toFixed(0)} minutes old. The pump-and-dump window is the first 24 hours.`);
    }
    if ((t.devMints ?? 0) > 10) {
      thesis.push(`Dev launched ${t.devMints} prior tokens — high serial-rugger probability.`);
    }
    if (t.organicScore !== undefined && t.organicScore < 20) {
      thesis.push(`Organic score ${t.organicScore.toFixed(0)}/100 — volume is bots churning the price, not real demand.`);
    }
    if (lpUsd > 0 && lpUsd < 5000) {
      thesis.push(`Only $${formatBigUsd(lpUsd)} of liquidity — a single moderate sell collapses this.`);
    }
    if (!t.mintAuthorityRevoked && !t.isVerified) {
      thesis.push("Mint authority active on an unverified token — dev can dilute supply at will.");
    }

    return {
      action: "skip",
      headline: "We'd skip this",
      thesis: thesis.slice(0, 4),
      edge:
        ageHours !== undefined && ageHours < 24 && (t.devMints ?? 0) > 5
          ? "Brand new token + serial-launcher dev = the classic 'spray and pray' pattern. The dev launches 30 tokens a week and rugs 28 of them."
          : undefined,
      disclaimer: DISCLAIMER,
    };
  }

  // --- CAUTION (full trade plan, sized small) ---

  if (r.verdict === "caution") {
    const thesis: string[] = [];

    // Build situational thesis
    if (lpToMcRatio > 0 && lpToMcRatio < 0.05) {
      thesis.push(
        `LP/MC ratio is ${(lpToMcRatio * 100).toFixed(1)}% ($${formatBigUsd(lpUsd)} LP vs $${formatBigUsd(mcUsd)} MC) — thin liquidity for the market cap.`
      );
    }
    if (momentum5mFlip && sellRatio5m > sellRatio24) {
      thesis.push(
        `5m flow shifted: 24h was ${((1 - sellRatio24) * 100).toFixed(0)}% buys but the last 5 minutes are ${((1 - sellRatio5m) * 100).toFixed(0)}% buys. Distribution is starting.`
      );
    } else if (momentum5mFlip && sellRatio5m < sellRatio24) {
      thesis.push(
        `5m flow strengthening: 24h was ${((1 - sellRatio24) * 100).toFixed(0)}% buys, last 5min are ${((1 - sellRatio5m) * 100).toFixed(0)}% — buy pressure picking up.`
      );
    }
    if ((t.devMints ?? 0) > 5) {
      thesis.push(
        `Dev has ${t.devMints} prior mints. Before sizing, check 3 random ones on Solscan: if most are alive at $1M+ MC, dev ships. If most are dead, this is the next rug.`
      );
    }
    if (t.top10Pct !== undefined && t.top10Pct > 50) {
      thesis.push(`Top 10 wallets hold ${t.top10Pct.toFixed(0)}% — coordinated dump risk.`);
    }
    if (s1h?.priceChange !== undefined && Math.abs(s1h.priceChange) > 30) {
      thesis.push(
        `Price ${s1h.priceChange > 0 ? "up" : "down"} ${Math.abs(s1h.priceChange).toFixed(0)}% in the last hour. Volatility is the trade.`
      );
    }
    if (thesis.length === 0) {
      thesis.push("Mechanics are mostly clean but the data has a few yellow flags — see the full report.");
    }

    // Build playbook
    const positionSize = sizingFromLiquidity(lpUsd);
    const stopLossPct = stopLossFromVolatility({ ageHours, lpUsd, mcUsd, isToken2022: t.isToken2022 });
    const takeProfitLadder = ladderFromVerdict("caution");
    const watchFor = buildWatchFor(t, s5m, s1h, s24);
    const killCriteria = buildKillCriteria(t);

    const edge = pickEdge({
      ageHours,
      devMints: t.devMints,
      lpToMcRatio,
      sellRatio24,
      sellRatio5m,
      momentum5mFlip,
      organicScore: t.organicScore,
      isToken2022: t.isToken2022,
      isSus: t.isSus,
    });

    return {
      action: momentum5mFlip && sellRatio5m > 0.7 ? "watch" : "size_small",
      headline:
        momentum5mFlip && sellRatio5m > 0.7
          ? "Distribution starting — wait for confirmation"
          : "Tradable — size for the liquidity, not your conviction",
      thesis: thesis.slice(0, 4),
      edge,
      plan: {
        positionSize,
        stopLossPct,
        takeProfitLadder,
        watchFor,
        killCriteria,
      },
      disclaimer: DISCLAIMER,
    };
  }

  // --- STABLECOINS / LSTs: not a "trade", a "hold" ---
  // If the token is verified and tagged as a stable asset, an LST, or RWA,
  // there's no upside trade to plan. We surface that explicitly instead of
  // pretending you'll 1.3x USDC.
  const isHoldRather =
    !!t.isVerified && (t.tags ?? []).some((tag) => /stable|stablecoin|lst|rwa|fiat/i.test(tag));

  if (isHoldRather) {
    const stableThesis: string[] = [];
    stableThesis.push(
      `This is a ${(t.tags ?? []).find((x) => /stable|lst|rwa|fiat/i.test(x)) ?? "verified"} asset, not a directional trade — the playbook is to hold for the use case, not for upside.`
    );
    if (t.mcap !== undefined && t.liquidityUsd !== undefined) {
      stableThesis.push(
        `MC $${formatBigUsd(t.mcap)} backed by $${formatBigUsd(t.liquidityUsd)} of DEX liquidity — entries and exits are essentially frictionless.`
      );
    }
    if (t.isVerified) stableThesis.push("Jupiter-verified, used by Phantom, Solflare, and most Solana wallets.");
    return {
      action: "consider",
      headline: "Hold, don't trade — this is a stable / yield asset",
      thesis: stableThesis,
      edge:
        "The 'trade' on a stablecoin or LST is whether to hold it at all (yield vs. opportunity cost), not where to set a take-profit. Verify the issuer's track record (Circle for USDC, Marinade for mSOL, etc.) and treat it as treasury, not speculation.",
      // Deliberately no `plan` — there's no entry/stop/exit on a stable.
      disclaimer: DISCLAIMER,
    };
  }

  // --- SAFE VERDICT for actual tradable tokens ---

  const thesis: string[] = [];
  if (t.isVerified) thesis.push("Jupiter-verified — same audit standard Phantom and Solflare use.");
  if (t.mintAuthorityRevoked && t.freezeAuthorityRevoked) {
    thesis.push("Mint and freeze authorities both revoked — supply locked, no surprise dilution or freeze.");
  }
  if (lpUsd > 1_000_000) {
    thesis.push(`$${formatBigUsd(lpUsd)} of LP — real money can move in and out cleanly.`);
  }
  if (t.organicScore !== undefined && t.organicScore >= 60) {
    thesis.push(`Organic score ${t.organicScore.toFixed(0)}/100 — real users dominate the volume.`);
  }
  if (s1h?.priceChange !== undefined && Math.abs(s1h.priceChange) > 5) {
    thesis.push(
      `Price ${s1h.priceChange > 0 ? "up" : "down"} ${Math.abs(s1h.priceChange).toFixed(1)}% in the last hour — there's something moving it right now.`
    );
  }
  if (thesis.length === 0) {
    thesis.push("No critical risk signals. Mechanics are clean.");
  }

  const positionSize = sizingFromLiquidity(lpUsd);
  const stopLossPct = stopLossFromVolatility({ ageHours, lpUsd, mcUsd, isToken2022: t.isToken2022 });
  const takeProfitLadder = ladderFromVerdict("safe");
  const watchFor = buildWatchFor(t, s5m, s1h, s24);
  const killCriteria = buildKillCriteria(t);

  const edge = pickEdge({
    ageHours,
    devMints: t.devMints,
    lpToMcRatio,
    sellRatio24,
    sellRatio5m,
    momentum5mFlip,
    organicScore: t.organicScore,
    isToken2022: t.isToken2022,
    isSus: t.isSus,
  });

  return {
    action: "consider",
    headline: "Mechanics are clean — execution is your call",
    thesis: thesis.slice(0, 4),
    edge,
    plan: {
      positionSize,
      stopLossPct,
      takeProfitLadder,
      watchFor,
      killCriteria,
    },
    disclaimer: DISCLAIMER,
  };
}

// ---------- Playbook builders ----------

/**
 * Position-sizing rule: cap the trader's notional at a small % of LP so
 * they're not their own price impact. Veteran rule of thumb on memecoins:
 * never be more than ~1% of liquidity in a single position.
 */
function sizingFromLiquidity(lpUsd: number): TradePlan["positionSize"] | undefined {
  if (!lpUsd || lpUsd < 100) return undefined;

  // Use 0.25% to 1% of LP as the suggested band (tight to avoid being the seller's exit liquidity).
  const min = Math.max(20, Math.floor((lpUsd * 0.0025) / 10) * 10);
  const max = Math.max(50, Math.floor((lpUsd * 0.01) / 10) * 10);

  let rationale: string;
  if (lpUsd > 10_000_000) {
    rationale = `LP is deep ($${formatBigUsd(lpUsd)}) — sizing here is about your portfolio, not slippage.`;
  } else if (lpUsd > 100_000) {
    rationale = `Stay under 1% of the $${formatBigUsd(lpUsd)} LP so you don't move the market against yourself on entry or exit.`;
  } else {
    rationale = `Liquidity is thin ($${formatBigUsd(lpUsd)}). Treat anything bigger than the suggested max as your own price-impact problem.`;
  }

  return { min, max, rationale };
}

/**
 * Stop-loss percentage. Wider for blue-chips, tighter for fresh / thin tokens
 * (because the noise floor is high — a 30% stop on a 12-hour token gets hit by random ticks,
 * but a 30% drop on a 1-year-old token with deep LP is a real signal).
 */
function stopLossFromVolatility(args: {
  ageHours?: number;
  lpUsd: number;
  mcUsd: number;
  isToken2022?: boolean;
}): number {
  const { ageHours, lpUsd, isToken2022 } = args;
  // Default
  let pct = 15;
  if (ageHours !== undefined && ageHours < 24) pct = 20; // very volatile
  if (ageHours !== undefined && ageHours > 24 * 30) pct = 12; // established
  if (lpUsd > 1_000_000) pct -= 2;
  if (lpUsd < 50_000) pct += 5;
  if (isToken2022) pct = Math.max(pct, 18); // wider — transfer-fee tokens have weird P&L
  return Math.max(8, Math.min(30, pct));
}

function ladderFromVerdict(verdict: "safe" | "caution"): TradePlan["takeProfitLadder"] {
  if (verdict === "safe") {
    // Less aggressive ladder for blue-chip / verified tokens (they don't 10x in a day)
    return [
      { at: "1.3x entry", sell: "1/3 of position" },
      { at: "1.7x entry", sell: "1/3 of position" },
      { at: "10% trailing stop", sell: "remaining 1/3" },
    ];
  }
  // Memecoin ladder — front-loaded because most fresh tokens fail
  return [
    { at: "1.5x entry", sell: "1/3 of position" },
    { at: "3x entry", sell: "1/3 of position" },
    { at: "20% trailing stop after 5x", sell: "remaining 1/3 (let the runner run)" },
  ];
}

function buildWatchFor(
  t: TokenAnalysis["token"],
  s5m?: TokenStats,
  _s1h?: TokenStats,
  _s24?: TokenStats
): string[] {
  const out: string[] = [];

  // Liquidity flow
  out.push("LP movement: any drop > 10% in an hour means LPs are exiting. Get out.");

  // Buy/sell ratio shift
  if (s5m && (s5m.numBuys ?? 0) + (s5m.numSells ?? 0) > 10) {
    out.push("5m buy/sell ratio: if it flips to majority sells with rising volume, distribution has started.");
  } else {
    out.push("5m flow: refresh every few minutes — momentum on memecoins flips in seconds.");
  }

  // Dev wallet
  if (t.dev) {
    out.push(`Dev wallet ${shortAddr(t.dev)}: any large outbound transfer to an exchange or fresh wallet = exit signal.`);
  }

  // Top holders
  if (t.top10Pct !== undefined && t.top10Pct > 30) {
    out.push("Top 10 holders: if they start selling in size, you're at the back of the line.");
  }

  return out.slice(0, 4);
}

function buildKillCriteria(t: TokenAnalysis["token"]): string[] {
  const out: string[] = [];
  out.push("Honeypot test starts failing on subsequent scans (sell route disappears).");
  out.push("Liquidity drops more than 20% in any hour.");
  if (!t.mintAuthorityRevoked && !t.isVerified) {
    out.push("Mint authority is exercised (a new mint event hits chain → instant dilution).");
  }
  if (t.dev) {
    out.push("Dev wallet sends a tx to a centralized exchange or burns its own tokens unexpectedly.");
  }
  return out.slice(0, 4);
}

/**
 * Pick the single most useful "what most traders miss" insight given the data.
 * One per recommendation max — the veteran's specific takeaway.
 */
function pickEdge(args: {
  ageHours?: number;
  devMints?: number;
  lpToMcRatio: number;
  sellRatio24: number;
  sellRatio5m: number;
  momentum5mFlip: boolean;
  organicScore?: number;
  isToken2022?: boolean;
  isSus?: boolean;
}): string | undefined {
  const { ageHours, devMints, lpToMcRatio, sellRatio24, sellRatio5m, momentum5mFlip, organicScore, isToken2022 } = args;

  // Highest-priority insights first
  if (momentum5mFlip && sellRatio5m > sellRatio24 + 0.15) {
    return `5-minute flow has flipped against the 24h trend — this almost always precedes a 30%+ leg down. Either you're late, or you wait for the dust to settle and re-enter on the next leg.`;
  }
  if (momentum5mFlip && sellRatio5m + 0.15 < sellRatio24) {
    return `5-minute flow has flipped bullish vs the 24h trend — early sign of momentum reversing. Still risky on memecoins, but this is the spot where bigger players step in.`;
  }
  if (lpToMcRatio > 0 && lpToMcRatio < 0.03) {
    return `LP/MC ratio of ${(lpToMcRatio * 100).toFixed(1)}% is dangerously thin — the market cap is mostly air. The trader who sells first wins; the last one out gets nothing.`;
  }
  if ((devMints ?? 0) > 5) {
    return `Before you size up: open Solscan, look up 3 of this dev's prior tokens. If 2 of 3 are dead at <$10K MC, this is a known rug pattern. If most have $1M+ MC, the dev is a serial shipper — a different bet entirely.`;
  }
  if (ageHours !== undefined && ageHours < 6 && (organicScore ?? 0) < 30) {
    return `Fresh token + low organic score = bot-driven volume. The 'activity' you see isn't real demand — it's a few wallets churning the price to attract bag-holders.`;
  }
  if (isToken2022) {
    return `Token-2022 supports transfer fees and hooks. Even if it's not a honeypot, hidden transfer fees can eat 5-10% of every trade. Test with a tiny ($5) round-trip before committing real money.`;
  }
  if (organicScore !== undefined && organicScore >= 80 && lpToMcRatio > 0.05) {
    return `High organic score with healthy LP/MC ratio — this is what 'real' looks like. The risk here isn't the token itself, it's whether you're chasing or accumulating.`;
  }
  return undefined;
}

// ---------- helpers ----------

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${(hours * 60).toFixed(0)} minutes ago`;
  if (hours < 24) return `${hours.toFixed(1)} hours ago`;
  const days = hours / 24;
  if (days < 30) return `${days.toFixed(0)} days ago`;
  return `${(days / 30).toFixed(0)} months ago`;
}

function formatBigUsd(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

function shortAddr(addr: string, chars = 4): string {
  if (!addr || addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}
