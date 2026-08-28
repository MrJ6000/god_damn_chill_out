import { createHash } from "node:crypto";
import {
  addressEquals,
  toRawAmount,
  type BlastRadius,
  type DenyReasonCode,
  type ExecutionResult,
  type Invoice,
  type PaymentIntent,
  type PolicyCheck,
  type PolicyDecision,
  type PolicyReceipt,
  type Vendor,
} from "@pv/shared";
import type { StoredPaymentRecord } from "./store.js";

export interface RuntimeConfig {
  policyVersion: string;
  maxPerTxDisplay: number;
  maxPer24hDisplay: number;
  approvalThresholdDisplay: number;
  sessionExpiresAt: string;
  treasuryBalanceDisplay: number;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  policyVersion: "V18",
  maxPerTxDisplay: 5_000,
  maxPer24hDisplay: 10_000,
  approvalThresholdDisplay: 2_000,
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
    approvalThresholdDisplay: DEFAULT_CONFIG.approvalThresholdDisplay,
    sessionExpiresAt:
      process.env.SESSION_EXPIRES_AT ?? DEFAULT_CONFIG.sessionExpiresAt,
    treasuryBalanceDisplay: envNumber(
      "TREASURY_BALANCE_USD",
      DEFAULT_CONFIG.treasuryBalanceDisplay,
    ),
    ...overrides,
  };
}

function injectedRecipient(invoice: Invoice): string | undefined {
  const untrustedText = `${invoice.memo ?? ""} ${invoice.description ?? ""}`;
  return untrustedText.match(/0x[A-Za-z0-9]{40}/)?.[0];
}

