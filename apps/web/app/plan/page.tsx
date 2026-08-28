"use client";

import { useRouter } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { StatCard } from "@/components/StatCard";
import { VerdictBadge } from "@/components/VerdictBadge";
import { formatDenyReason } from "@/lib/displayLabels";
import { mockDecisions, mockIntents } from "@/lib/mockData";

const counts = mockDecisions.reduce(
  (result, decision) => ({ ...result, [decision.verdict]: result[decision.verdict] + 1 }),
  { ALLOW: 0, REVIEW: 0, DENY: 0 },
);

const verdictOrder = { DENY: 0, REVIEW: 1, ALLOW: 2 } as const;
const planRows = mockIntents
  .map((intent, index) => ({ decision: mockDecisions[index], intent }))
  .sort((left, right) => verdictOrder[left.decision.verdict] - verdictOrder[right.decision.verdict]);

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function PaymentPlanPage() {
  const router = useRouter();

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-10">
      <header className="flex items-end justify-between border-b border-line pb-7">
        <div>
          <p className="text-sm font-semibold tracking-[0.2em] text-pass">AI 規劃完成</p>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">AI 付款計畫</h1>
          <p className="mt-2 text-lg text-muted">18 筆付款提案已完成 V18 安全規則檢查。</p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3 text-right">
          <p className="text-xs font-semibold text-body">示範資料模式</p>
          <p className="mt-1 text-[10px] text-muted">後端未啟動也能完整展示</p>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-3 gap-5" aria-label="安全規則檢查結果">
        <StatCard label="可自動付款" value={String(counts.ALLOW)} detail="已通過安全規則" tone="pass" />
        <StatCard label="需要人工確認" value={String(counts.REVIEW)} detail="新廠商等待核准" tone="review" />
        <StatCard label="已攔截" value={String(counts.DENY)} detail="收款地址不符" tone="fail" />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-[1fr_180px_210px_120px] border-b border-line bg-[#101012] px-6 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <span>付款提案</span>
          <span>金額</span>
          <span>收款地址</span>
          <span className="text-right">判定結果</span>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {planRows.map(({ decision, intent }) => {
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
              >
                <span>
                  <span className="block font-semibold">{intent.vendor_name}</span>
                  <span className="mt-1 block font-mono text-xs text-muted">
                    {intent.invoice_id} · {intent.intent_id}
                  </span>
                  {decision.deny_reasons[0] ? (
                    <span className="mt-2 block text-xs font-bold text-fail">
                      {formatDenyReason(decision.deny_reasons[0])}
                    </span>
                  ) : decision.verdict === "REVIEW" ? (
                    <span className="mt-2 block text-xs font-bold text-review">新廠商 · 需要人工確認</span>
                  ) : null}
                </span>
                <span className="font-mono font-semibold">{formatAmount(intent.amount_display)} USDC</span>
                <span><AddressChip address={intent.recipient} tone={decision.verdict === "DENY" ? "fail" : "default"} /></span>
                <span className="flex flex-col items-end gap-2 text-right">
                  <VerdictBadge verdict={decision.verdict} />
                  <button
                    className="text-xs font-semibold text-muted underline decoration-line underline-offset-4 hover:text-body"
                    onClick={() => router.push(`/decision/${intent.intent_id}`)}
                    type="button"
                  >
                    查看判定 →
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 flex justify-end">
        <button
          className="group inline-flex items-center gap-2 rounded-xl bg-pass px-7 py-3.5 text-sm font-bold text-[#04120d] hover:bg-[#34d399]"
          onClick={() => router.push("/receipt/PV-0001")}
          type="button"
        >
          執行 16 筆已通過付款
          <AnimatedIcon className="h-4 w-4" morphTo="check" name="arrow-right" />
        </button>
      </div>
    </main>
  );
}
