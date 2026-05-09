/**
 * Demo tokens for the killer 3-button landing UX.
 *
 * Unlike the previous "synthetic transaction" demos, these are REAL mainnet
 * tokens. Judges can copy any of these mints into Solscan and verify everything
 * RugScan reports — that builds trust. We just curate which ones to feature.
 *
 * The "danger" slot rotates: pump.fun has a steady firehose of fresh tokens
 * with mint authority active and 1-wallet ownership. The hardcoded address
 * is a known historical pattern; if it dies, the analyzer simply gracefully
 * surfaces "Jupiter has no liquidity" instead of crashing — which is itself
 * a useful demo of how the tool degrades.
 */

export interface DemoToken {
  id: "safe" | "caution" | "danger";
  label: string;
  emoji: string;
  description: string;
  mint: string;
}

export const DEMO_TOKENS: DemoToken[] = [
  {
    id: "safe",
    label: "USDC (verified, audited)",
    emoji: "🟢",
    description:
      "USD Coin — the gold-standard Solana token. Mint authority belongs to Circle, but the token is regulated, audited, and Jupiter-verified. Use this to see what 'safe' looks like.",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  {
    id: "caution",
    label: "BONK (popular memecoin)",
    emoji: "🟡",
    description:
      "BONK — the original Solana dog coin. Mint and freeze authorities are revoked, deep liquidity, but it's still a high-volatility memecoin. Shows the 'liquid + safe-mechanics + still-risky' middle case.",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  },
  {
    id: "danger",
    label: "Fresh pump.fun token",
    emoji: "🔴",
    description:
      "A token launched in the last hour by a dev who has minted 25+ tokens before. Token-2022, extremely low holder count, organic score 0. The textbook rug setup — see how RugScan flags it.",
    // PokémonGo (HBttQik...) — caught live during testing. If it dies (most
    // pump.fun tokens have <24h lifespan), the analyzer surfaces a helpful
    // error and judges can paste any current pump.fun mint instead. Try
    // anything from https://pump.fun/board for a live replacement.
    mint: "HBttQikiiPcLTj8aDy7f7hpSP4df6aqfyowD2GMphvqb",
  },
];

export function findDemoToken(id: string): DemoToken | undefined {
  return DEMO_TOKENS.find((d) => d.id === id);
}
