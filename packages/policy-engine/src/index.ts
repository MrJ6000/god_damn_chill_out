import type {
  DenyReasonCode,
  PaymentIntent,
  PolicyCheck,
  PolicyDecision,
  Vendor,
} from "@pv/shared";

export interface PolicyContext {
  vendors: Vendor[];
  todaySpentDisplay: number;
  paidInvoiceIdsToday: string[];
  sessionExpiresAt: string;
  maxPerTxDisplay: number;
  maxPer24hDisplay: number;
  allowedTokens: string[];
  policyVersion: string;
  now?: Date;
}

export function evaluate(intent: PaymentIntent, ctx: PolicyContext): PolicyDecision {
  const startedAt = performance.now();
  const now = ctx.now ?? new Date();
  const checks: PolicyCheck[] = [];
  const denyReasons: DenyReasonCode[] = [];

  if (ctx.allowedTokens.includes(intent.token)) {
    checks.push({
      id: "TOKEN_ALLOWED",
      status: "PASS",
      detail: `Token ${intent.token} is allowed.`,
    });
  } else {
    checks.push({
      id: "TOKEN_ALLOWED",
      status: "FAIL",
      detail: `Token ${intent.token} is not in the allowed token list.`,
    });
    denyReasons.push("TOKEN_NOT_ALLOWED");
  }

  const vendor = ctx.vendors.find((candidate) => candidate.display_name === intent.vendor_name);
  if (vendor) {
    checks.push({
      id: "VENDOR_KNOWN",
      status: "PASS",
      detail: `Vendor ${intent.vendor_name} is registered with status ${vendor.status}.`,
    });
  } else {
    checks.push({
      id: "VENDOR_KNOWN",
      status: "FAIL",
      detail: `Vendor ${intent.vendor_name} is not registered.`,
    });
    denyReasons.push("VENDOR_UNKNOWN");
  }

  if (!vendor) {
    checks.push({
      id: "BENEFICIARY_MATCH",
      status: "NA",
      detail: `Recipient verification cannot be evaluated because vendor ${intent.vendor_name} is unknown.`,
    });
  } else if (intent.recipient.toLowerCase() === vendor.verified_wallet.toLowerCase()) {
    checks.push({
      id: "BENEFICIARY_MATCH",
      status: "PASS",
      detail: `Intent recipient ${intent.recipient} matches the verified wallet for ${intent.vendor_name}.`,
    });
  } else {
    checks.push({
      id: "BENEFICIARY_MATCH",
      status: "FAIL",
      detail: `Intent recipient ${intent.recipient} does not match verified wallet ${vendor.verified_wallet} for ${intent.vendor_name}.`,
    });
    denyReasons.push("BENEFICIARY_MISMATCH");
  }

  if (intent.amount_display <= ctx.maxPerTxDisplay) {
    checks.push({
      id: "PER_TX_LIMIT",
      status: "PASS",
      detail: `Amount ${intent.amount_display} is within the per-transaction limit of ${ctx.maxPerTxDisplay}.`,
    });
  } else {
    checks.push({
      id: "PER_TX_LIMIT",
      status: "FAIL",
      detail: `Amount ${intent.amount_display} exceeds the per-transaction limit of ${ctx.maxPerTxDisplay}.`,
    });
    denyReasons.push("PER_TX_LIMIT_EXCEEDED");
  }

  const projectedDailySpend = ctx.todaySpentDisplay + intent.amount_display;
  if (projectedDailySpend <= ctx.maxPer24hDisplay) {
    checks.push({
      id: "DAILY_LIMIT",
      status: "PASS",
      detail: `Projected 24-hour spend ${projectedDailySpend} is within the limit of ${ctx.maxPer24hDisplay}.`,
    });
  } else {
    checks.push({
      id: "DAILY_LIMIT",
      status: "FAIL",
      detail: `Projected 24-hour spend ${projectedDailySpend} exceeds the limit of ${ctx.maxPer24hDisplay}.`,
    });
    denyReasons.push("DAILY_LIMIT_EXCEEDED");
  }

  const sessionExpiryTime = Date.parse(ctx.sessionExpiresAt);
  if (now.getTime() < sessionExpiryTime) {
    checks.push({
      id: "SESSION_VALID",
      status: "PASS",
      detail: `Session remains valid until ${ctx.sessionExpiresAt}.`,
    });
  } else {
    checks.push({
      id: "SESSION_VALID",
      status: "FAIL",
      detail: `Session expired at ${ctx.sessionExpiresAt}; evaluation time is ${now.toISOString()}.`,
    });
    denyReasons.push("SESSION_EXPIRED");
  }

  if (!ctx.paidInvoiceIdsToday.includes(intent.invoice_id)) {
    checks.push({
      id: "DUPLICATE_PAYMENT",
      status: "PASS",
      detail: `Invoice ${intent.invoice_id} has not been paid today.`,
    });
  } else {
    checks.push({
      id: "DUPLICATE_PAYMENT",
      status: "FAIL",
      detail: `Invoice ${intent.invoice_id} has already been paid today.`,
    });
    denyReasons.push("DUPLICATE_PAYMENT");
  }

  const approvalReasons: string[] = [];
  if (vendor?.status === "NEW") approvalReasons.push(`vendor ${intent.vendor_name} is NEW`);
  if (intent.amount_display > 2000) approvalReasons.push(`amount ${intent.amount_display} exceeds 2000`);
  const approvalRequired = approvalReasons.length > 0;

  if (approvalRequired) {
    checks.push({
      id: "APPROVAL_REQUIRED",
      status: "WARN",
      detail: `Human approval is required because ${approvalReasons.join(" and ")}.`,
    });
  } else {
    checks.push({
      id: "APPROVAL_REQUIRED",
      status: "PASS",
      detail: `Human approval is not required for this known vendor and amount ${intent.amount_display}.`,
    });
  }

  const verdict = denyReasons.length > 0 ? "DENY" : approvalRequired ? "REVIEW" : "ALLOW";

  return {
    intent_id: intent.intent_id,
    verdict,
    checks,
    deny_reasons: denyReasons,
    policy_version: ctx.policyVersion,
    evaluated_at: now.toISOString(),
    latency_ms: performance.now() - startedAt,
  };
}
