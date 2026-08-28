import type { PolicyCheck } from "@pv/shared";

const checkLabels: Record<PolicyCheck["id"], string> = {
  TOKEN_ALLOWED: "Token allowed",
  VENDOR_KNOWN: "Vendor known",
  BENEFICIARY_MATCH: "Beneficiary match",
  PER_TX_LIMIT: "Per-transaction limit",
  DAILY_LIMIT: "Daily limit",
  SESSION_VALID: "Session valid",
  DUPLICATE_PAYMENT: "Duplicate payment",
  APPROVAL_REQUIRED: "Approval required",
};

const statusStyles: Record<PolicyCheck["status"], string> = {
  PASS: "border-pass/30 bg-pass/10 text-pass",
  FAIL: "border-fail/40 bg-fail/10 text-fail",
  WARN: "border-review/40 bg-review/10 text-review",
  NA: "border-line bg-[#202025] text-muted",
};

const statusIcons: Record<PolicyCheck["status"], string> = { PASS: "✓", FAIL: "✕", WARN: "!", NA: "—" };

export function CheckRow({ check }: { check: PolicyCheck }) {
  const isCriticalFailure = check.id === "BENEFICIARY_MATCH" && check.status === "FAIL";

  return (
    <div className={`grid min-h-[50px] grid-cols-[32px_170px_1fr_64px] items-center gap-3 border-t px-4 py-2.5 ${isCriticalFailure ? "border-fail/50 bg-fail/10" : "border-line"}`}>
      <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${statusStyles[check.status]}`}>
        {statusIcons[check.status]}
      </span>
      <span className="text-sm font-semibold">{checkLabels[check.id]}</span>
      <span className="text-xs leading-5 text-muted">{check.detail}</span>
      <span className={`rounded-md border px-2 py-1 text-center text-[10px] font-bold ${statusStyles[check.status]}`}>{check.status}</span>
    </div>
  );
}
