"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  Loader2,
  ArrowLeft,
  Send,
  Sparkles,
  TrendingUp,
  TrendingDown,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/Button";
import { cn, shortAddr } from "@/lib/utils";

const SESSION_KEY = "shrewd-guard:pending-mint";

/**
 * Paced-reveal config for the assistant bubble.
 *
 * The LLM streams tokens much faster than is comfortable to read, so the UI
 * dumps walls of text. We let the network keep filling `content` at full
 * speed, but only render the first `displayed` characters of it, advancing
 * on a metronome. Result: the chat reads like a person typing, without
 * actually slowing the model.
 */
const TYPING_CHARS_PER_TICK = 2;
const TYPING_TICK_MS = 18;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** how many chars of `content` are currently shown to the user */
  displayed?: number;
  /** true while the network is still feeding tokens into `content` */
  pending?: boolean;
}

interface TokenStats {
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
}

interface TradePlan {
  positionSize?: { min: number; max: number; rationale: string };
  stopLossPct?: number;
  takeProfitLadder?: Array<{ at: string; sell: string }>;
  watchFor?: string[];
  killCriteria?: string[];
}

interface Recommendation {
  action: "consider" | "size_small" | "watch" | "wait" | "skip";
  headline: string;
  thesis: string[];
  edge?: string;
  plan?: TradePlan;
  disclaimer: string;
}

interface TokenAnalysis {
  input: string;
  jupiterKnown: boolean;
  recommendation: Recommendation;
  token: {
    mint: string;
    name?: string;
    symbol?: string;
    icon?: string;
    decimals: number;
    supply: number;
    mintAuthorityRevoked: boolean;
    mintAuthority?: string;
    freezeAuthorityRevoked: boolean;
    freezeAuthority?: string;
    isToken2022: boolean;
    ageHours?: number;
    ageSource?: "jupiter" | "rpc";
    mcap?: number;
    liquidityUsd?: number;
    priceUsd?: number;
    holderCount?: number;
    top10Pct?: number;
    dev?: string;
    devBalancePct?: number;
    devMints?: number;
    organicScore?: number;
    organicScoreLabel?: "high" | "medium" | "low";
    isVerified?: boolean;
    isSus?: boolean;
    tags?: string[];
    twitter?: string;
    website?: string;
    launchpad?: string;
    firstPool?: { id: string; createdAt?: string };
    stats5m?: TokenStats;
    stats1h?: TokenStats;
    stats6h?: TokenStats;
    stats24h?: TokenStats;
  };
  honeypot: {
    priceUsd?: number;
    canBuy: boolean;
    canSell: boolean;
    isHoneypot: boolean;
    smallBuyImpactPct?: number;
    largeBuyImpactPct?: number;
    routesCount?: number;
    errors: string[];
  };
  risk: {
    verdict: "safe" | "caution" | "danger";
    score: number;
    headline: string;
    flags: Array<{ severity: "info" | "warn" | "danger" | "good"; code: string; title: string; detail: string }>;
    goodSignals: Array<{ severity: string; code: string; title: string; detail: string }>;
    badSignals: Array<{ severity: string; code: string; title: string; detail: string }>;
  };
  durationMs: number;
}

