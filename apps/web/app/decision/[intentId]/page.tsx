"use client";

import { useParams } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { CheckRow } from "@/components/CheckRow";
import { VerdictBadge } from "@/components/VerdictBadge";
import { findMockDecision, mockIntents, mockVendors } from "@/lib/mockData";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function PolicyDecisionPage() {
  const { intentId } = useParams<{ intentId: string }>();
  const decision = findMockDecision(intentId);
  const intent = mockIntents.find((candidate) => candidate.intent_id === decision.intent_id) ?? mockIntents.at(-1)!;
  const vendor = mockVendors.find((candidate) => candidate.display_name === intent.vendor_name);
  const denied = decision.verdict === "DENY";

  return (
    <main className="mx-auto w-[1120px] px-8 pb-12 pt-6">
      <header className="flex items-center justify-between border-b border-line pb-5">
        <div>
          <p className="font-mono text-sm text-muted">{intent.intent_id} · {intent.invoice_id}</p>
          <h1 className="mt-2 text-[40px] font-bold tracking-[-0.03em]">Policy Decision</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm uppercase tracking-[0.16em] text-muted">Verdict</span>
          <VerdictBadge verdict={decision.verdict} />
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4">
        <div className={`rounded-2xl border p-5 ${denied ? "border-fail/50 bg-fail/10" : "border-line bg-surface"}`}>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Agent proposed</p>
          <div className="mt-3"><AddressChip address={intent.recipient} tone={denied ? "fail" : "default"} /></div>
          <p className="mt-3 text-[28px] font-bold">{formatAmount(intent.amount_display)} USDC</p>
          <p className="mt-1 text-xs text-muted">{intent.reasoning}</p>
        </div>
        <div className="rounded-2xl border border-pass/40 bg-pass/10 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-pass">Verified vendor wallet</p>
          <div className="mt-3"><AddressChip address={vendor?.verified_wallet ?? "Unavailable"} tone="pass" /></div>
          <p className="mt-3 text-[28px] font-bold">{intent.vendor_name}</p>
          <p className="mt-1 text-xs text-muted">Trusted recipient from the vendor registry.</p>
        </div>
      </section>

      {decision.deny_reasons.length > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-fail/50 bg-fail/10 px-5 py-3">
          <span className="text-sm font-semibold text-fail">Payment blocked before execution</span>
          <span className="font-mono text-sm font-bold text-fail">{decision.deny_reasons.join(" · ")}</span>
        </div>
      ) : null}

      <section className="mt-4 grid grid-cols-[1fr_248px] gap-4">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <h2 className="text-lg font-semibold">Deterministic policy checks</h2>
              <p className="mt-0.5 text-xs text-muted">All eight checks are evaluated and recorded.</p>
            </div>
            <div className="text-right font-mono text-[10px] text-muted">
              <span className="block">POLICY {decision.policy_version}</span>
              <span className="mt-1 block">{decision.latency_ms} MS</span>
            </div>
          </div>
          {decision.checks.map((check) => <CheckRow key={check.id} check={check} />)}
        </div>
        <div className={`flex flex-col justify-between rounded-2xl border p-5 text-center ${denied ? "border-fail/50 bg-fail/10" : "border-pass/40 bg-pass/10"}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Funds moved</p>
            <p className={`mt-4 text-[96px] font-black leading-none tracking-[-0.07em] ${denied ? "text-fail" : "text-pass"}`}>
              ${denied ? "0" : formatAmount(intent.amount_display)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-ink/60 p-4 text-left">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted">Enforcement result</p>
            <p className={`mt-2 text-sm font-bold ${denied ? "text-fail" : "text-pass"}`}>
              {denied ? "DENIED BEFORE EXECUTION" : "APPROVED BY POLICY"}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              {denied ? "No transfer was submitted." : "Mock execution is available in the receipt."}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
