import { createHash } from "node:crypto";
import {
  type BlastRadius,
  type ExecutionResult,
  type Invoice,
  type PaymentIntent,
  type PolicyDecision,
  type PolicyReceipt,
  type Vendor,
} from "@pv/shared";
import type { StoredPaymentRecord } from "./store.js";

export interface RuntimeConfig {
  policyVersion: string;
  maxPerTxDisplay: number;
  maxPer24hDisplay: number;
  sessionExpiresAt: string;
  treasuryBalanceDisplay: number;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  policyVersion: "V18",
  maxPerTxDisplay: 5_000,
  maxPer24hDisplay: 10_000,
  sessionExpiresAt: "2026-09-07T23:59:00Z",
  treasuryBalanceDisplay: 2_000_000,
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getRuntimeConfig(
  overrides: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  return {
    policyVersion: process.env.POLICY_VERSION ?? DEFAULT_CONFIG.policyVersion,
    maxPerTxDisplay: envNumber("MAX_PER_TX_USD", DEFAULT_CONFIG.maxPerTxDisplay),
    maxPer24hDisplay: envNumber("MAX_PER_24H_USD", DEFAULT_CONFIG.maxPer24hDisplay),
    sessionExpiresAt:
      process.env.SESSION_EXPIRES_AT ?? DEFAULT_CONFIG.sessionExpiresAt,
    treasuryBalanceDisplay: envNumber(
      "TREASURY_BALANCE_USD",
      DEFAULT_CONFIG.treasuryBalanceDisplay,
    ),
    ...overrides,
  };
}

function recordsExecutedInLast24Hours(
  records: StoredPaymentRecord[],
  now: Date,
): StoredPaymentRecord[] {
  const end = now.getTime();
  const start = end - 24 * 60 * 60 * 1_000;
  return records.filter((record) => {
    const executedAt = Date.parse(record.execution.executed_at);
    return (
      record.execution.status === "EXECUTED" &&
      executedAt > start &&
      executedAt <= end
    );
  });
}

export function buildMockExecution(
  intentId: string,
  now: Date,
  errorCode: string,
  message: string,
): ExecutionResult {
  return {
    intent_id: intentId,
    status: "SKIPPED",
    error_code: errorCode,
    error_message: message,
    executed_at: now.toISOString(),
  };
}

export function buildMockSuccessfulExecution(
  intentId: string,
  now: Date,
): ExecutionResult {
  const txHash = createHash("sha256")
    .update(`mock-execution:${intentId}:${now.toISOString()}`)
    .digest("hex");
  return {
    intent_id: intentId,
    status: "EXECUTED",
    tx_hash: `0x${txHash}`,
    error_code: "MOCK_CHAIN",
    error_message:
      "MOCK MODE: execution was simulated; no on-chain transaction was submitted.",
    executed_at: now.toISOString(),
  };
}

export function buildPolicyReceipt(opts: {
  invoice: Invoice;
  intent: PaymentIntent;
  decision: PolicyDecision;
  execution: ExecutionResult;
  vendor: Vendor | undefined;
  paymentNumber: number;
  sessionPermissionId: string;
  now: Date;
}): PolicyReceipt {
  const {
    invoice,
    intent,
    decision,
    execution,
    vendor,
    paymentNumber,
    sessionPermissionId,
    now,
  } = opts;
  const inputHash = createHash("sha256")
    .update(JSON.stringify(invoice))
    .digest("hex")
    .slice(0, 8);

  return {
    payment_id: `PV-${String(paymentNumber).padStart(4, "0")}`,
    input_hash: inputHash,
    invoice_id: intent.invoice_id,
    vendor_name: intent.vendor_name,
    verified_recipient: vendor?.verified_wallet ?? "",
    agent_proposed_recipient: intent.recipient,
    amount_display: intent.amount_display,
    policy_version: decision.policy_version,
    session_permission_id: sessionPermissionId,
    policy_verdict: decision.verdict,
    deny_reasons: decision.deny_reasons,
    human_approval:
      decision.verdict === "REVIEW"
        ? "PENDING"
        : "NOT_REQUIRED",
    execution,
    funds_moved_display:
      execution.status === "EXECUTED" ? intent.amount_display : 0,
    created_at: now.toISOString(),
  };
}

export function buildMockBlastRadius(
  vendors: Vendor[],
  records: StoredPaymentRecord[],
  now: Date,
  config: RuntimeConfig,
): BlastRadius {
  const executedInLast24Hours = recordsExecutedInLast24Hours(records, now);
  const spentInLast24Hours = executedInLast24Hours.reduce(
    (total, record) => total + record.receipt.funds_moved_display,
    0,
  );
  const totalSpent = records.reduce(
    (total, record) => total + record.receipt.funds_moved_display,
    0,
  );

  return {
    treasury_balance_display: Math.max(
      0,
      config.treasuryBalanceDisplay - totalSpent,
    ),
    max_per_tx_display: config.maxPerTxDisplay,
    max_per_24h_display: config.maxPer24hDisplay,
    remaining_24h_display: Math.max(
      0,
      config.maxPer24hDisplay - spentInLast24Hours,
    ),
    authorized_recipient_count: vendors.filter((vendor) => vendor.verified).length,
    unauthorized_recipient_exposure: 0,
    session_expires_at: config.sessionExpiresAt,
    session_remaining_seconds: Math.max(
      0,
      Math.floor((Date.parse(config.sessionExpiresAt) - now.getTime()) / 1_000),
    ),
    allowed_tokens: ["USDC"],
    allowed_actions: ["transfer"],
    source: "cached",
  };
}
