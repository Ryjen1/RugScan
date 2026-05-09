"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ShieldCheck, ArrowRight, Loader2 } from "lucide-react";
import type { DemoToken } from "@/lib/demo";

const SESSION_KEY = "rugscan:pending-mint";

export default function HomePage() {
  const router = useRouter();
  const [mint, setMint] = useState("");
  const [demos, setDemos] = useState<DemoToken[] | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/demo-tokens")
      .then((r) => r.json())
      .then((d: DemoToken[]) => setDemos(d))
      .catch(() => setDemos([]));
  }, []);

  function gotoReport(value: string, source: string) {
    if (!value.trim()) {
      setError("Paste a Solana token address (the mint).");
      return;
    }
    setError(null);
    setSubmitting(source);
    try {
      sessionStorage.setItem(SESSION_KEY, value.trim());
      router.push("/report");
    } catch {
      setError("Couldn't store the token address in this browser session.");
      setSubmitting(null);
    }
  }

  return (
    <main className="flex flex-1 flex-col">
      {/* Header */}
      <header className="border-b border-[var(--border)]/60 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--accent)]/15 text-[var(--accent)]">
              <ShieldCheck size={18} />
            </div>
            <span className="font-semibold tracking-tight">RugScan</span>
            <span className="ml-2 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
              Solana
            </span>
          </div>
          <span className="text-sm text-[var(--fg-muted)]">Built for Dev3pack 2026</span>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1 text-xs text-[var(--fg-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)] pulse-glow" />
            <span>1 in 4 new Solana tokens are rug-pulls</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight text-balance">
            Read the contract before you ape.
          </h1>
          <p className="mt-5 text-lg text-[var(--fg-muted)] text-balance">
            Paste a Solana token. In ~1 second you get authorities, holder distribution,
            liquidity flow, dev&rsquo;s history, live buy/sell ratio, honeypot test, and price action
            across 5m / 1h / 6h / 24h &mdash; everything you need to decide.
          </p>
        </div>

        {/* Paste box */}
        <div className="mx-auto mt-10 max-w-3xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              gotoReport(mint, "paste");
            }}
            className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elev)] shadow-2xl shadow-black/40"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
                <span className="mono">🔎 paste a Solana token mint address</span>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">
                Read-only · no wallet needed
              </span>
            </div>
            <input
              value={mint}
              onChange={(e) => setMint(e.target.value)}
              placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
              spellCheck={false}
              autoComplete="off"
              className="mono block w-full bg-transparent p-4 text-sm leading-relaxed text-[var(--fg)] placeholder-[var(--fg-faint)] outline-none"
            />
            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
              <span className="text-xs text-[var(--fg-muted)]">
                {mint.length > 0 ? `${mint.length} chars` : "or pick a demo below"}
              </span>
              <Button type="submit" disabled={!mint.trim() || submitting !== null}>
                {submitting === "paste" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Scanning
                  </>
                ) : (
                  <>
                    Scan token <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </div>
          </form>
          {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
        </div>

        {/* Demo buttons */}
        <div className="mx-auto mt-10 max-w-3xl">
          <p className="mb-3 text-center text-xs uppercase tracking-wider text-[var(--fg-faint)]">
            Try a real token
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {demos === null && (
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-44 animate-pulse rounded-xl bg-[var(--bg-elev)]" />
                ))}
              </>
            )}
            {demos?.map((d) => (
              <DemoCard
                key={d.id}
                demo={d}
                onClick={() => gotoReport(d.mint, d.id)}
                loading={submitting === d.id}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-t border-[var(--border)]/60 px-6 py-12">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          <Feature
            icon={<ShieldCheck size={18} />}
            title="On-chain data, decoded"
            body="Mint &amp; freeze authority status, total supply, age, top-10 concentration, dev wallet balance, dev's history of past mints — read straight from chain and Jupiter's audit pipeline."
          />
          <Feature
            icon="📈"
            title="Live trading flow"
            body="Price change, volume, and buy/sell ratio across 5m, 1h, 6h, and 24h. Liquidity & holder change. Spot a pump or a distribution before you click."
          />
          <Feature
            icon="🧪"
            title="Honeypot test"
            body="A live Jupiter buy quote and a reverse sell quote. If you can buy but can't sell back, you're staring at a honeypot — full stop."
          />
        </div>
      </section>

      <footer className="mt-auto border-t border-[var(--border)]/60 px-6 py-6 text-center text-xs text-[var(--fg-faint)]">
        RugScan · Solana token safety, in plain English. Built for Dev3pack Global Hackathon 2026.
      </footer>
    </main>
  );
}

function DemoCard({ demo, onClick, loading }: { demo: DemoToken; onClick: () => void; loading: boolean }) {
  const tone =
    demo.id === "danger"
      ? "border-[var(--danger)]/40 hover:border-[var(--danger)]/70 hover:bg-[var(--danger)]/5"
      : demo.id === "caution"
      ? "border-[var(--warn)]/40 hover:border-[var(--warn)]/70 hover:bg-[var(--warn)]/5"
      : "border-[var(--accent)]/40 hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/5";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`group flex flex-col items-start gap-2 rounded-xl border bg-[var(--bg-elev)] p-4 text-left transition-all disabled:opacity-50 ${tone}`}
    >
      <span className="text-2xl">{demo.emoji}</span>
      <span className="font-medium">{demo.label}</span>
      <span className="text-xs leading-relaxed text-[var(--fg-muted)]">{demo.description}</span>
      <span className="mt-auto inline-flex items-center gap-1 text-xs text-[var(--fg-muted)] group-hover:text-[var(--fg)]">
        {loading ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Scanning…
          </>
        ) : (
          <>
            Scan now <ArrowRight size={12} />
          </>
        )}
      </span>
    </button>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-elev-2)] text-[var(--accent)]">
        {icon}
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm leading-relaxed text-[var(--fg-muted)]">{body}</p>
    </div>
  );
}
