# RugScan

> **Don't buy blind.** RugScan is a Solana-native AI that analyzes any token in plain English before you buy it.

Built for **Dev3pack Global Hackathon 2026**.

---

## What it does

Paste any Solana token address (the mint) — or pick one of the three pre-loaded demo tokens — and RugScan will:

1. **Pull live token data** from Jupiter's Tokens V2 API in one call: mint authorities, holder count, top-10 concentration, dev wallet history, organic score, market cap, liquidity, verification status
2. **Run a live honeypot test** by getting a Jupiter buy quote and a reverse sell quote — if you can buy but not sell, you're getting scammed
3. **Score the rug-pull risk** with a rules engine calibrated against real pump.fun rug patterns
4. **Stream a plain-English explanation** via an LLM (Groq Llama 3.3 70B by default), with a chat box to ask follow-up questions like *"is this safe to buy 0.5 SOL of?"*

If no LLM API key is configured, RugScan still works — it streams a deterministic, structured explanation built from the analysis.

---

## The problem

Every day, thousands of fresh tokens launch on Solana via pump.fun and similar launchpads. **Most of them are rugs.** Mint authority left open, single wallet sitting on 80%+ of supply, honeypots that take your SOL but won't let you sell back. Crypto traders lose money to these constantly.

The data to detect rugs is publicly available — Jupiter's audit pipeline already has it. But there's no consumer tool that surfaces it in plain English with a clear "buy / don't buy" verdict. RugScan is that tool.

---

## The killer demo

Three buttons on the home page, each runs against a real mainnet token:

- **🟢 USDC** — established stablecoin, Jupiter verified, $474M liquidity, organic score 100. Verdict: **SAFE TO BUY**, score 0/100.
- **🟡 BONK** — popular memecoin. Authorities revoked, 96 organic score, but the dev has launched 10 other tokens. Verdict: **CAUTION**, score 8/100.
- **🔴 Fresh pump.fun token** — <1h old, dev has minted 25 tokens before, Token-2022, organic score 0. Verdict: **DON'T BUY**, score 48/100, multiple flags caught.

Click any of them, watch the verdict banner appear in ~1 second, see the good/bad signal split, the live mcap/liquidity/holder count, the live honeypot test result, and the streaming AI explanation. Ask follow-up questions in the chat panel.

---

## Architecture

```
[Browser]
   │
   │  (paste mint or pick demo)
   ▼
[/api/token]  ─── Jupiter Tokens V2 ──▶ api.jup.ag/tokens/v2/search
   │           ─── Honeypot test     ─▶ api.jup.ag/swap/v1/quote (buy + reverse sell)
   │           ─── Score             ─▶ src/lib/token-risk.ts
   ▼
[Verdict + Key Metrics + Signals + Honeypot + Holders]
   │
   │  (auto-explain + Q&A)
   ▼
[/api/chat]  ─── streaming via Vercel AI SDK
                 (Groq Llama 3.3 70B by default; OpenAI fallback;
                  deterministic explanation if no key)
   ▼
[Streaming chat panel]
```

**One single Jupiter call gives us almost all the data.** Average analysis latency: **<1.5 seconds**. No API keys required for the analysis itself — Jupiter's keyless tier (0.5 RPS at api.jup.ag, with auto-fallback to lite-api.jup.ag) is plenty for hackathon use.

### File layout

```
src/
├── app/
│   ├── page.tsx                   # Landing: paste box + 3 demo cards
│   ├── report/page.tsx            # Verdict + signals + chat
│   └── api/
│       ├── token/route.ts         # Full analyze pipeline
│       ├── chat/route.ts          # Streaming LLM with offline fallback
│       └── demo-tokens/route.ts   # Serves the 3 demo tokens
├── lib/
│   ├── jupiter.ts                 # Tokens V2 + honeypot test (THE main API)
│   ├── token.ts                   # On-chain RPC fallback for unlisted tokens
│   ├── token-risk.ts              # Rug-pattern detection rules
│   ├── token-analyze.ts           # End-to-end pipeline
│   ├── demo.ts                    # 3 demo tokens (real mainnet mints)
│   ├── simulate.ts                # RPC URL config
│   └── utils.ts
└── components/
    └── Button.tsx
```

---

## Run it

### Prerequisites

- Node 20+ (developed on Node 24)
- pnpm 9+

### Install

```bash
pnpm install
```

### Configure (optional)

Create `.env.local`:

```bash
# Optional: better RPC for unlisted tokens (Jupiter is the primary source)
HELIUS_API_KEY=your_helius_key

# Optional: enables LLM-powered explanations & chat.
# Without this, RugScan streams a deterministic structured explanation.
GROQ_API_KEY=your_groq_key
# or
OPENAI_API_KEY=your_openai_key
```

### Dev

```bash
pnpm dev
```

Visit http://localhost:3000.

### Production build

```bash
pnpm build
pnpm start
```

---

## Demo flow (for judges, in 60 seconds)

1. **Open the home page.** "Don't buy blind." Three demo buttons.
2. **Click 🔴 Fresh pump.fun token.** Verdict banner pulses red — **DON'T BUY**, score ~50/100.
3. **Walk through the signal split:**
   - ❌ "Token launched less than 1 hour ago"
   - ❌ "Dev has launched 25 other tokens" (serial rugger)
   - ❌ "Low organic score 0/100" (no real users, just bots)
   - ❌ "Uses Token-2022" (transfer-fee / honeypot footguns)
   - ✅ But mint/freeze authorities ARE revoked
4. **Show the chat panel** — it auto-streams a plain-English summary. Type *"is this a rug?"* — get a grounded answer.
5. **Hit "Scan another token", click 🟢 USDC.** Verdict flips to green: SAFE, score 0, 5.2M holders, $8.6B mcap, organic score 100.
6. **Optional: paste any pump.fun token URL's mint** to show it works on anything.

That's the demo. The 60 seconds judges remember.

---

## Why this wins Dev3pack

- **Real, current problem.** People rug-pulled daily on Solana memecoins. Visceral.
- **Validated category.** Jupiter's own audit pipeline already produces this data. We're the consumer-facing layer.
- **Solana-native.** Pulls from Jupiter (used by Phantom, Solflare, every Solana wallet) — perfect ecosystem fit.
- **Demo lands instantly.** Paste → 1.5s analysis → red/green verdict. No setup, no install, no wallet connection needed.
- **AI-conversational.** Ask follow-up questions, get grounded answers. Leverages the LLM properly (explanation, not classification).

### Tracks

- **Category:** Infrastructure / Dev Tools (primary)
- **Category:** AI / ML (secondary)
- **Solana** main track
- **Jupiter** sponsor angle (uses their Tokens V2 + Swap quote API as the data backbone)

---

## What's *not* in the MVP

By design, to ship in time:

- No real-time alerts (you scan, you decide; not a watchlist tool)
- No browser extension yet (web app only)
- No Twitter/social-graph dev-history beyond Jupiter's `devMints` count
- Demo's "danger" mint will eventually 404 as that pump.fun token dies — judges can paste any current pump.fun mint to replace it (one-line edit in `src/lib/demo.ts`)

---

## Credits

Built for **Dev3pack Global Hackathon 2026**.
Stack: Next.js 16, TypeScript, Tailwind v4, Solana web3.js, Vercel AI SDK, Groq, Jupiter Tokens V2 API.
