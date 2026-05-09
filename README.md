# Shrewd Guard

> A 10-year veteran trader in your pocket for every Solana token.
> Paste a contract; get a sized playbook a pro would write.

Built for **Dev3pack Global Hackathon 2026**.

---

## What it does

Paste any Solana token mint — or pick one of the three pre-loaded demo tokens — and Shrewd Guard will:

1. **Pull live token data** from Jupiter Tokens V2 in one call: mint authorities, holder count, top-10 concentration, dev wallet history, organic score, market cap, liquidity, verification status, 24h trading stats
2. **Run a live honeypot test** by getting a Jupiter buy quote and a reverse sell quote — if you can buy but not sell, you're being scammed
3. **Score the rug-pull risk** with a rules engine calibrated against real pump.fun rug patterns
4. **Generate a veteran trader's playbook** — concrete numbers a 10-year pro would give to a less experienced trader: position size in dollars, stop-loss percentage, take-profit ladder, watch criteria, kill criteria, plus the non-obvious insight a newbie would miss
5. **Stream a plain-English explanation** via an LLM (Groq Llama 3.3 70B by default) with a chat box for follow-up questions

If no LLM API key is configured, Shrewd Guard still works — it streams a deterministic, structured explanation built from the analysis.

---

## The problem

Every day, thousands of fresh tokens launch on Solana via pump.fun and similar launchpads. **Most of them are rugs.** Mint authority left open, single wallet sitting on 80%+ of supply, honeypots that take your SOL but won't let you sell back. Crypto traders lose money to these constantly.

The data to detect rugs is publicly available — Jupiter's audit pipeline already has it. Existing tools (RugCheck, Birdeye Security, DexScreener) show you the data. **They don't tell you what to do with it.** Shrewd Guard is the first analyzer that gives traders a sized playbook — entry, stop, exit, and kill criteria — like a pro sitting at the next desk would.

---

## The killer demo

Three buttons on the home page, each runs against a real mainnet token:

- **🟢 USDC** — established stablecoin, Jupiter verified, $474M liquidity, organic score 100. Verdict: **CONSIDER** (with the right framing — *"hold, don't trade — this is a stable / yield asset"* — no fake playbook).
- **🟡 BONK** — popular memecoin. Authorities revoked, 96 organic score, but the dev has launched 10 other tokens. Verdict: **SIZE_SMALL** with a concrete $9,270–$37,100 position size (1% of LP), 10% stop-loss, 1.5x/3x/runner take-profit ladder.
- **🔴 Fresh pump.fun token** — <1h old, dev has minted 25 tokens before, Token-2022, organic score 0, Jupiter sus-flagged. Verdict: **SKIP** — *"Hard pass — flagged by Jupiter, dev is a serial launcher."*

Click any of them, watch the trader's metric strip render in ~1 second (price, mcap, LP, holders, age, organic score with 24h-change subtext), see the **Veteran's Take** card with the playbook, the good/bad signal split, the multi-window price activity (5m / 1h / 6h / 24h with buy/sell ratio bars), and the streaming AI explanation. Ask follow-ups in the chat panel.

---

## Architecture

```
[Browser]
   │
   │  (paste mint or pick demo)
   ▼
[/api/token]  ─── Jupiter Tokens V2  ─▶ api.jup.ag/tokens/v2/search
   │           ─── Honeypot test     ─▶ api.jup.ag/swap/v1/quote (buy + reverse sell)
   │           ─── Risk score        ─▶ src/lib/token-risk.ts
   │           ─── Veteran playbook  ─▶ src/lib/recommendation.ts
   ▼
[Veteran's Take + Metric Strip + Signals + Honeypot + Holders + Price Activity]
   │
   │  (auto-explain + Q&A)
   ▼
[/api/chat]  ─── streaming via Vercel AI SDK
                 (Groq Llama 3.3 70B by default; OpenAI fallback;
                  deterministic playbook explanation if no key)
   ▼
[Streaming chat panel — veteran's voice]
```

