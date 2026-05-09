import type { HoneypotReport } from "./jupiter";

export type Verdict = "safe" | "caution" | "danger";

export interface RiskFlag {
  severity: "info" | "warn" | "danger" | "good";
  code: string;
  title: string;
  detail: string;
}

export interface TokenRiskReport {
  verdict: Verdict;
  score: number;
  headline: string;
  flags: RiskFlag[];
  goodSignals: RiskFlag[];
  badSignals: RiskFlag[];
}

/**
 * The shape we score from. Mirrors `TokenAnalysis["token"]` from
 * token-analyze.ts but typed independently to avoid circular imports.
 */
export interface RiskMintInputs {
  mint: string;
  decimals: number;
  symbol?: string;
  mintAuthorityRevoked: boolean;
  mintAuthority?: string;
  freezeAuthorityRevoked: boolean;
  freezeAuthority?: string;
  isToken2022: boolean;
  ageHours?: number;
  mcap?: number;
  liquidityUsd?: number;
  priceUsd?: number;
  holderCount?: number;
  top10Pct?: number;
  devBalancePct?: number;
  devMints?: number;
  organicScore?: number;
  organicScoreLabel?: "high" | "medium" | "low";
  isVerified?: boolean;
  isSus?: boolean;
  tags?: string[];
  launchpad?: string;
  /** 24h trading stats — used for momentum/distribution flags */
  stats24h?: {
    priceChange?: number;
    liquidityChange?: number;
    holderChange?: number;
    buyVolume?: number;
    sellVolume?: number;
    numBuys?: number;
    numSells?: number;
    numTraders?: number;
  };
}

interface RiskInputs {
  mint: RiskMintInputs;
  honeypot: HoneypotReport;
}

/**
 * Score a token for buying risk. Calibrated against common rug patterns.
 */
