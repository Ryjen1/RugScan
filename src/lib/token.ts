import { Connection, PublicKey } from "@solana/web3.js";
import { getRpcUrl } from "./simulate";

/**
 * On-chain RPC fallback for tokens that Jupiter doesn't know about (very new
 * launches, unbonded pump.fun tokens, custom mints, etc).
 *
 * For tokens Jupiter does know about, we use the much richer Jupiter Tokens V2
 * API instead — see `lib/jupiter.ts`.
 */

export interface TokenMintInfo {
  mint: string;
  /** Total supply normalized by decimals */
  supply: number;
  decimals: number;
  mintAuthorityRevoked: boolean;
  mintAuthority?: string;
  freezeAuthorityRevoked: boolean;
  freezeAuthority?: string;
  isToken2022: boolean;
  /** Approximate age in hours, derived from the oldest mint signature */
  ageHours?: number;
}

const SPL_TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/**
 * Validate that a string is a base58-encoded 32-byte public key.
 * Throws with a user-friendly message if not.
 */
export function assertMintAddress(input: string): PublicKey {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste a Solana token address.");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    throw new Error(
      "That doesn't look like a Solana token address. Paste the mint (32–44 base58 chars) — you can find it on Solscan, DexScreener, or pump.fun."
    );
  }
  try {
    return new PublicKey(trimmed);
  } catch {
    throw new Error("Invalid Solana address. Double-check the mint and try again.");
  }
}

export async function fetchMintInfo(mint: PublicKey): Promise<TokenMintInfo> {
  const conn = new Connection(getRpcUrl(), "confirmed");
  const info = await conn.getParsedAccountInfo(mint, "confirmed");

  if (!info.value) {
    throw new Error(
      "This address doesn't exist on Solana mainnet. Either it's wrong, it's an EVM contract address (Solana only), or the token hasn't launched yet."
    );
  }

  const owner = info.value.owner.toBase58();
  const isToken2022 = owner === TOKEN_2022_PROGRAM.toBase58();
  const isSplToken = owner === SPL_TOKEN_PROGRAM.toBase58();

  if (!isToken2022 && !isSplToken) {
    throw new Error(
      `That address is not a token mint. It looks like a ${
        owner === "11111111111111111111111111111111" ? "regular wallet account" : "program account or NFT"
      }. Paste a token mint address.`
    );
  }

  const data = info.value.data;
  if (!("parsed" in data) || data.parsed.type !== "mint") {
    throw new Error(
      "That address is owned by the token program but isn't a mint. Make sure you copied the mint address, not a token account."
    );
  }

  const parsed = data.parsed.info as {
    decimals: number;
    supply: string;
    mintAuthority: string | null;
    freezeAuthority: string | null;
  };

  const supplyRaw = BigInt(parsed.supply);
  const decimals = parsed.decimals;
  const supply = Number(supplyRaw) / 10 ** decimals;

  // Best-effort age probe (may fail with 429 — non-fatal)
  let ageHours: number | undefined;
  try {
    const sigs = await conn.getSignaturesForAddress(mint, { limit: 1000 }, "confirmed");
    const oldest = sigs[sigs.length - 1];
    if (oldest?.blockTime) {
      ageHours = Math.max(0, (Date.now() / 1000 - oldest.blockTime) / 3600);
    }
  } catch {
    // ignore
  }

  return {
    mint: mint.toBase58(),
    supply,
    decimals,
    mintAuthorityRevoked: parsed.mintAuthority === null,
    mintAuthority: parsed.mintAuthority ?? undefined,
    freezeAuthorityRevoked: parsed.freezeAuthority === null,
    freezeAuthority: parsed.freezeAuthority ?? undefined,
    isToken2022,
    ageHours,
  };
}