**A single Jupiter call gives us almost all the data.** Average analysis latency: **<1.5 seconds**. No API keys required for the analysis itself — Jupiter's keyless tier (0.5 RPS at api.jup.ag, with auto-fallback to lite-api.jup.ag) is plenty.

### File layout

```
src/
├── app/
│   ├── page.tsx                  # Landing: paste box + 3 demo cards
│   ├── report/page.tsx           # Trader dashboard with verdict + playbook
│   └── api/
│       ├── token/route.ts        # Full analyze pipeline
│       ├── chat/route.ts         # Streaming LLM with offline fallback
│       └── demo-tokens/route.ts  # Serves the 3 demo tokens
├── lib/
│   ├── jupiter.ts                # Tokens V2 + honeypot test (the main API)
│   ├── token.ts                  # On-chain RPC fallback for unlisted tokens
│   ├── token-risk.ts             # Rule engine for rug detection
│   ├── token-analyze.ts          # End-to-end pipeline
│   ├── recommendation.ts         # Veteran trader's playbook generator
│   ├── demo.ts                   # 3 demo tokens (real mainnet mints)
│   ├── simulate.ts               # RPC URL config
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
# Without this, Shrewd Guard streams a deterministic structured explanation.
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

1. **Open the home page.** Three demo buttons.
2. **Click 🔴 Fresh pump.fun token.** *Veteran's Take* card appears: **SKIP — Hard pass — flagged by Jupiter, dev is a serial launcher.* Three concrete reasons. The "what most traders miss" insight: *"go check 3 of their prior tokens on Solscan."*
3. **Click 🟡 BONK.** *Veteran's Take* flips to **SIZE_SMALL — Tradable — size for the liquidity, not your conviction.* Specific numbers: $9,270–$37,100 position, 10% stop, 1.5x/3x/runner take-profit ladder, kill criteria spelling out exactly when to abandon.
4. **Show the chat panel.** Ask: *"What's the LP/MC ratio mean for me?"* Get a grounded streaming response from the 10-year veteran.
5. **Click 🟢 USDC.** Shrewd Guard correctly flips to **CONSIDER (Hold, don't trade)** — no fake upside playbook. The system understands stablecoins.

That's the demo. The 60 seconds judges remember.

---

## Why this wins Dev3pack

- **Real, current problem.** Solana memecoin rugs daily. Visceral.
- **Validated category, sharper wedge.** Jupiter's audit pipeline already produces this data. RugCheck and Birdeye already show it to you. We're the only one that gives you a **sized playbook** like a pro would.
- **Solana-native.** Pulls from Jupiter (used by Phantom, Solflare, every Solana wallet) — perfect ecosystem fit.
- **Demo lands instantly.** Paste → 1.5s analysis → veteran's playbook with concrete numbers. No setup, no install, no wallet connection.
- **AI used properly.** LLM for *explanation*, not classification. Rule-based deterministic engine produces verifiable numbers; LLM presents them in a trader's voice.

### Tracks

- **Category:** Infrastructure / Dev Tools (primary)
- **Category:** AI / ML (secondary)
- **Solana** main track
- **Jupiter** sponsor angle (Tokens V2 + Swap quote API as the data backbone)

---

## What's *not* in the MVP

By design, to ship in time:

- No real-time alerts (you scan, you decide; not a watchlist)
- No browser extension yet (web app only)
- No Twitter/social-graph dev-history beyond Jupiter's `devMints` count
- The "danger" demo mint will eventually die as that pump.fun token gets abandoned — judges can paste any current pump.fun mint to replace it (one-line edit in `src/lib/demo.ts`)

---

## Credits

Built for **Dev3pack Global Hackathon 2026**.
Stack: Next.js 16, TypeScript, Tailwind v4, Solana web3.js, Vercel AI SDK, Groq, Jupiter Tokens V2 API.
