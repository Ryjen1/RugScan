/**
 * RPC URL configuration. Used by every module that hits Solana RPC.
 *
 * Free public RPC works for low-volume hackathon use, but rate-limits hard.
 * Setting HELIUS_API_KEY upgrades to Helius's free-tier RPC, which is much
 * more reliable for the parallel calls our token analyzer makes.
 */

const FALLBACK_RPC = "https://api.mainnet-beta.solana.com";

export function getRpcUrl(): string {
  // Use ||, not ??, so empty-string env values fall through correctly.
  // (.env.local often has SOLANA_RPC_URL= written but blank.)
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return FALLBACK_RPC;
}
