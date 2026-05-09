/**
 * Jupiter API client.
 *
 * Jupiter's keyless endpoints (api.jup.ag and lite-api.jup.ag) at 0.5 RPS
 * give us nearly everything RugScan needs in a single fast call:
 *   - mint authority + freeze authority
 *   - holder count + top-holder concentration (from `audit.topHoldersPercentage`)
 *   - market cap, liquidity, USD price
 *   - verification status + organic score
 *   - 24h trading stats
 *
 * Plus the Jupiter swap quote API powers our honeypot test:
 *   - Buy quote: USDC -> token  (does the token route at all?)
 *   - Sell quote: token -> USDC (can you exit your position?)
 * If only the buy works, the token is a honeypot.
 *
 * No API key required. We fall back from api.jup.ag → lite-api.jup.ag if the
 * primary 429s us.
 */

const PRIMARY_BASE = "https://api.jup.ag";
const FALLBACK_BASE = "https://lite-api.jup.ag";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(`${PRIMARY_BASE}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 429) return res;
  } catch {
    // primary failed — try fallback
  }
  return fetch(`${FALLBACK_BASE}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
  });
}

// ---------- Tokens V2 search ----------

export interface JupTokenAudit {
  isSus?: boolean;
  mintAuthorityDisabled?: boolean;
  freezeAuthorityDisabled?: boolean;
  topHoldersPercentage?: number;
  devBalancePercentage?: number;
  devMints?: number;
}

export interface JupTokenStats {
  /** % change since the start of the window */
  priceChange?: number;
  /** % change in liquidity over the window — negative means LP being pulled */
  liquidityChange?: number;
  /** % change in number of holders */
  holderChange?: number;
  /** % change in volume vs prior window */
  volumeChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  numBuys?: number;
  numSells?: number;
  numTraders?: number;
  numOrganicBuyers?: number;
  numNetBuyers?: number;
  buyOrganicVolume?: number;
  sellOrganicVolume?: number;
}

export interface JupToken {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  tokenProgram: string;
  createdAt?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  dev?: string;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  circSupply?: number;
  totalSupply?: number;
  launchpad?: string;
  graduatedAt?: string;
  holderCount?: number;
  fdv?: number;
  mcap?: number;
  usdPrice?: number;
  liquidity?: number;
  audit?: JupTokenAudit;
  organicScore?: number;
  organicScoreLabel?: "high" | "medium" | "low";
  isVerified?: boolean;
  tags?: string[];
  stats5m?: JupTokenStats;
  stats1h?: JupTokenStats;
  stats6h?: JupTokenStats;
  stats24h?: JupTokenStats;
  firstPool?: {
    id: string;
    createdAt?: string;
  };
}

/**
 * Look up a single mint via Jupiter Tokens V2.
 * Returns null if Jupiter has no record of this mint.
 */
export async function searchToken(mint: string): Promise<JupToken | null> {
  const res = await fetchWithFallback(`/tokens/v2/search?query=${encodeURIComponent(mint)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as JupToken[];
  if (!Array.isArray(data) || data.length === 0) return null;
  // Make sure we matched on the mint, not on a fuzzy symbol match
  const exact = data.find((t) => t.id === mint);
  return exact ?? null;
}

// ---------- Honeypot test via swap quote ----------

interface JupQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string | number;
  routePlan?: Array<{ swapInfo?: { label?: string } }>;
}

async function jupQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number;
}): Promise<JupQuote | null> {
  const url = new URL(`${PRIMARY_BASE}/swap/v1/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 100));
  url.searchParams.set("onlyDirectRoutes", "false");

  try {
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) {
      // fallback host
      const fallbackUrl = new URL(`${FALLBACK_BASE}/swap/v1/quote`);
      url.searchParams.forEach((v, k) => fallbackUrl.searchParams.set(k, v));
      const fb = await fetch(fallbackUrl.toString(), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!fb.ok) return null;
      return (await fb.json()) as JupQuote;
    }
    if (!res.ok) return null;
    return (await res.json()) as JupQuote;
  } catch {
    return null;
  }
}

export interface HoneypotReport {
  /** Live USD price (best-effort), undefined if no route found */
  priceUsd?: number;
  /** Did we get a valid USDC -> token quote (i.e. you can buy it)? */
  canBuy: boolean;
  /** Did we get a valid token -> USDC quote (i.e. you can sell it)? */
  canSell: boolean;
  /** Strong signal: buyable but not sellable */
  isHoneypot: boolean;
  /** Price impact (%) for a $10 buy */
  smallBuyImpactPct?: number;
  /** Price impact (%) for a $1,000 buy */
  largeBuyImpactPct?: number;
  /** Distinct DEX routes found across both quotes */
  routesCount?: number;
  errors: string[];
}

export async function honeypotTest(mint: string, decimals: number): Promise<HoneypotReport> {
  const errors: string[] = [];

  // Special case: USDC itself. Trivially buyable and sellable (it IS the
  // numeraire we use). Skip the round-trip and return synthetic success.
  if (mint === USDC_MINT) {
    return {
      priceUsd: 1,
      canBuy: true,
      canSell: true,
      isHoneypot: false,
      smallBuyImpactPct: 0,
      largeBuyImpactPct: 0,
      routesCount: undefined,
      errors: [],
    };
  }

  const smallBuyAmount = BigInt(10 * 10 ** 6); // $10 USDC
  const largeBuyAmount = BigInt(1_000 * 10 ** 6); // $1,000 USDC

  const [smallBuy, largeBuy] = await Promise.all([
    jupQuote({ inputMint: USDC_MINT, outputMint: mint, amount: smallBuyAmount }),
    jupQuote({ inputMint: USDC_MINT, outputMint: mint, amount: largeBuyAmount }),
  ]);

  let canSell = false;
  let priceUsd: number | undefined;
  if (smallBuy && smallBuy.outAmount && smallBuy.outAmount !== "0") {
    const tokenAmountOut = BigInt(smallBuy.outAmount);
    if (tokenAmountOut > 0n) {
      const sell = await jupQuote({
        inputMint: mint,
        outputMint: USDC_MINT,
        amount: tokenAmountOut,
      });
      if (sell && sell.outAmount && sell.outAmount !== "0") {
        canSell = true;
        const tokenAmountHuman = Number(tokenAmountOut) / 10 ** decimals;
        if (tokenAmountHuman > 0) priceUsd = 10 / tokenAmountHuman;
      } else {
        errors.push("Jupiter has no SELL route — possible honeypot.");
      }
    }
  } else {
    errors.push("Jupiter has no BUY route via $10 USDC.");
  }

  const canBuy = !!smallBuy && smallBuy.outAmount !== "0";
  const isHoneypot = canBuy && !canSell;

  const routesSet = new Set<string>();
  for (const q of [smallBuy, largeBuy]) {
    if (q?.routePlan) {
      for (const step of q.routePlan) {
        if (step.swapInfo?.label) routesSet.add(step.swapInfo.label);
      }
    }
  }

  return {
    priceUsd,
    canBuy,
    canSell,
    isHoneypot,
    smallBuyImpactPct: smallBuy ? Number(smallBuy.priceImpactPct) * 100 : undefined,
    largeBuyImpactPct: largeBuy ? Number(largeBuy.priceImpactPct) * 100 : undefined,
    routesCount: routesSet.size > 0 ? routesSet.size : undefined,
    errors,
  };
}
