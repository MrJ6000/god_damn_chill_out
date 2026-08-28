import type {
  PaymentIntent,
  PolicyDecision,
  Vendor,
} from "@pv/shared";
import {
  evaluate,
  type PolicyContext,
} from "../../../packages/policy-engine/src/index.js";
import type { RuntimeConfig } from "./mock.js";
import type { StoredPaymentRecord } from "./store.js";

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1_000;

function executedInRollingWindow(
  record: StoredPaymentRecord,
  now: Date,
): boolean {
  if (record.execution.status !== "EXECUTED") return false;

  const executedAt = Date.parse(record.execution.executed_at);
  const windowEnd = now.getTime();
  const windowStart = windowEnd - ROLLING_WINDOW_MS;
  return (
    Number.isFinite(executedAt) &&
    executedAt > windowStart &&
    executedAt <= windowEnd
  );
}

export function buildPolicyContext(
  vendors: Vendor[],
  records: StoredPaymentRecord[],
  now: Date,
  config: RuntimeConfig,
): PolicyContext {
  const recentExecutions = records.filter((record) =>
    executedInRollingWindow(record, now),
  );

  return {
    // An unverified registry row must never become a trusted beneficiary.
    vendors: vendors.filter((vendor) => vendor.verified),
    todaySpentDisplay: recentExecutions.reduce(
      (total, record) => total + record.receipt.funds_moved_display,
      0,
    ),
    paidInvoiceIdsToday: recentExecutions.map(
      (record) => record.intent.invoice_id,
    ),
    sessionExpiresAt: config.sessionExpiresAt,
    maxPerTxDisplay: config.maxPerTxDisplay,
    maxPer24hDisplay: config.maxPer24hDisplay,
    allowedTokens: ["USDC"],
    policyVersion: config.policyVersion,
    now,
  };
}

export function evaluatePolicy(
  intent: PaymentIntent,
  vendors: Vendor[],
  records: StoredPaymentRecord[],
  now: Date,
  config: RuntimeConfig,
): PolicyDecision {
  const canonicalVendor = vendors.find(
    (vendor) =>
      vendor.verified &&
      vendor.display_name.toLowerCase() === intent.vendor_name.toLowerCase(),
  );
  const evaluationIntent = canonicalVendor
    ? { ...intent, vendor_name: canonicalVendor.display_name }
    : intent;

  return evaluate(
    evaluationIntent,
    buildPolicyContext(vendors, records, now, config),
  );
}
