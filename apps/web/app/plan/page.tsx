"use client";

import { useRouter } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { StatCard } from "@/components/StatCard";
import { VerdictBadge } from "@/components/VerdictBadge";
import { mockDecisions, mockIntents } from "@/lib/mockData";

const counts = mockDecisions.reduce(
  (result, decision) => ({ ...result, [decision.verdict]: result[decision.verdict] + 1 }),
  { ALLOW: 0, REVIEW: 0, DENY: 0 },
);

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function PaymentPlanPage() {
  const router = useRouter();

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-10">
      <header className="flex items-end justify-between border-b border-line pb-7">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-pass">Agent complete</p>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">AI Payment Plan</h1>
          <p className="mt-2 text-lg text-muted">18 intents evaluated against policy V18.</p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3 font-mono text-xs text-muted">
          MOCK FALLBACK READY
        </div>
      </header>

      <section className="mt-8 grid grid-cols-3 gap-5" aria-label="Policy outcome totals">
        <StatCard label="Auto execute" value={String(counts.ALLOW)} detail="Policy approved" tone="pass" />
        <StatCard label="Needs review" value={String(counts.REVIEW)} detail="Human decision" tone="review" />
        <StatCard label="Blocked" value={String(counts.DENY)} detail="Policy denied" tone="fail" />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-[1fr_180px_210px_120px] border-b border-line bg-[#101012] px-6 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <span>Payment intent</span>
          <span>Amount</span>
          <span>Recipient</span>
          <span className="text-right">Decision</span>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {mockIntents.map((intent, index) => {
            const decision = mockDecisions[index];
            return (
              <div
                key={intent.intent_id}
                className={`grid w-full grid-cols-[1fr_180px_210px_120px] items-center border-t px-6 py-4 text-left ${
                  decision.verdict === "DENY"
                    ? "border-fail/50 bg-fail/10"
                    : decision.verdict === "REVIEW"
                      ? "border-review/30 bg-review/5"
                      : "border-line hover:bg-[#19191d]"
                }`}
                onClick={() => router.push(`/decision/${intent.intent_id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    router.push(`/decision/${intent.intent_id}`);
                  }
                }}
                role="link"
                tabIndex={0}
              >
                <span>
                  <span className="block font-semibold">{intent.vendor_name}</span>
                  <span className="mt-1 block font-mono text-xs text-muted">
                    {intent.invoice_id} · {intent.intent_id}
                  </span>
                  {decision.deny_reasons[0] ? (
                    <span className="mt-2 block text-xs font-bold tracking-wide text-fail">{decision.deny_reasons[0]}</span>
                  ) : null}
                </span>
                <span className="font-mono font-semibold">{formatAmount(intent.amount_display)} USDC</span>
                <span><AddressChip address={intent.recipient} tone={decision.verdict === "DENY" ? "fail" : "default"} /></span>
                <span className="text-right"><VerdictBadge verdict={decision.verdict} /></span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 flex justify-end">
        <button
          className="rounded-xl bg-pass px-7 py-3.5 text-sm font-bold text-[#04120d] hover:bg-[#34d399]"
          onClick={() => router.push("/receipt/PV-0001")}
          type="button"
        >
          Execute Approved →
        </button>
      </div>
    </main>
  );
}