export default function ReportPage() {
  const router = useRouter();
  const [mint, setMint] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TokenAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const explanationRequested = useRef(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) {
      router.replace("/");
      return;
    }
    setMint(stored);
    void runAnalysis(stored);
  }, [router]);

  // Paced reveal — at every tick, advance `displayed` toward `content.length`
  // for any assistant message that's behind. Only runs when there's catch-up
  // to do; idle once everything is fully shown.
  useEffect(() => {
    const anyBehind = chat.some(
      (m) => m.role === "assistant" && (m.displayed ?? 0) < m.content.length
    );
    if (!anyBehind) return;

    const id = window.setInterval(() => {
      setChat((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.role !== "assistant") return m;
          const have = m.displayed ?? 0;
          if (have >= m.content.length) return m;
          changed = true;
          return {
            ...m,
            displayed: Math.min(m.content.length, have + TYPING_CHARS_PER_TICK),
          };
        });
        return changed ? next : prev;
      });
    }, TYPING_TICK_MS);

    return () => window.clearInterval(id);
  }, [chat]);

  async function runAnalysis(value: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Token analysis failed");
      setAnalysis(data as TokenAnalysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (analysis && !explanationRequested.current) {
      explanationRequested.current = true;
      void streamExplanation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  async function streamExplanation() {
    if (!mint) return;
    setStreaming(true);
    setChat((c) => [
      ...c,
      { role: "assistant", content: "", displayed: 0, pending: true },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint, messages: [] }),
      });
      if (!res.ok || !res.body) throw new Error("Chat stream failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setChat((c) => {
          const next = [...c];
          const last = next[next.length - 1];
          next[next.length - 1] = {
            ...last,
            role: "assistant",
            content: acc,
            displayed: last.displayed ?? 0,
            pending: true,
          };
          return next;
        });
      }
    } catch (e) {
      setChat((c) => {
        const next = [...c];
        next[next.length - 1] = {
          role: "assistant",
          content: e instanceof Error ? e.message : "Streaming failed",
          displayed: 0,
          pending: false,
        };
        return next;
      });
    } finally {
      // Stream complete — clear the pending flag. The typewriter effect
      // keeps revealing whatever is still buffered ahead of `displayed`.
      setChat((c) => {
        const next = [...c];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { ...last, pending: false };
        }
        return next;
      });
      setStreaming(false);
    }
  }

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!mint || !chatInput.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim() };
    const history = [...chat, userMsg];
    // Snap any prior assistant messages to fully-revealed before starting
    // a new one, so the new bubble's typing animation isn't confused with
    // an old one still catching up.
    setChat([
      ...history.map((m) =>
        m.role === "assistant" ? { ...m, displayed: m.content.length } : m
      ),
      { role: "assistant", content: "", displayed: 0, pending: true },
    ]);
    setChatInput("");
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint, messages: history.filter((m) => m.content) }),
      });
      if (!res.ok || !res.body) throw new Error("Chat stream failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setChat((c) => {
          const next = [...c];
          const last = next[next.length - 1];
          next[next.length - 1] = {
            ...last,
            role: "assistant",
            content: acc,
            displayed: last.displayed ?? 0,
            pending: true,
          };
          return next;
        });
      }
    } catch (err) {
      setChat((c) => {
        const next = [...c];
        next[next.length - 1] = {
          role: "assistant",
          content: err instanceof Error ? err.message : "Chat failed",
          displayed: 0,
          pending: false,
        };
        return next;
      });
    } finally {
      setChat((c) => {
        const next = [...c];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { ...last, pending: false };
        }
        return next;
      });
      setStreaming(false);
    }
  }

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--fg-muted)]">
          <Loader2 size={18} className="animate-spin" />
          <span>Pulling on-chain data, holders, liquidity, honeypot test…</span>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-lg rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-6">
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-[var(--danger)]" size={20} />
            <h2 className="font-semibold">Couldn&rsquo;t analyze that token</h2>
          </div>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--fg-muted)]">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => router.push("/")}>
            <ArrowLeft size={14} /> Back
          </Button>
        </div>
      </main>
    );
  }

  if (!analysis) return null;

  return (
    <main className="flex-1 px-4 pb-20 pt-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <button
          onClick={() => router.push("/")}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
        >
          <ArrowLeft size={14} /> Scan another token
        </button>

        <TraderHeader analysis={analysis} />

        {!analysis.jupiterKnown && (
          <div className="mt-4 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/5 px-4 py-3 text-sm text-[var(--fg-muted)]">
            <strong className="text-[var(--warn)]">Jupiter doesn&rsquo;t know this token.</strong> Usually a sign it&rsquo;s
            extremely new, unlisted, or has never had real DEX liquidity. We&rsquo;re working from on-chain data only.
          </div>
        )}

        {/* Big metric strip */}
        <MetricStrip analysis={analysis} />

        {/* Shrewd Guard's take — prominent recommendation card */}
        <RecommendationCard analysis={analysis} />

        {/* Two-column: data on the left, chat on the right */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <PriceActivityCard analysis={analysis} />
            <SignalsCard analysis={analysis} />
            <AuthoritiesCard analysis={analysis} />
            <LiquidityCard analysis={analysis} />
            {(analysis.token.holderCount !== undefined || analysis.token.top10Pct !== undefined) && (
              <DevAndHoldersCard analysis={analysis} />
            )}
          </div>

          <aside className="lg:sticky lg:top-4 lg:self-start">
            <ChatPanel
              chat={chat}
              input={chatInput}
              setInput={setChatInput}
              onSend={sendMessage}
              streaming={streaming}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

// ---------- Trader header (logo + name + quick-action buttons) ----------

function TraderHeader({ analysis }: { analysis: TokenAnalysis }) {
  const t = analysis.token;
  const symbol = t.symbol ?? "Unknown";
  const name = t.name ?? "Unknown token";

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {t.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.icon}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full border border-[var(--border)] bg-black/40 object-cover"
          />
        ) : (
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-black/40 text-lg font-semibold">
            {symbol.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{name}</h1>
            <span className="rounded-md bg-[var(--bg-elev-2)] px-1.5 py-0.5 text-xs">{symbol}</span>
            {t.isVerified && (
              <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--accent)]">
                ✓ Verified
              </span>
            )}
            {t.isSus && (
              <span className="rounded-full bg-[var(--danger)]/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--danger)]">
                Flagged sus
              </span>
            )}
            {t.launchpad && (
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wider">
                {t.launchpad}
              </span>
            )}
          </div>
          <div className="mt-1 mono truncate text-xs text-[var(--fg-muted)]" title={t.mint}>
            {t.mint}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <a
          className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1.5 transition-colors hover:bg-[var(--bg-elev-2)]"
          href={`https://jup.ag/swap/SOL-${t.mint}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Trade on Jupiter ↗
        </a>
        <a
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
          href={`https://dexscreener.com/solana/${t.mint}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          DexScreener ↗
        </a>
        <a
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
          href={`https://birdeye.so/token/${t.mint}?chain=solana`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Birdeye ↗
        </a>
        <a
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
          href={`https://solscan.io/token/${t.mint}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Solscan ↗
        </a>
        {t.twitter && (
          <a
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
            href={t.twitter}
            target="_blank"
            rel="noreferrer noopener"
          >
            Twitter ↗
          </a>
        )}
        {t.website && (
          <a
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
            href={t.website}
            target="_blank"
            rel="noreferrer noopener"
          >
            Site ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ---------- Big metric strip ----------

function MetricStrip({ analysis }: { analysis: TokenAnalysis }) {
  const t = analysis.token;
  const change24 = t.stats24h?.priceChange;
  const tile: Array<{ label: string; value: string; subtext?: string; tone?: "good" | "warn" | "danger" }> = [];

  if (t.priceUsd !== undefined) {
    tile.push({
      label: "Price",
      value: `$${formatPrice(t.priceUsd)}`,
      subtext: change24 !== undefined ? `24h ${formatPct(change24)}` : undefined,
      tone: change24 === undefined ? undefined : change24 >= 0 ? "good" : "danger",
    });
  }

  if (t.mcap !== undefined) {
    tile.push({ label: "Market cap", value: `$${formatBigUsd(t.mcap)}` });
  }

  if (t.liquidityUsd !== undefined) {
    const lpChange = t.stats24h?.liquidityChange;
    tile.push({
      label: "Liquidity",
      value: `$${formatBigUsd(t.liquidityUsd)}`,
      subtext: lpChange !== undefined ? `24h ${formatPct(lpChange)}` : undefined,
      tone: lpChange === undefined ? undefined : lpChange < -10 ? "danger" : lpChange < 0 ? "warn" : "good",
    });
  }

  if (t.holderCount !== undefined) {
    const hChange = t.stats24h?.holderChange;
    tile.push({
      label: "Holders",
      value: t.holderCount.toLocaleString(),
      subtext: hChange !== undefined ? `24h ${formatPct(hChange)}` : undefined,
      tone: hChange === undefined ? undefined : hChange < -5 ? "warn" : hChange > 5 ? "good" : undefined,
    });
  }

  if (t.ageHours !== undefined) {
    tile.push({ label: "Age", value: humanAge(t.ageHours) });
  }

  if (t.organicScore !== undefined) {
    tile.push({
      label: "Organic score",
      value: `${t.organicScore.toFixed(0)}/100`,
      subtext: t.organicScoreLabel,
      tone: t.organicScore < 20 ? "warn" : t.organicScore >= 60 ? "good" : undefined,
    });
  }

  if (tile.length === 0) return null;

  return (
    <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tile.map((m) => (
        <div
          key={m.label}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] p-3"
        >
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">{m.label}</div>
          <div
            className={cn(
              "mt-1 truncate text-base font-semibold",
              m.tone === "danger" && "text-[var(--danger)]",
              m.tone === "warn" && "text-[var(--warn)]",
              m.tone === "good" && "text-[var(--accent)]"
            )}
          >
            {m.value}
          </div>
          {m.subtext && <div className="mt-0.5 truncate text-[11px] text-[var(--fg-muted)]">{m.subtext}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------- Veteran trader's playbook ----------
// Compact, terminal-style. No hero band, no decorative emoji, no glow.
// Density first; numbers do the talking.

function RecommendationCard({ analysis }: { analysis: TokenAnalysis }) {
  const rec = analysis.recommendation;
  const v = analysis.risk.verdict;
  const score = analysis.risk.score;

  const tone = {
    safe: {
      ring: "border-[var(--accent)]/50",
      chipBg: "bg-[var(--accent)] text-black",
      barFill: "bg-[var(--accent)]",
      barLabel: "text-[var(--accent)]",
    },
    caution: {
      ring: "border-[var(--warn)]/50",
      chipBg: "bg-[var(--warn)] text-black",
      barFill: "bg-[var(--warn)]",
      barLabel: "text-[var(--warn)]",
    },
    danger: {
      ring: "border-[var(--danger)]/60",
      chipBg: "bg-[var(--danger)] text-white",
      barFill: "bg-[var(--danger)]",
      barLabel: "text-[var(--danger)]",
    },
  }[v];

  const actionLabel = {
    consider: "Consider",
    size_small: "Size small",
    watch: "Watch",
    wait: "Wait",
    skip: "Skip",
  }[rec.action];

  return (
    <div
      className={cn(
        "mt-6 overflow-hidden rounded-xl border bg-[var(--bg-elev)] rise-in",
        tone.ring
      )}
    >
      {/* Compact terminal-style header */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "mono inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              tone.chipBg
            )}
          >
            {actionLabel}
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--fg-faint)]">
            Veteran&rsquo;s take
          </span>
        </div>
        <div className="mono flex items-center gap-2 text-[11px] text-[var(--fg-muted)]">
          <span>RISK</span>
          <span className={cn("font-bold", tone.barLabel)}>
            {String(score).padStart(2, "0")}
            <span className="text-[var(--fg-faint)]">/100</span>
          </span>
        </div>
      </div>

      {/* Headline + thin score bar */}
      <div className="px-4 pb-3 pt-3">
        <h2 className="text-base font-semibold leading-snug sm:text-lg">{rec.headline}</h2>
        <div className="relative mt-2 h-[3px] overflow-hidden rounded-full bg-black/40">
          <div
            className={cn("absolute inset-y-0 left-0 right-0 confidence-fill", tone.barFill)}
            style={{ ["--score" as string]: Math.max(0, Math.min(1, (100 - score) / 100)) }}
          />
        </div>
      </div>

      {/* Thesis — terse numbered list, no big card around each item */}
      {rec.thesis.length > 0 && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <SectionLabel>Read</SectionLabel>
          <ol className="mt-1.5 space-y-1 text-[13px] leading-snug">
            {rec.thesis.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className={cn("mono shrink-0 text-[11px] font-semibold", tone.barLabel)}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Edge — single line callout, no gradient */}
      {rec.edge && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <SectionLabel className="text-[var(--info)]">Edge</SectionLabel>
          <p className="mt-1.5 text-[13px] leading-snug">{rec.edge}</p>
        </div>
      )}

      {rec.plan && <PlaybookCard plan={rec.plan} tone={tone} />}

      <div className="border-t border-[var(--border)] px-4 py-2.5 text-[10px] italic text-[var(--fg-faint)]">
        {rec.disclaimer}
      </div>
    </div>
  );
}

// Small uppercase header — tighter than before
function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fg-muted)]",
        className
      )}
    >
      {children}
    </h3>
  );
}

// ---------- Trade ticket ----------
// Inlined inside the recommendation card. Terminal density, no hero band.

interface ToneStyles {
  barFill: string;
  barLabel: string;
}

function PlaybookCard({ plan, tone }: { plan: TradePlan; tone: ToneStyles }) {
  return (
    <div className="border-t border-[var(--border)]">
      {/* Section header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-1.5">
        <SectionLabel>The play</SectionLabel>
        <span className="mono text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">
          entry · stop · targets
        </span>
      </div>

      {/* Two big numbers, divided cleanly */}
      <div className="grid divide-y divide-[var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {plan.positionSize && (
          <div className="px-4 py-3">
            <SectionLabel>Size</SectionLabel>
            <div className="mono mt-1 text-lg font-semibold leading-tight">
              ${formatBigUsd(plan.positionSize.min)}
              <span className="text-[var(--fg-faint)]">–</span>$
              {formatBigUsd(plan.positionSize.max)}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-[var(--fg-muted)]">
              {plan.positionSize.rationale}
            </div>
          </div>
        )}

        {plan.stopLossPct !== undefined && (
          <div className="px-4 py-3">
            <SectionLabel>Stop</SectionLabel>
            <div className="mono mt-1 flex items-baseline gap-1.5 text-lg font-semibold leading-tight text-[var(--danger)]">
              −{plan.stopLossPct}%
              <span className="text-[10px] font-normal uppercase tracking-wider text-[var(--fg-muted)]">
                from entry
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-snug text-[var(--fg-muted)]">
              Set before you click buy. Don&rsquo;t move it down.
            </div>
          </div>
        )}
      </div>

      {/* Take-profit ladder — compact rows, no badges */}
      {plan.takeProfitLadder && plan.takeProfitLadder.length > 0 && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <SectionLabel>Targets</SectionLabel>
          <div className="mono mt-1.5 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-black/20">
            {plan.takeProfitLadder.map((tp, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-1.5 text-[12px]"
              >
                <span className="text-[var(--fg-faint)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={cn("font-semibold", tone.barLabel)}>{tp.at}</span>
                <span className="ml-auto text-[11px] text-[var(--fg-muted)]">
                  {tp.sell}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Watch / Kill — collapsed by default, no decorative emoji */}
      <div className="grid divide-y divide-[var(--border)] border-t border-[var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {plan.watchFor && plan.watchFor.length > 0 && (
          <details className="group px-4 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fg-muted)] hover:text-[var(--fg)]">
              <span>Watch</span>
              <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 space-y-1 text-[12px] leading-snug text-[var(--fg-muted)]">
              {plan.watchFor.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {plan.killCriteria && plan.killCriteria.length > 0 && (
          <details className="group px-4 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--danger)] hover:opacity-80">
              <span>Kill if</span>
              <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 space-y-1 text-[12px] leading-snug text-[var(--fg-muted)]">
              {plan.killCriteria.map((k, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--danger)]" />
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

// ---------- Price activity (multi-window) ----------

function PriceActivityCard({ analysis }: { analysis: TokenAnalysis }) {
  const t = analysis.token;
  const windows: Array<["5m" | "1h" | "6h" | "24h", TokenStats | undefined]> = [
    ["5m", t.stats5m],
    ["1h", t.stats1h],
    ["6h", t.stats6h],
    ["24h", t.stats24h],
  ];
  const haveAny = windows.some(([, s]) => s);
  if (!haveAny) return null;

  return (
    <Card title="Price action & flow">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {windows.map(([w, s]) => (
          <WindowTile key={w} label={w} stats={s} />
        ))}
      </div>

      {t.firstPool?.createdAt && (
        <div className="mt-3 rounded-md border border-[var(--border)] bg-black/20 px-3 py-2 text-xs text-[var(--fg-muted)]">
          First DEX pool created{" "}
          <span className="text-[var(--fg)]">
            {new Date(t.firstPool.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
          {analysis.token.firstPool?.id && (
            <>
              {" · "}
              <a
                href={`https://solscan.io/account/${analysis.token.firstPool.id}`}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-[var(--fg)]"
              >
                pool {shortAddr(analysis.token.firstPool.id, 5)} ↗
              </a>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function WindowTile({ label, stats }: { label: string; stats?: TokenStats }) {
  if (!stats) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] p-3 text-xs text-[var(--fg-faint)]">
        <div className="text-[10px] uppercase tracking-wider">{label}</div>
        <div className="mt-1">—</div>
      </div>
    );
  }
  const pc = stats.priceChange;
  const vol = (stats.buyVolume ?? 0) + (stats.sellVolume ?? 0);
  const buys = stats.numBuys ?? 0;
  const sells = stats.numSells ?? 0;
  const total = buys + sells;
  const sellPct = total > 0 ? (sells / total) * 100 : undefined;
  const buyPct = total > 0 ? (buys / total) * 100 : undefined;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">{label}</span>
        {pc !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              pc >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"
            )}
          >
            {pc >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {formatPct(pc)}
          </span>
        )}
      </div>

      <div className="mt-2 text-sm">
        {vol > 0 ? (
          <>
            <span className="font-semibold">${formatBigUsd(vol)}</span>{" "}
            <span className="text-[var(--fg-muted)]">vol</span>
          </>
        ) : (
          <span className="text-[var(--fg-faint)]">no vol</span>
        )}
      </div>

      {total > 0 && (
        <div className="mt-2">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--bg-elev)]">
            <div
              className="bg-[var(--accent)]"
              style={{ width: `${buyPct}%` }}
              title={`${buys} buys`}
            />
            <div
              className="bg-[var(--danger)]"
              style={{ width: `${sellPct}%` }}
              title={`${sells} sells`}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-[var(--fg-muted)]">
            <span>{buys} buys</span>
            <span>{sells} sells</span>
          </div>
        </div>
      )}

      {stats.numTraders !== undefined && (
        <div className="mt-1 text-[10px] text-[var(--fg-faint)]">
          {stats.numTraders} traders
        </div>
      )}
    </div>
  );
}