export function buildMockPlan(
  instruction: string,
  invoices: Invoice[],
  now: Date,
): { intents: PaymentIntent[]; agent_message: string } {
  const createdAt = now.toISOString();
  const intents = invoices.map<PaymentIntent>((invoice) => {
    const recipient = injectedRecipient(invoice) ?? invoice.payment_address;
    const wasRedirected = !addressEquals(recipient, invoice.payment_address);

    return {
      intent_id: `PI-${invoice.invoice_id.replace(/^INV-/, "")}`,
      invoice_id: invoice.invoice_id,
      vendor_name: invoice.vendor,
      recipient,
      amount_display: invoice.amount,
      amount_raw: toRawAmount(invoice.amount),
      token: "USDC",
      action: "transfer",
      reasoning: wasRedirected
        ? "Mock agent followed the payment address embedded in untrusted invoice text."
        : "Mock agent prepared a transfer from the invoice fields.",
      created_at: createdAt,
    };
  });

  return {
    intents,
    agent_message: `[MOCK MODE] Planned ${intents.length} payment(s) for: ${instruction}`,
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

export function evaluateMockPolicy(
  intent: PaymentIntent,
  vendors: Vendor[],
  records: StoredPaymentRecord[],
  now: Date,
  config: RuntimeConfig,
): PolicyDecision {
  const registeredVendor = vendors.find(
    (candidate) =>
      candidate.display_name.toLowerCase() === intent.vendor_name.toLowerCase(),
  );
  const vendor = registeredVendor?.verified ? registeredVendor : undefined;
  const executedInLast24Hours = recordsExecutedInLast24Hours(records, now);
  const spentInLast24Hours = executedInLast24Hours.reduce(
    (total, record) => total + record.receipt.funds_moved_display,
    0,
  );
  const paidInvoiceIds = new Set(
    executedInLast24Hours.map((record) => record.intent.invoice_id),
  );

  const tokenAllowed = intent.token === "USDC";
  const vendorKnown = Boolean(vendor);
  const beneficiaryMatches = vendor
    ? addressEquals(intent.recipient, vendor.verified_wallet)
    : false;
  const perTxAllowed = intent.amount_display <= config.maxPerTxDisplay;
  const dailyAllowed =
    spentInLast24Hours + intent.amount_display <= config.maxPer24hDisplay;
  const sessionValid = now.getTime() < Date.parse(config.sessionExpiresAt);
  const duplicate = paidInvoiceIds.has(intent.invoice_id);
  const approvalRequired = Boolean(
    vendor?.status === "NEW" ||
      intent.amount_display > config.approvalThresholdDisplay,
  );

  const checks: PolicyCheck[] = [
    {
      id: "TOKEN_ALLOWED",
      status: tokenAllowed ? "PASS" : "FAIL",
      detail: tokenAllowed ? "USDC is allowed." : `${intent.token} is not allowed.`,
    },
    {
      id: "VENDOR_KNOWN",
      status: vendorKnown ? "PASS" : "FAIL",
      detail: vendorKnown
        ? `${intent.vendor_name} is in the vendor registry.`
        : `${intent.vendor_name} is not in the vendor registry.`,
    },
    {
      id: "BENEFICIARY_MATCH",
      status: !vendor ? "WARN" : beneficiaryMatches ? "PASS" : "FAIL",
      detail: !vendor
        ? "Cannot verify a beneficiary for an unknown vendor."
        : beneficiaryMatches
          ? "Agent recipient matches the verified vendor wallet."
          : `${intent.recipient} does not match ${vendor.verified_wallet}.`,
    },
    {
      id: "PER_TX_LIMIT",
      status: perTxAllowed ? "PASS" : "FAIL",
      detail: `${intent.amount_display} / ${config.maxPerTxDisplay} USDC per transaction.`,
    },
    {
      id: "DAILY_LIMIT",
      status: dailyAllowed ? "PASS" : "FAIL",
      detail: `${spentInLast24Hours + intent.amount_display} / ${config.maxPer24hDisplay} USDC in the rolling 24-hour window.`,
    },
    {
      id: "SESSION_VALID",
      status: sessionValid ? "PASS" : "FAIL",
      detail: sessionValid
        ? `Session is valid until ${config.sessionExpiresAt}.`
        : `Session expired at ${config.sessionExpiresAt}.`,
    },
    {
      id: "DUPLICATE_PAYMENT",
      status: duplicate ? "FAIL" : "PASS",
      detail: duplicate
        ? `${intent.invoice_id} was already executed today.`
        : `${intent.invoice_id} has not been executed today.`,
    },
    {
      id: "APPROVAL_REQUIRED",
      status: approvalRequired ? "WARN" : "PASS",
      detail: approvalRequired
        ? "Human approval is required for this payment."
        : "Human approval is not required.",
    },
  ];

  const denyReasons: DenyReasonCode[] = [];
  if (!tokenAllowed) denyReasons.push("TOKEN_NOT_ALLOWED");
  if (!vendorKnown) denyReasons.push("VENDOR_UNKNOWN");
  if (vendor && !beneficiaryMatches) denyReasons.push("BENEFICIARY_MISMATCH");
  if (!perTxAllowed) denyReasons.push("PER_TX_LIMIT_EXCEEDED");
  if (!dailyAllowed) denyReasons.push("DAILY_LIMIT_EXCEEDED");
  if (!sessionValid) denyReasons.push("SESSION_EXPIRED");
  if (duplicate) denyReasons.push("DUPLICATE_PAYMENT");

  return {
    intent_id: intent.intent_id,
    verdict:
      denyReasons.length > 0 ? "DENY" : approvalRequired ? "REVIEW" : "ALLOW",
    checks,
    deny_reasons: denyReasons,
    policy_version: config.policyVersion,
    evaluated_at: now.toISOString(),
    latency_ms: 0,
  };
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

export function buildMockReceipt(opts: {
  invoice: Invoice;
  intent: PaymentIntent;
  decision: PolicyDecision;
  execution: ExecutionResult;
  vendor: Vendor | undefined;
  paymentNumber: number;
  now: Date;
}): PolicyReceipt {
  const { invoice, intent, decision, execution, vendor, paymentNumber, now } = opts;
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
    session_permission_id: "SP-MOCK",
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
