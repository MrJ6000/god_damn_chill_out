"use client";

import { useParams, useRouter } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { CheckRow } from "@/components/CheckRow";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { useDemo } from "@/components/DemoProvider";
import { VerdictBadge } from "@/components/VerdictBadge";
import { formatDenyReason } from "@/lib/displayLabels";
import { selectDecision, selectIntent, selectVendor } from "@/lib/demoState";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function PolicyDecisionPage() {
  const router = useRouter();
  const { intentId } = useParams<{ intentId: string }>();
  const { hydrated, state } = useDemo();
  const intent = selectIntent(state, intentId);
  const decision = selectDecision(state, intentId);
  const vendor = intent ? selectVendor(state, intent.vendor_name) : undefined;
  const stored = state.plan?.intents.some((candidate) => candidate.intent_id === intentId) ?? false;
  const source = stored ? state.plan?.source ?? "mock" : "mock";

  if (!hydrated) {
    return <main className="mx-auto w-[1120px] px-8 py-24 text-center text-lg text-muted">正在還原政策判定…</main>;
  }

  if (!intent || !decision) {
    return (
      <main className="mx-auto w-[1120px] px-8 py-24 text-center">
        <p className="text-sm font-bold tracking-[0.18em] text-fail">找不到政策判定</p>
        <h1 className="mt-4 text-[44px] font-bold">{intentId}</h1>
        <p className="mt-3 text-muted">這個 ID 不在目前狀態或精確的備援資料中，因此不會顯示其他付款的結果。</p>
        <button className="mt-8 rounded-xl border border-line bg-surface px-6 py-3 font-semibold" onClick={() => router.push("/")} type="button">回到待付款清單</button>
      </main>
    );
  }

  const denied = decision.verdict === "DENY";
  const review = decision.verdict === "REVIEW";
  const allowed = decision.verdict === "ALLOW";

  return (
    <main className="mx-auto w-[1120px] px-8 pb-12 pt-4">
      <header className="flex items-center justify-between border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-3">
            <p className="font-mono text-sm text-muted">{intent.intent_id} · {intent.invoice_id}</p>
            <DataSourceBadge source={source} />
          </div>
          <h1 className="mt-2 text-[40px] font-bold tracking-[-0.03em]">{denied ? "這筆付款已被攔截" : review ? "這筆付款等待人工確認" : "這筆付款已通過"}</h1>
        </div>
        <div className="flex items-center gap-4"><span className="text-sm tracking-[0.16em] text-muted">{source === "api" ? "後端政策判定" : "前端備援判定"}</span><VerdictBadge verdict={decision.verdict} /></div>
      </header>

      {stored && state.plan?.notices[0] ? (
        <div className="mt-4 rounded-xl border border-review/40 bg-review/10 px-5 py-3 text-sm text-review"><strong>備援情境：</strong> {state.plan.notices[0].message}</div>
      ) : null}

      <section className="mt-6 grid grid-cols-2 gap-4">
        <div className={`rounded-2xl border p-5 ${denied ? "border-fail/50 bg-fail/10" : review ? "border-review/40 bg-review/10" : "border-line bg-surface"}`}>
          <p className={`text-xs font-bold tracking-[0.18em] ${denied ? "text-fail" : review ? "text-review" : "text-muted"}`}>AI 提議的收款地址</p>
          <div className="mt-3"><AddressChip address={intent.recipient} tone={denied ? "fail" : "default"} /></div>
          <p className="mt-3 text-[28px] font-bold">{formatAmount(intent.amount_display)} USDC</p>
          <p className="mt-1 text-xs text-muted">{intent.reasoning}</p>
        </div>
        <div className="rounded-2xl border border-pass/40 bg-pass/10 p-5">
          <p className="text-xs font-bold tracking-[0.18em] text-pass">廠商資料庫的已驗證地址</p>
          <div className="mt-3"><AddressChip address={vendor?.verified_wallet ?? "廠商資料未提供"} tone="pass" /></div>
          <p className="mt-3 text-[28px] font-bold">{intent.vendor_name}</p>
          <p className="mt-1 text-xs text-muted">{source === "api" ? "可信地址來自 vendors API，不由前端自行判斷。" : "此地址來自一致的前端備援廠商資料。"}</p>
        </div>
      </section>

      {decision.deny_reasons.length > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-fail/50 bg-fail/10 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-fail"><AnimatedIcon className="h-4 w-4" name="x" />政策在送出交易前拒絕此付款</span>
          <span className="font-mono text-xs font-bold text-fail">{decision.deny_reasons.map((reason) => `${reason} · ${formatDenyReason(reason)}`).join(" ／ ")}</span>
        </div>
      ) : review ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-review/50 bg-review/10 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-review"><AnimatedIcon className="h-4 w-4" name="alert" />這筆付款需要人工確認</span>
          <span className="text-xs font-semibold text-review">此流程不會自動核准或送出轉帳</span>
        </div>
      ) : null}

      <section className="mt-4 grid grid-cols-[1fr_248px] gap-4">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div><h2 className="text-lg font-semibold">8 項付款安全檢查</h2><p className="mt-0.5 text-xs text-muted">{source === "api" ? "逐項顯示後端回傳的政策結果。" : "逐項顯示前端備援情境的政策結果。"}</p></div>
            <div className="text-right font-mono text-[10px] text-muted"><span className="block">規則版本 {decision.policy_version}</span><span className="mt-1 block">{decision.latency_ms} ms</span></div>
          </div>
          {decision.checks.map((check) => <CheckRow key={check.id} check={check} />)}
        </div>
        <div className={`flex flex-col justify-between rounded-2xl border p-5 text-center ${review ? "border-review/40 bg-review/10" : "border-pass/40 bg-pass/10"}`}>
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-muted">{denied ? "目前未授權資金損失" : review ? "目前轉出金額" : "通過後可執行金額"}</p>
            <p className={`mt-4 text-[96px] font-black leading-none tracking-[-0.07em] ${review ? "text-review" : "text-pass"}`}>${allowed ? formatAmount(intent.amount_display) : "0"}</p>
          </div>
          <div className="rounded-xl border border-line bg-ink/60 p-4 text-left">
            <p className="text-[10px] font-bold tracking-[0.15em] text-muted">政策結果</p>
            <p className={`mt-2 text-sm font-bold ${denied ? "text-fail" : review ? "text-review" : "text-pass"}`}>{denied ? "付款未送出" : review ? "等待人工確認" : "允許進入執行階段"}</p>
            <p className="mt-2 text-xs leading-5 text-muted">此頁顯示政策判定，不會把尚未送鏈的結果描述成鏈上拒絕。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