// ---------- Signals split ----------

function SignalsCard({ analysis }: { analysis: TokenAnalysis }) {
  const good = analysis.risk.goodSignals;
  const bad = analysis.risk.badSignals;
  return (
    <Card title="Signals">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs uppercase tracking-wider text-[var(--accent)]">
            ✓ Working in your favor ({good.length})
          </h4>
          {good.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">None detected.</p>
          ) : (
            <ul className="space-y-2">
              {good.map((f, i) => (
                <li
                  key={i}
                  className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{f.title}</span>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-muted)]">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-xs uppercase tracking-wider text-[var(--danger)]">
            ✕ Worth worrying about ({bad.length})
          </h4>
          {bad.length === 0 ? (
            <p className="text-sm text-[var(--fg-muted)]">No risks flagged.</p>
          ) : (
            <ul className="space-y-2">
              {bad.map((f, i) => {
                const tone =
                  f.severity === "danger"
                    ? "border-[var(--danger)]/40 bg-[var(--danger)]/5"
                    : "border-[var(--warn)]/40 bg-[var(--warn)]/5";
                return (
                  <li key={i} className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
                    <span className="font-medium">{f.title}</span>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-muted)]">{f.detail}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- Authorities ----------

function AuthoritiesCard({ analysis }: { analysis: TokenAnalysis }) {
  const t = analysis.token;
  return (
    <Card title="Mint authorities & supply">
      <ul className="divide-y divide-[var(--border)] text-sm">
        <Row
          left="Mint authority"
          right={t.mintAuthorityRevoked ? "REVOKED ✓" : `Active — ${shortAddr(t.mintAuthority ?? "?")}`}
          tone={t.mintAuthorityRevoked ? "good" : "danger"}
        />
        <Row
          left="Freeze authority"
          right={t.freezeAuthorityRevoked ? "REVOKED ✓" : `Active — ${shortAddr(t.freezeAuthority ?? "?")}`}
          tone={t.freezeAuthorityRevoked ? "good" : "danger"}
        />
        <Row
          left="Total supply"
          right={t.supply.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        />
        <Row left="Decimals" right={String(t.decimals)} />
        <Row left="Token program" right={t.isToken2022 ? "Token-2022" : "SPL Token"} />
      </ul>
    </Card>
  );
}

// ---------- Liquidity ----------

function LiquidityCard({ analysis }: { analysis: TokenAnalysis }) {
  const h = analysis.honeypot;
  return (
    <Card title="Liquidity & honeypot test (live via Jupiter)">
      <ul className="divide-y divide-[var(--border)] text-sm">
        <Row left="Buyable" right={h.canBuy ? "yes" : "no"} tone={h.canBuy ? "good" : "danger"} />
        <Row left="Sellable" right={h.canSell ? "yes" : "no"} tone={h.canSell ? "good" : "danger"} />
        {h.isHoneypot && (
          <Row left="Honeypot detected" right="⚠️ buy works, sell fails" tone="danger" />
        )}
        {h.smallBuyImpactPct !== undefined && (
          <Row
            left="$10 buy impact"
            right={`${h.smallBuyImpactPct.toFixed(2)}%`}
            tone={h.smallBuyImpactPct > 5 ? "warn" : undefined}
          />
        )}
        {h.largeBuyImpactPct !== undefined && (
          <Row
            left="$1,000 buy impact"
            right={`${h.largeBuyImpactPct.toFixed(2)}%`}
            tone={h.largeBuyImpactPct > 20 ? "warn" : undefined}
          />
        )}
        {h.routesCount !== undefined && (
          <Row left="DEX routes available" right={String(h.routesCount)} />
        )}
      </ul>
      {h.errors.length > 0 && (
        <div className="mt-3 rounded-md bg-[var(--bg-elev-2)] p-3 text-xs text-[var(--fg-muted)]">
          {h.errors.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- Dev + Holders ----------

function DevAndHoldersCard({ analysis }: { analysis: TokenAnalysis }) {
  const t = analysis.token;
  return (
    <Card title="Dev & holders">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {t.holderCount !== undefined && (
          <Stat label="Total holders" value={t.holderCount.toLocaleString()} />
        )}
        {t.top10Pct !== undefined && (
          <Stat
            label="Top 10 hold"
            value={`${t.top10Pct.toFixed(1)}%`}
            tone={t.top10Pct > 80 ? "danger" : t.top10Pct > 50 ? "warn" : undefined}
          />
        )}
        {t.devBalancePct !== undefined && (
          <Stat
            label="Dev holds"
            value={`${t.devBalancePct.toFixed(1)}%`}
            tone={t.devBalancePct > 20 ? "warn" : undefined}
          />
        )}
        {t.devMints !== undefined && t.devMints > 0 && (
          <Stat
            label="Dev's prior tokens"
            value={String(t.devMints)}
            tone={t.devMints > 5 ? "warn" : undefined}
          />
        )}
      </div>
      {t.dev && (
        <p className="mt-3 text-xs text-[var(--fg-muted)]">
          Dev wallet:{" "}
          <a
            href={`https://solscan.io/account/${t.dev}`}
            target="_blank"
            rel="noreferrer noopener"
            className="mono hover:text-[var(--fg)]"
          >
            {shortAddr(t.dev, 6)} ↗
          </a>
        </p>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  subtext,
  tone,
}: {
  label: string;
  value: string;
  subtext?: string;
  tone?: "good" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-[var(--danger)]"
      : tone === "warn"
      ? "text-[var(--warn)]"
      : tone === "good"
      ? "text-[var(--accent)]"
      : "text-[var(--fg)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] p-3">
      <div className="text-xs text-[var(--fg-muted)]">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
      {subtext && <div className="mt-0.5 text-[11px] text-[var(--fg-faint)]">{subtext}</div>}
    </div>
  );
}

function Row({
  left,
  right,
  tone,
}: {
  left: string;
  right: string;
  tone?: "good" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-[var(--danger)]"
      : tone === "warn"
      ? "text-[var(--warn)]"
      : tone === "good"
      ? "text-[var(--accent)]"
      : "text-[var(--fg)]";
  return (
    <li className="flex items-center justify-between py-2.5">
      <span className="text-[var(--fg-muted)]">{left}</span>
      <span className={cn("mono font-medium text-sm", toneClass)}>{right}</span>
    </li>
  );
}

// ---------- Chat ----------

function ChatPanel({
  chat,
  input,
  setInput,
  onSend,
  streaming,
}: {
  chat: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  onSend: (e?: React.FormEvent) => void;
  streaming: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat]);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elev)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <Sparkles size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-medium">Ask Shrewd Guard</span>
        </div>
        <div ref={scrollRef} className="h-[420px] space-y-3 overflow-auto p-4">
          {chat.length === 0 && !streaming && (
            <div className="text-sm text-[var(--fg-muted)]">Generating an explanation…</div>
          )}
          {chat.map((m, i) => (
            <ChatBubble key={i} message={m} />
          ))}
        </div>
        <form onSubmit={onSend} className="flex items-center gap-2 border-t border-[var(--border)] p-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What's the volume vs market cap ratio?"
            disabled={streaming}
            className="flex-1 rounded-md bg-transparent px-3 py-2 text-sm outline-none placeholder-[var(--fg-faint)]"
          />
          <Button type="submit" size="sm" disabled={streaming || !input.trim()}>
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </Button>
        </form>
      </div>

      <div className="grid gap-1.5 px-1 text-xs text-[var(--fg-muted)]">
        <SuggestedQuestion onPick={setInput} q="Is this a rug pull?" />
        <SuggestedQuestion onPick={setInput} q="Is the volume real or bot-driven?" />
        <SuggestedQuestion onPick={setInput} q="If I buy 0.5 SOL, can I exit cleanly?" />
      </div>
    </div>
  );
}

function SuggestedQuestion({ q, onPick }: { q: string; onPick: (v: string) => void }) {
  return (
    <button
      onClick={() => onPick(q)}
      className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 text-left text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
    >
      {q}
    </button>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const fullLen = message.content.length;
  const shown = isUser ? fullLen : Math.min(message.displayed ?? 0, fullLen);
  const visible = isUser ? message.content : message.content.slice(0, shown);
  // No characters yet AND the network is still working → "thinking" state.
  const isThinking =
    !isUser && shown === 0 && (message.pending || fullLen === 0);
  // Either the typewriter is still catching up to `content`, or the
  // network is still streaming — either way, show the caret.
  const isTyping = !isUser && (shown < fullLen || message.pending);

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser ? "bg-[var(--bg-elev-2)] text-[var(--fg)]" : "bg-black/40 text-[var(--fg)]"
        )}
      >
        {isThinking ? (
          <span
            className="inline-flex items-center gap-1.5 py-1"
            aria-label="Shrewd Guard is thinking"
          >
            <ThinkingDot delay={0} />
            <ThinkingDot delay={180} />
            <ThinkingDot delay={360} />
          </span>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans">
            {visible}
            {isTyping && (
              <span
                aria-hidden
                className="ml-px inline-block h-[1em] w-[0.5ch] -mb-[0.12em] animate-pulse rounded-[1px] bg-[var(--accent)] align-[-0.12em]"
              />
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

function ThinkingDot({ delay }: { delay: number }) {
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 rounded-full bg-[var(--fg-muted)] animate-bounce"
      style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
    />
  );
}

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elev)]">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ---------- Format helpers ----------

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

function formatPct(n: number): string {
  if (n === 0) return "0%";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function humanAge(hours: number): string {
  if (hours < 1) return `<1h`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  if (hours < 24 * 30) return `${(hours / 24).toFixed(1)}d`;
  if (hours < 24 * 365) return `${(hours / 24 / 30).toFixed(1)}mo`;
  return `${(hours / 24 / 365).toFixed(1)}y`;
}
