import type { PolicyCheck } from "@pv/shared";
import { AnimatedIcon, type IconName } from "@/components/AnimatedIcon";

const checkLabels: Record<PolicyCheck["id"], string> = {
  TOKEN_ALLOWED: "幣別允許",
  VENDOR_KNOWN: "廠商已登記",
  BENEFICIARY_MATCH: "收款地址吻合",
  PER_TX_LIMIT: "單筆金額上限",
  DAILY_LIMIT: "每日總額上限",
  SESSION_VALID: "本次權限有效",
  DUPLICATE_PAYMENT: "無重複付款",
  APPROVAL_REQUIRED: "是否需要人工核准",
};

const statusStyles: Record<PolicyCheck["status"], string> = {
  PASS: "border-pass/30 bg-pass/10 text-pass",
  FAIL: "border-fail/40 bg-fail/10 text-fail",
  WARN: "border-review/40 bg-review/10 text-review",
  NA: "border-line bg-[#202025] text-muted",
};

const statusIcons: Record<PolicyCheck["status"], IconName> = { PASS: "check", FAIL: "x", WARN: "alert", NA: "minus" };
const statusLabels: Record<PolicyCheck["status"], string> = {
  PASS: "通過",
  FAIL: "失敗",
  WARN: "注意",
  NA: "不適用",
};

export function CheckRow({ check }: { check: PolicyCheck }) {
  const isCriticalFailure = check.id === "BENEFICIARY_MATCH" && check.status === "FAIL";

  return (
    <div className={`grid min-h-[50px] grid-cols-[32px_170px_1fr_64px] items-center gap-3 border-t px-4 py-2.5 ${isCriticalFailure ? "border-fail/50 bg-fail/10" : "border-line"}`}>
      <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${statusStyles[check.status]}`}>
        <AnimatedIcon className="h-4 w-4" name={statusIcons[check.status]} />
      </span>
      <span className="text-sm font-semibold">{checkLabels[check.id]}</span>
      <span className="text-xs leading-5 text-muted">{check.detail}</span>
      <span className={`rounded-md border px-2 py-1 text-center text-[10px] font-bold ${statusStyles[check.status]}`}>{statusLabels[check.status]}</span>
    </div>
  );
}
