"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { PolicyReceipt } from "@pv/shared";
import { AddressChip } from "@/components/AddressChip";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { useDemo } from "@/components/DemoProvider";
import { VerdictBadge } from "@/components/VerdictBadge";
import type { DemoNotice } from "@/lib/api";
import { selectReceipt, selectReceiptRecord } from "@/lib/demoState";
import { formatHumanApproval } from "@/lib/displayLabels";
import { loadReceipt } from "@/lib/demoWorkflow";

type ReceiptLoadResult = Awaited<ReturnType<typeof loadReceipt>>;

const inFlightReceiptLoads = new Map<string, Promise<ReceiptLoadResult>>();

function loadReceiptOnce(paymentId: string): Promise<ReceiptLoadResult> {
  const existing = inFlightReceiptLoads.get(paymentId);
  if (existing) return existing;

  const request = loadReceipt(paymentId);
  inFlightReceiptLoads.set(paymentId, request);
  const clear = () => {
    if (inFlightReceiptLoads.get(paymentId) === request) {
      inFlightReceiptLoads.delete(paymentId);
    }
  };
  request.then(clear, clear);
  return request;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function PolicyReceiptPage() {
  const router = useRouter();
  const { paymentId } = useParams<{ paymentId: string }>();
  const { hydrated, state } = useDemo();
  const storedRecord = selectReceiptRecord(state, paymentId);
  const exactFallback = selectReceipt(state, paymentId);
  const [loadedReceipt, setLoadedReceipt] = useState<PolicyReceipt>();
  const [loadedSource, setLoadedSource] = useState<"api" | "mock">();
  const [loadedPaymentId, setLoadedPaymentId] = useState<string>();
  const [notice, setNotice] = useState<DemoNotice>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    setLoadedReceipt(undefined);
    setLoadedSource(undefined);
    setLoadedPaymentId(undefined);
    setNotice(undefined);
    if (storedRecord?.source === "mock") {
      setLoadedPaymentId(paymentId);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void loadReceiptOnce(paymentId).then((result) => {
      if (!active) return;
      if (storedRecord?.source !== "api" || result.source === "api") {
        setLoadedReceipt(result.receipt);
        setLoadedSource(result.source);
      }
      setLoadedPaymentId(paymentId);
      setNotice(result.notice);
      setLoading(false);
    });
    return () => { active = false; };
  }, [hydrated, paymentId, storedRecord?.source]);

  const loadedCurrentPayment = loadedPaymentId === paymentId;
  const currentLoadedReceipt = loadedCurrentPayment ? loadedReceipt : undefined;
  const currentLoadedSource = loadedCurrentPayment ? loadedSource : undefined;
  const currentNotice = loadedCurrentPayment ? notice : undefined;

  if (!hydrated || loading || (!storedRecord && !loadedCurrentPayment)) {
    return <main className="mx-auto w-[1120px] px-8 py-24 text-center text-lg text-muted">正在讀取付款憑證…</main>;
  }

  const receipt = currentLoadedReceipt ?? storedRecord?.receipt ?? (loadedCurrentPayment ? exactFallback : undefined);
  const source = currentLoadedSource ?? storedRecord?.source ?? (loadedCurrentPayment && exactFallback ? "mock" : undefined);
  const activeNotice = currentNotice ?? storedRecord?.notice;

  if (!receipt || !source) {
    return (
      <main className="mx-auto w-[1120px] px-8 py-24 text-center">
        <p className="text-sm font-bold tracking-[0.18em] text-fail">找不到付款憑證</p>
        <h1 className="mt-4 text-[44px] font-bold">{paymentId}</h1>
        <p className="mt-3 text-muted">API 與精確的前端備援資料都沒有這個 ID，因此不會顯示其他付款的憑證。</p>
        <button className="mt-8 rounded-xl border border-line bg-surface px-6 py-3 font-semibold" onClick={() => router.push("/")} type="button">回到待付款清單</button>
      </main>
    );
  }

  const execution = receipt.execution;
  const mockExecution = source === "mock" || execution?.error_code === "MOCK_CHAIN";
  const denied = receipt.policy_verdict === "DENY";
  const pending = execution?.status === "PENDING";
  const broadcastEvidence = !mockExecution && Boolean(execution?.tx_hash || execution?.user_op_hash || execution?.explorer_url);
  const finalChainEvidence = !mockExecution && !pending && Boolean(execution?.tx_hash || execution?.block_number || execution?.explorer_url);
  const heading = pending && broadcastEvidence ? "已廣播，等待鏈上確認" : finalChainEvidence ? "鏈上付款憑證" : mockExecution ? "備援示範憑證" : "政策與執行憑證";

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-4">
      <header className="flex items-center justify-between border-b border-line pb-7">
        <div>
          <div className="flex items-center gap-3"><p className="text-sm font-semibold tracking-[0.2em] text-pass">付款執行紀錄</p><DataSourceBadge source={source} /></div>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">{heading}</h1>
          <p className="mt-2 text-base text-muted">PENDING 只代表已廣播；必須取得最終鏈上證據後才標示為鏈上付款憑證。</p>
        </div>
        <div className="text-right"><p className="font-mono text-2xl font-bold">{receipt.payment_id}</p><p className="mt-2 text-xs tracking-[0.16em] text-muted">{execution?.status ?? "未執行"}</p></div>
      </header>

      {activeNotice ? <div className="mt-5 rounded-xl border border-review/40 bg-review/10 px-5 py-3 text-sm text-review">{source === "mock" ? <><strong>API 執行結果未取得：</strong> {activeNotice.message} 以下憑證為獨立標示的備援示意，不能當作鏈上證據。</> : <><strong>憑證重新讀取失敗：</strong> API 回傳 {activeNotice.code}，目前顯示本次流程先前收到的 API 憑證快照。</>}</div> : null}
      {execution?.error_code === "MOCK_CHAIN" && source === "api" ? <div className="mt-5 rounded-xl border border-review/40 bg-review/10 px-5 py-3 text-sm text-review"><strong>API MOCK MODE：</strong> 後端成功回應，但沒有送出真實鏈上交易。</div> : null}

      <section className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-6 py-5"><div><p className="text-sm text-muted">帳單 {receipt.invoice_id}</p><h2 className="mt-1 text-2xl font-semibold">{receipt.vendor_name}</h2></div><VerdictBadge verdict={receipt.policy_verdict} /></div>
        <dl className="grid grid-cols-2">
          <div className="border-b border-r border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">輸入資料雜湊</dt><dd className="mt-2 font-mono text-base">{receipt.input_hash}</dd></div>
          <div className="border-b border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">金額</dt><dd className="mt-2 font-mono text-base font-semibold">{formatAmount(receipt.amount_display)} USDC</dd></div>
          <div className="border-b border-r border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">已驗證收款地址</dt><dd className="mt-2"><AddressChip address={receipt.verified_recipient || "未提供"} tone="pass" /></dd></div>
          <div className="border-b border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">AI 提議的收款地址</dt><dd className="mt-2"><AddressChip address={receipt.agent_proposed_recipient} tone={denied ? "fail" : "default"} /></dd></div>
          <div className="border-b border-r border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">安全規則版本</dt><dd className="mt-2 font-mono text-base">{receipt.policy_version}</dd></div>
          <div className="border-b border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">本次權限編號</dt><dd className="mt-2 font-mono text-base">{receipt.session_permission_id}</dd></div>
          <div className="border-b border-r border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">人工核准</dt><dd className="mt-2 text-base font-semibold">{formatHumanApproval(receipt.human_approval)}</dd></div>
          <div className="border-b border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">區塊</dt><dd className="mt-2 font-mono text-base">{execution?.block_number ?? (pending ? "等待確認" : "—")}</dd></div>
          <div className="border-r border-line px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">交易狀態</dt><dd className="mt-2 font-mono text-sm">{execution?.status ?? "未送出"}{execution?.error_code ? ` · ${execution.error_code}` : ""}</dd></div>
          <div className="px-6 py-5"><dt className="text-xs font-semibold tracking-[0.14em] text-muted">{mockExecution ? "模擬交易識別" : "鏈上交易"}</dt><dd className="mt-2 flex items-center gap-3"><span className="font-mono text-sm">{execution?.tx_hash ? `${execution.tx_hash.slice(0, 8)}…${execution.tx_hash.slice(-4)}` : execution?.user_op_hash ? `${execution.user_op_hash.slice(0, 8)}…${execution.user_op_hash.slice(-4)}` : "未提供鏈上雜湊"}</span>{execution?.explorer_url ? <a className="text-sm font-semibold text-pass underline underline-offset-4" href={execution.explorer_url} rel="noreferrer" target="_blank">查看 ↗</a> : <span className="rounded border border-review/30 bg-review/10 px-2 py-1 text-[10px] font-bold tracking-wider text-review">{mockExecution ? "非鏈上證據" : "無 explorer 證據"}</span>}</dd></div>
        </dl>
      </section>

      <section className={`mt-6 rounded-2xl border p-7 text-center ${pending || mockExecution ? "border-review/40 bg-review/10" : "border-pass/40 bg-pass/10"}`}>
        <p className="text-xs font-bold tracking-[0.2em] text-muted">{pending ? "最終資金移動" : mockExecution ? "模擬付款金額（未上鏈）" : denied ? "未授權資金損失" : "憑證記錄的資金移動"}</p>
        <p className={`mt-2 text-[96px] font-black leading-none tracking-[-0.06em] ${pending || mockExecution ? "text-review" : "text-pass"}`}>{pending ? "未知" : `$${formatAmount(receipt.funds_moved_display)}`}</p>
        {mockExecution ? <p className="mt-4 text-sm text-muted">此數字只供 demo 呈現，不代表真實資金已移動。</p> : null}
      </section>
    </main>
  );
}
