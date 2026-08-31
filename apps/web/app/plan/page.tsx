"use client";

import { useRouter } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { AgentActivity } from "@/components/AgentActivity";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { useDemo } from "@/components/DemoProvider";
import { StatCard } from "@/components/StatCard";
import { VerdictBadge } from "@/components/VerdictBadge";
import { formatDenyReason } from "@/lib/displayLabels";
import { selectPlan } from "@/lib/demoState";

const verdictOrder = { DENY: 0, REVIEW: 1, ALLOW: 2 } as const;

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function PaymentPlanPage() {
  const router = useRouter();
  const { busy, executeCurrentPlan, hydrated, state } = useDemo();

  if (!hydrated) {
    return <main className="mx-auto w-[1120px] px-8 py-24 text-center text-lg text-muted">正在還原付款計畫…</main>;
  }

  const plan = selectPlan(state);
  const decisionsByIntent = new Map(plan.decisions.map((decision) => [decision.intent_id, decision]));
  const planRows = plan.intents.flatMap((intent) => {
    const decision = decisionsByIntent.get(intent.intent_id);
    return decision ? [{ decision, intent }] : [];
  }).sort((left, right) => verdictOrder[left.decision.verdict] - verdictOrder[right.decision.verdict]);
  const counts = plan.decisions.reduce(
    (result, decision) => ({ ...result, [decision.verdict]: result[decision.verdict] + 1 }),
    { ALLOW: 0, REVIEW: 0, DENY: 0 },
  );

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-6">
      <header className="flex items-end justify-between border-b border-line pb-7">
        <div>
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold tracking-[0.2em] text-pass">{plan.source === "api" ? "AI 規劃完成" : "備援付款計畫已就緒"}</p>
            <DataSourceBadge source={plan.source} />
          </div>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">AI 付款計畫</h1>
          <p className="mt-2 text-lg text-muted">
            {plan.intents.length} 筆付款提案已完成{plan.source === "api" ? "後端政策檢查" : "前端備援政策情境"}。
          </p>
        </div>
        <div className="max-w-[360px] rounded-lg border border-line bg-surface px-4 py-3 text-right">
          <p className="text-xs font-semibold text-body">AI 回覆</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">{plan.agentMessage}</p>
        </div>
      </header>

      {plan.notices[0] ? (
        <div className="mt-5 rounded-xl border border-review/40 bg-review/10 px-5 py-3 text-sm text-review">
          <strong>整幕備援：</strong> {plan.notices[0].message} 所有提案與判定已一致切換為前端備援資料。
        </div>
      ) : null}

      <section className="mt-8 grid grid-cols-3 gap-5" aria-label="安全規則檢查結果">
        <StatCard label="可自動付款" value={String(counts.ALLOW)} detail={plan.source === "api" ? "只執行後端判定為 ALLOW 的付款" : "備援情境中標示為 ALLOW 的付款"} tone="pass" />
        <StatCard label="需要人工確認" value={String(counts.REVIEW)} detail="此流程不會自動核准" tone="review" />
        <StatCard label="已攔截" value={String(counts.DENY)} detail="不會送出付款" tone="fail" />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-[1fr_180px_210px_120px] border-b border-line bg-[#101012] px-6 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <span>付款提案</span><span>金額</span><span>收款地址</span><span className="text-right">判定結果</span>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {planRows.map(({ decision, intent }) => (
            <div
              key={intent.intent_id}
              className={`grid w-full grid-cols-[1fr_180px_210px_120px] items-center border-t px-6 py-4 text-left ${decision.verdict === "DENY" ? "border-fail/50 bg-fail/10" : decision.verdict === "REVIEW" ? "border-review/30 bg-review/5" : "border-line hover:bg-[#19191d]"}`}
            >
              <span>
                <span className="block font-semibold">{intent.vendor_name}</span>
                <span className="mt-1 block font-mono text-xs text-muted">{intent.invoice_id} · {intent.intent_id}</span>
                {decision.deny_reasons[0] ? (
                  <span className="mt-2 block text-xs font-bold text-fail">{formatDenyReason(decision.deny_reasons[0])}</span>
                ) : decision.verdict === "REVIEW" ? (
                  <span className="mt-2 block text-xs font-bold text-review">需要明確人工確認，尚未付款</span>
                ) : null}
              </span>
              <span className="font-mono font-semibold">{formatAmount(intent.amount_display)} USDC</span>
              <span><AddressChip address={intent.recipient} tone={decision.verdict === "DENY" ? "fail" : "default"} /></span>
              <span className="flex flex-col items-end gap-2 text-right">
                <VerdictBadge verdict={decision.verdict} />
                <button className="text-xs font-semibold text-muted underline decoration-line underline-offset-4 hover:text-body" onClick={() => router.push(`/decision/${intent.intent_id}`)} type="button">查看判定 →</button>
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 flex items-center justify-end gap-4">
        {busy ? (
          <AgentActivity className="w-[500px]" detail="REVIEW 與 DENY 不會送出" label={`正在送出 ${counts.ALLOW} 筆 ALLOW 付款`} mode="executing" />
        ) : null}
        <button
          aria-busy={busy}
          disabled={busy || counts.ALLOW === 0}
          className={`group inline-flex min-w-[240px] items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold text-[#04120d] disabled:cursor-not-allowed disabled:opacity-60 ${busy ? "bg-[#6ee7b7]" : "bg-pass hover:bg-[#34d399]"}`}
          onClick={() => void executeCurrentPlan()}
          type="button"
        >
          {busy ? "正在建立憑證…" : `執行 ${counts.ALLOW} 筆已通過付款`}
          <AnimatedIcon active={busy} className="h-4 w-4" morphTo="check" name="arrow-right" />
        </button>
      </div>
    </main>
  );
}