export function scoreToken({ mint, honeypot }: RiskInputs): TokenRiskReport {
  const flags: RiskFlag[] = [];
  let score = 0;

  // Some legitimate tokens (USDC, USDT, regulated assets) keep mint/freeze
  // authorities active by design. We treat verified Jupiter tokens with the
  // "stablecoin" or "lst" tag, or with extremely high organic score, as
  // "expected to retain authority" — we still flag the fact, but as info
  // rather than danger.
  const isReputableIssued =
    !!mint.isVerified &&
    ((mint.tags ?? []).some((t) => /stable|stablecoin|lst|rwa|fiat/i.test(t)) ||
      (mint.organicScore !== undefined && mint.organicScore >= 80));

  // ---- Authority checks ----
  if (!mint.mintAuthorityRevoked) {
    if (isReputableIssued) {
      flags.push({
        severity: "info",
        code: "mint_authority_issuer",
        title: "Mint authority retained by the issuer",
        detail: `Mint authority remains with ${shortAddr(mint.mintAuthority ?? "?")}. For a verified, regulated issuer (e.g. Circle for USDC, Marinade for mSOL), this is expected. For a memecoin, it would be a rug-pull setup.`,
      });
      // No score penalty for verified issuers — this is normal.
    } else {
      flags.push({
        severity: "danger",
        code: "mint_authority_active",
        title: "Mint authority is NOT revoked",
        detail: `The wallet ${shortAddr(mint.mintAuthority ?? "?")} can mint unlimited new tokens at any time, diluting your holding to zero. For an unverified token, this is a textbook rug setup.`,
      });
      score += 35;
    }
  } else {
    flags.push({
      severity: "good",
      code: "mint_authority_revoked",
      title: "Mint authority revoked",
      detail: "Total supply is locked — no one can ever mint more of this token.",
    });
  }

  if (!mint.freezeAuthorityRevoked) {
    if (isReputableIssued) {
      flags.push({
        severity: "info",
        code: "freeze_authority_issuer",
        title: "Freeze authority retained by the issuer",
        detail: `Freeze authority remains with ${shortAddr(mint.freezeAuthority ?? "?")}. Regulated stablecoins use this for compliance (e.g. freezing sanctioned wallets). For a memecoin, it would be a major red flag.`,
      });
    } else {
      flags.push({
        severity: "danger",
        code: "freeze_authority_active",
        title: "Freeze authority is NOT revoked",
        detail: `The wallet ${shortAddr(mint.freezeAuthority ?? "?")} can freeze your token account at any time, locking your tokens forever. Real protocols revoke this.`,
      });
      score += 30;
    }
  } else {
    flags.push({
      severity: "good",
      code: "freeze_authority_revoked",
      title: "Freeze authority revoked",
      detail: "No one can freeze your tokens once you hold them.",
    });
  }

  // ---- Jupiter-flagged "sus" override ----
  if (mint.isSus) {
    flags.push({
      severity: "danger",
      code: "jupiter_flagged_sus",
      title: "Jupiter has flagged this token as suspicious",
      detail: "Jupiter's audit pipeline (used by Phantom, Solflare, and most Solana wallets) has marked this token as suspicious based on trading and on-chain behaviour.",
    });
    score += 30;
  }

  // ---- Verified / organic score ----
  if (mint.isVerified) {
    flags.push({
      severity: "good",
      code: "jupiter_verified",
      title: "Jupiter VERIFIED",
      detail: "Jupiter has verified this token. Strong reputational signal.",
    });
  }

  if (mint.organicScore !== undefined) {
    if (mint.organicScore >= 60) {
      flags.push({
        severity: "good",
        code: "high_organic_score",
        title: `Organic score ${mint.organicScore.toFixed(0)}/100 (${mint.organicScoreLabel ?? "high"})`,
        detail: "Real users are trading this — high score reflects genuine demand, not bot-driven volume.",
      });
    } else if (mint.organicScore < 20) {
      flags.push({
        severity: "warn",
        code: "low_organic_score",
        title: `Low organic score ${mint.organicScore.toFixed(0)}/100`,
        detail: "Most volume looks bot-driven or wash-traded rather than from real users. Hype may not be real.",
      });
      score += 10;
    }
  }

  // ---- Age check ----
  if (mint.ageHours !== undefined) {
    if (mint.ageHours < 1) {
      flags.push({
        severity: "danger",
        code: "extremely_new_token",
        title: "Token launched less than 1 hour ago",
        detail: "Brand new. Most rugs and pump-and-dumps happen within the first few hours of launch.",
      });
      score += 25;
    } else if (mint.ageHours < 24) {
      flags.push({
        severity: "warn",
        code: "new_token",
        title: `Token launched ${mint.ageHours.toFixed(1)} hours ago`,
        detail: "Less than a day old. Very few new tokens survive a week.",
      });
      score += 12;
    } else if (mint.ageHours > 24 * 30) {
      flags.push({
        severity: "good",
        code: "established_age",
        title: "Token has been around for over a month",
        detail: `Token is ~${(mint.ageHours / 24).toFixed(0)} days old, which means it survived initial pump-and-dump risk.`,
      });
    }
  }

  // ---- Holder concentration (Jupiter audit data) ----
  if (mint.top10Pct !== undefined) {
    if (mint.top10Pct > 80) {
      flags.push({
        severity: "danger",
        code: "extreme_top10",
        title: `Top 10 wallets hold ${mint.top10Pct.toFixed(1)}% of supply`,
        detail: "Insiders effectively own the token. They can crash the price at will.",
      });
      score += 25;
    } else if (mint.top10Pct > 50) {
      flags.push({
        severity: "warn",
        code: "high_top10",
        title: `Top 10 wallets hold ${mint.top10Pct.toFixed(1)}% of supply`,
        detail: "Heavily concentrated. Vulnerable to coordinated dumps.",
      });
      score += 12;
    } else if (mint.top10Pct < 30) {
      flags.push({
        severity: "good",
        code: "good_distribution",
        title: `Healthy holder distribution (${mint.top10Pct.toFixed(1)}% top 10)`,
        detail: "Supply is well-distributed across many holders.",
      });
    }
  }

  if (mint.devBalancePct !== undefined && mint.devBalancePct > 20) {
    flags.push({
      severity: "warn",
      code: "dev_holds_lots",
      title: `Dev wallet holds ${mint.devBalancePct.toFixed(1)}% of supply`,
      detail: "The deployer kept a large bag for themselves. They can dump it on you.",
    });
    score += 10;
  }

  if (mint.devMints !== undefined && mint.devMints > 5) {
    flags.push({
      severity: "warn",
      code: "serial_minter",
      title: `Dev has launched ${mint.devMints} other tokens`,
      detail: "This wallet has minted many tokens before. Could be a launchpad professional, could be a serial rugger — investigate the dev's track record.",
    });
    score += 8;
  }

  if (mint.holderCount !== undefined && mint.holderCount < 50 && mint.ageHours !== undefined && mint.ageHours > 24) {
    flags.push({
      severity: "warn",
      code: "few_holders",
      title: `Only ${mint.holderCount} total holders`,
      detail: "After more than a day, the token has barely attracted any holders. There's no real market here.",
    });
    score += 8;
  }

  // ---- Liquidity / honeypot ----
  if (!honeypot.canBuy) {
    flags.push({
      severity: "danger",
      code: "no_buy_route",
      title: "No way to buy this token through Jupiter",
      detail: "There is no DEX liquidity routable. Either the token isn't tradable, or it just launched and hasn't been bonded yet.",
    });
    score += 30;
  }

  if (honeypot.isHoneypot) {
    flags.push({
      severity: "danger",
      code: "honeypot",
      title: "Honeypot detected — you can buy but cannot sell",
      detail: "Jupiter quotes a successful buy, but the reverse sell quote fails. This is a classic honeypot scam.",
    });
    score += 50;
  } else if (honeypot.canBuy && honeypot.canSell) {
    flags.push({
      severity: "good",
      code: "tradable",
      title: "Buyable AND sellable on Jupiter",
      detail: "Jupiter routed a buy and a reverse sell — you can exit your position cleanly.",
    });
  }

  if (honeypot.smallBuyImpactPct !== undefined && honeypot.smallBuyImpactPct > 5 && honeypot.canBuy) {
    flags.push({
      severity: "warn",
      code: "thin_liquidity_small",
      title: `A $10 buy moves the price ${honeypot.smallBuyImpactPct.toFixed(2)}%`,
      detail: "Liquidity is so thin that even tiny trades move the market. Avoid sizing up.",
    });
    score += 10;
  }

  if (honeypot.largeBuyImpactPct !== undefined && honeypot.largeBuyImpactPct > 20) {
    flags.push({
      severity: "warn",
      code: "thin_liquidity_large",
      title: `A $1,000 buy moves the price ${honeypot.largeBuyImpactPct.toFixed(1)}%`,
      detail: "Real money can't enter or exit cleanly. Position-size accordingly.",
    });
    score += 8;
  }

  if (honeypot.routesCount !== undefined && honeypot.routesCount >= 3) {
    flags.push({
      severity: "good",
      code: "multi_dex",
      title: `Tradable on ${honeypot.routesCount}+ DEXs`,
      detail: "Routed across multiple DEXs — liquidity is diversified.",
    });
  }

  // ---- Liquidity USD ----
  if (mint.liquidityUsd !== undefined) {
    if (mint.liquidityUsd < 5_000) {
      flags.push({
        severity: "warn",
        code: "tiny_liquidity",
        title: `Only $${Math.round(mint.liquidityUsd).toLocaleString()} of total liquidity`,
        detail: "There's barely any liquidity. A handful of sells will collapse the price.",
      });
      score += 12;
    } else if (mint.liquidityUsd > 1_000_000) {
      flags.push({
        severity: "good",
        code: "deep_liquidity",
        title: `$${Math.round(mint.liquidityUsd).toLocaleString()} of total liquidity`,
        detail: "Deep DEX liquidity — real money can move in and out.",
      });
    }
  }

  // ---- 24h trading signals (trader-relevant) ----
  if (mint.stats24h) {
    const s = mint.stats24h;
    const totalVol = (s.buyVolume ?? 0) + (s.sellVolume ?? 0);

    // Liquidity bleeding out — strong rug-in-progress signal
    if (s.liquidityChange !== undefined && s.liquidityChange < -30) {
      flags.push({
        severity: "danger",
        code: "lp_pulling",
        title: `Liquidity dropped ${s.liquidityChange.toFixed(1)}% in 24h`,
        detail: "DEX liquidity is being pulled. This often precedes — or IS — an active rug.",
      });
      score += 25;
    } else if (s.liquidityChange !== undefined && s.liquidityChange < -10) {
      flags.push({
        severity: "warn",
        code: "lp_shrinking",
        title: `Liquidity shrinking (${s.liquidityChange.toFixed(1)}% in 24h)`,
        detail: "LPs are exiting. Watch this carefully before sizing up.",
      });
      score += 8;
    }

    // Sells overwhelmingly outnumber buys → distribution / dump in progress
    if (s.numBuys !== undefined && s.numSells !== undefined && s.numBuys + s.numSells > 50) {
      const sellRatio = s.numSells / (s.numBuys + s.numSells);
      if (sellRatio > 0.7) {
        flags.push({
          severity: "warn",
          code: "heavy_distribution",
          title: `${(sellRatio * 100).toFixed(0)}% of trades are sells`,
          detail: "Holders are distributing. Buying into a sell wall is a coin-flip at best.",
        });
        score += 10;
      } else if (sellRatio < 0.3 && s.numBuys + s.numSells > 200) {
        flags.push({
          severity: "good",
          code: "buy_pressure",
          title: `${((1 - sellRatio) * 100).toFixed(0)}% of trades are buys`,
          detail: "Strong buy pressure over the last 24h.",
        });
      }
    }

    // Holder count collapsing
    if (s.holderChange !== undefined && s.holderChange < -10) {
      flags.push({
        severity: "warn",
        code: "holders_leaving",
        title: `Holder count dropped ${s.holderChange.toFixed(1)}% in 24h`,
        detail: "Holders are exiting. Token is shedding interest.",
      });
      score += 8;
    }

    // Single-trader bot volume (high volume but very few traders)
    if (totalVol > 50_000 && s.numTraders !== undefined && s.numTraders < 10) {
      flags.push({
        severity: "warn",
        code: "bot_volume",
        title: `$${Math.round(totalVol).toLocaleString()} of volume from only ${s.numTraders} traders`,
        detail: "Volume looks bot-driven — a handful of wallets churning the price. The 'activity' isn't real demand.",
      });
      score += 10;
    }
  }

  // ---- Token-2022 ----
  if (mint.isToken2022) {
    flags.push({
      severity: "warn",
      code: "token_2022",
      title: "Uses Token-2022 (extended token program)",
      detail: "Token-2022 supports transfer hooks and fees, which can be used legitimately but are also abused for honeypot-like scams. Verify carefully.",
    });
    score += 5;
  }

  // ---- Bucket ----
  score = Math.min(100, Math.max(0, score));
  let verdict: Verdict;
  let headline: string;

  const hasDanger = flags.some((f) => f.severity === "danger");

  if (score >= 60 || hasDanger) {
    verdict = "danger";
    headline = "🔴 Don't buy — this token shows multiple rug-pull signals";
  } else if (score >= 25 || flags.some((f) => f.severity === "warn")) {
    verdict = "caution";
    headline = "🟡 Be careful — there are unusual signals worth understanding before buying";
  } else {
    verdict = "safe";
    headline = "🟢 Token looks healthy — the basic safety boxes are checked";
  }

  const goodSignals = flags.filter((f) => f.severity === "good");
  const badSignals = flags.filter((f) => f.severity === "danger" || f.severity === "warn");

  return { verdict, score, headline, flags, goodSignals, badSignals };
}

function shortAddr(addr: string, chars = 4): string {
  if (!addr || addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}
