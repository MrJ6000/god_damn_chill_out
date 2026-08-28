"use client";

import { useParams } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { CheckRow } from "@/components/CheckRow";
import { VerdictBadge } from "@/components/VerdictBadge";
import { formatDenyReason } from "@/lib/displayLabels";
import { findMockDecision, mockIntents, mockVendors } from "@/lib/mockData";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function PolicyDecisionPage() {
  const { intentId } = useParams<{ intentId: string }>();
  const decision = findMockDecision(intentId);
  const intent = mockIntents.find((candidate) => candidate.intent_id === decision.intent_id) ?? mockIntents.at(-1)!;
  const vendor = mockVendors.find((candidate) => candidate.display_name === intent.vendor_name);
  const denied = decision.verdict === "DENY";
  const review = decision.verdict === "REVIEW";
  const allowed = decision.verdict === "ALLOW";

  return (
    <main className="mx-auto w-[1120px] px-8 pb-12 pt-6">
      <header className="flex items-center justify-between border-b border-line pb-5">
        <div>
          <p className="font-mono text-sm text-muted">{intent.intent_id} · {intent.invoice_id}</p>
          <h1 className="mt-2 text-[40px] font-bold tracking-[-0.03em]">
            {denied ? "這筆付款已被攔截" : review ? "這筆付款等待人工確認" : "這筆付款已通過"}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm tracking-[0.16em] text-muted">安全規則判定</span>
          <VerdictBadge verdict={decision.verdict} />
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4">
        <div className={`rounded-2xl border p-5 ${denied ? "border-fail/50 bg-fail/10" : review ? "border-review/40 bg-review/10" : "border-line bg-surface"}`}>
          <p className={`text-xs font-bold tracking-[0.18em] ${denied ? "text-fail" : review ? "text-review" : "text-muted"}`}>AI 想付款到</p>
          <div className="mt-3"><AddressChip address={intent.recipient} tone={denied ? "fail" : "default"} /></div>
          <p className="mt-3 text-[28px] font-bold">{formatAmount(intent.amount_display)} USDC</p>
          <p className="mt-1 text-xs text-muted">{intent.reasoning}</p>
        </div>
        <div className="rounded-2xl border border-pass/40 bg-pass/10 p-5">
          <p className="text-xs font-bold tracking-[0.18em] text-pass">廠商登記的正確地址</p>
          <div className="mt-3"><AddressChip address={vendor?.verified_wallet ?? "無資料"} tone="pass" /></div>
          <p className="mt-3 text-[28px] font-bold">{intent.vendor_name}</p>
          <p className="mt-1 text-xs text-muted">這是廠商資料庫中已驗證的收款地址。</p>
        </div>
      </section>

      {decision.deny_reasons.length > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-fail/50 bg-fail/10 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-fail">
            <AnimatedIcon className="h-4 w-4" name="x" />
            地址不同，因此付款在送出前就被擋下
          </span>
          <span className="font-mono text-xs font-bold text-fail">
            {decision.deny_reasons.map((reason) => `${reason} · ${formatDenyReason(reason)}`).join(" ／ ")}
          </span>
        </div>
      ) : review ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-review/50 bg-review/10 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-review">
            <AnimatedIcon className="h-4 w-4" name="alert" />
            這筆付款需要人工確認
          </span>
          <span className="text-xs font-semibold text-review">確認完成前不會送出轉帳</span>
        </div>
      ) : null}

      <section className="mt-4 grid grid-cols-[1fr_248px] gap-4">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <h2 className="text-lg font-semibold">8 項付款安全檢查</h2>
              <p className="mt-0.5 text-xs text-muted">每一項都已完成檢查並留下紀錄。</p>
            </div>
            <div className="text-right font-mono text-[10px] text-muted">
              <span className="block">規則版本 {decision.policy_version}</span>
              <span className="mt-1 block">{decision.latency_ms} ms</span>
            </div>
          </div>
          {decision.checks.map((check) => <CheckRow key={check.id} check={check} />)}
        </div>
        <div className={`flex flex-col justify-between rounded-2xl border p-5 text-center ${review ? "border-review/40 bg-review/10" : "border-pass/40 bg-pass/10"}`}>
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-muted">
              {denied ? "未授權資金損失" : review ? "目前轉出金額" : "通過後可執行金額"}
            </p>
            <p className={`mt-4 text-[96px] font-black leading-none tracking-[-0.07em] ${review ? "text-review" : "text-pass"}`}>
              ${allowed ? formatAmount(intent.amount_display) : "0"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-ink/60 p-4 text-left">
            <p className="text-[10px] font-bold tracking-[0.15em] text-muted">執行結果</p>
            <p className={`mt-2 text-sm font-bold ${denied ? "text-fail" : review ? "text-review" : "text-pass"}`}>
              {denied ? "付款送出前已阻擋" : review ? "等待人工確認" : "已通過安全規則"}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              {denied
                ? "沒有任何資金轉出。"
                : review
                  ? "核准前不會執行付款。"
                  : "可在付款憑證查看模擬執行結果。"}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
