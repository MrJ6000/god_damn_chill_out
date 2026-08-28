"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { mockBlastRadius } from "@/lib/mockData";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

export default function BlastRadiusPage() {
  const [remainingSeconds, setRemainingSeconds] = useState(mockBlastRadius.session_remaining_seconds);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-10">
      <header className="flex items-center justify-between border-b border-fail/40 pb-7">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-fail">AI status · compromised</p>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">AI Compromise Blast Radius</h1>
          <p className="mt-2 text-lg text-muted">Assuming the AI agent is fully compromised.</p>
        </div>
        <div className="rounded-xl border border-fail/40 bg-fail/10 px-5 py-4 text-right">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-fail">Worst-case model</p>
          <p className="mt-2 text-sm text-body">Session key fully stolen</p>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-3 gap-5">
        <StatCard label="Treasury balance" value={`$${formatAmount(mockBlastRadius.treasury_balance_display)}`} detail="After approved payments" />
        <StatCard label="Max per transaction" value={`$${formatAmount(mockBlastRadius.max_per_tx_display)}`} detail="Hard permission limit" />
        <StatCard label="Remaining today" value={`$${formatAmount(mockBlastRadius.remaining_24h_display)}`} detail={`of $${formatAmount(mockBlastRadius.max_per_24h_display)} daily`} tone="review" />
      </section>

      <section className="mt-6 grid grid-cols-[1fr_300px] gap-5">
        <div className="rounded-2xl border border-pass/50 bg-pass/10 px-8 py-9 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-pass">Unauthorized recipient exposure</p>
          <p className="mt-5 text-[112px] font-black leading-none tracking-[-0.07em] text-pass">
            ${formatAmount(mockBlastRadius.unauthorized_recipient_exposure)}
          </p>
          <p className="mt-5 text-base text-muted">Funds cannot leave the verified recipient allowlist.</p>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Authorized recipients</p>
            <p className="mt-3 text-[48px] font-bold leading-none">{mockBlastRadius.authorized_recipient_count}</p>
            <p className="mt-3 text-sm text-muted">Verified vendors only</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Allowed scope</p>
            <p className="mt-3 font-mono text-sm text-body">{mockBlastRadius.allowed_tokens.join(", ")}</p>
            <p className="mt-2 font-mono text-sm text-body">{mockBlastRadius.allowed_actions.join(", ")}</p>
          </div>
        </div>
      </section>

      <section className="mt-6 flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Session expires in</p>
          <p className="mt-2 font-mono text-2xl font-semibold">{formatDuration(remainingSeconds)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Permission source</p>
          <p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-bold ${mockBlastRadius.source === "onchain" ? "border-pass/40 bg-pass/10 text-pass" : "border-review/40 bg-review/10 text-review"}`}>
            ● {mockBlastRadius.source === "onchain" ? "ON-CHAIN" : "CACHED FALLBACK"}
          </p>
        </div>
      </section>
    </main>
  );
}
