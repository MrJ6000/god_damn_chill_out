import { describe, expect, it } from "vitest";
import type { PaymentIntent, PolicyDecision, Vendor } from "@pv/shared";
import { evaluate, type PolicyContext } from "./index.js";

const NOW = new Date("2026-08-28T08:00:00.000Z");
const ATTACKER_RECIPIENT = "0x8888888888888888888888888888888888888888";

const knownVendor: Vendor = {
  vendor_id: "vendor-abc",
  display_name: "ABC Cloud",
  verified_wallet: "0xAAA000",
  verified: true,
  status: "KNOWN",
  created_at: "2026-01-01T00:00:00.000Z",
};

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    intent_id: "intent-001",
    invoice_id: "invoice-001",
    vendor_name: "ABC Cloud",
    recipient: "0xAAA000",
    amount_display: 1500,
    amount_raw: "1500000000",
    token: "USDC",
    action: "transfer",
    reasoning: "Pay approved invoice",
    created_at: "2026-08-28T07:59:00.000Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    vendors: [knownVendor],
    todaySpentDisplay: 1000,
    paidInvoiceIdsToday: [],
    sessionExpiresAt: "2026-08-28T09:00:00.000Z",
    maxPerTxDisplay: 5000,
    maxPer24hDisplay: 10000,
    allowedTokens: ["USDC"],
    policyVersion: "policy-v1",
    now: NOW,
    ...overrides,
  };
}

function stableDecision(decision: PolicyDecision): Omit<PolicyDecision, "latency_ms" | "evaluated_at"> {
  const { latency_ms: _latency, evaluated_at: _evaluatedAt, ...stable } = decision;
  return stable;
}

describe("evaluate", () => {
  it("allows a normal payment", () => {
    const decision = evaluate(makeIntent(), makeContext());

    expect(decision.verdict).toBe("ALLOW");
    expect(decision.deny_reasons).toEqual([]);
  });

  it("denies a recipient replaced with the attacker wallet", () => {
    const decision = evaluate(makeIntent({ recipient: ATTACKER_RECIPIENT }), makeContext());

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("BENEFICIARY_MISMATCH");
    expect(decision.checks[2].detail).toContain("does not match verified wallet");
  });

  it("denies amount 5001 when the per-transaction limit is 5000", () => {
    const decision = evaluate(makeIntent({ amount_display: 5001 }), makeContext());

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("PER_TX_LIMIT_EXCEEDED");
  });

  it("denies spending 3000 after 8000 was already spent today", () => {
    const decision = evaluate(
      makeIntent({ amount_display: 3000 }),
      makeContext({ todaySpentDisplay: 8000 }),
    );

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("denies an unknown vendor", () => {
    const decision = evaluate(makeIntent({ vendor_name: "Unknown LLC" }), makeContext());

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("VENDOR_UNKNOWN");
  });

  it("denies an expired session", () => {
    const decision = evaluate(
      makeIntent(),
      makeContext({ sessionExpiresAt: "2026-08-28T07:59:59.999Z" }),
    );

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("SESSION_EXPIRED");
  });

  it("denies an invoice already paid today", () => {
    const decision = evaluate(
      makeIntent(),
      makeContext({ paidInvoiceIdsToday: ["invoice-001"] }),
    );

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("DUPLICATE_PAYMENT");
  });

  it("reviews a 1500 payment to a new vendor", () => {
    const newVendor = { ...knownVendor, status: "NEW" as const };
    const decision = evaluate(makeIntent(), makeContext({ vendors: [newVendor] }));

    expect(decision.verdict).toBe("REVIEW");
    expect(decision.checks[7].status).toBe("WARN");
  });

  it("reviews a 2500 payment to a known vendor", () => {
    const decision = evaluate(makeIntent({ amount_display: 2500 }), makeContext());

    expect(decision.verdict).toBe("REVIEW");
    expect(decision.checks[7].status).toBe("WARN");
  });

  it("matches recipient addresses case-insensitively", () => {
    const decision = evaluate(makeIntent({ recipient: "0xaaa000" }), makeContext());

    expect(decision.verdict).toBe("ALLOW");
    expect(decision.checks[2].status).toBe("PASS");
  });

  it("denies when USDC is absent from the allowed token list", () => {
    const decision = evaluate(makeIntent(), makeContext({ allowedTokens: ["DAI"] }));

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("TOKEN_NOT_ALLOWED");
  });

  it("accepts an amount exactly equal to the per-transaction limit", () => {
    const decision = evaluate(makeIntent({ amount_display: 5000 }), makeContext());

    expect(decision.checks[3].status).toBe("PASS");
    expect(decision.deny_reasons).not.toContain("PER_TX_LIMIT_EXCEEDED");
  });

  it("accepts projected daily spending exactly equal to the daily limit", () => {
    const decision = evaluate(
      makeIntent({ amount_display: 3000 }),
      makeContext({ todaySpentDisplay: 7000 }),
    );

    expect(decision.checks[4].status).toBe("PASS");
    expect(decision.deny_reasons).not.toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("treats a session expiring exactly now as expired", () => {
    const decision = evaluate(
      makeIntent(),
      makeContext({ sessionExpiresAt: NOW.toISOString() }),
    );

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("SESSION_EXPIRED");
  });

  it("collects every failure reason in rule order", () => {
    const decision = evaluate(
      makeIntent({ recipient: ATTACKER_RECIPIENT, amount_display: 5001 }),
      makeContext({
        allowedTokens: [],
        todaySpentDisplay: 9000,
        sessionExpiresAt: "2026-08-28T07:00:00.000Z",
        paidInvoiceIdsToday: ["invoice-001"],
      }),
    );

    expect(decision.deny_reasons).toEqual([
      "TOKEN_NOT_ALLOWED",
      "BENEFICIARY_MISMATCH",
      "PER_TX_LIMIT_EXCEEDED",
      "DAILY_LIMIT_EXCEEDED",
      "SESSION_EXPIRED",
      "DUPLICATE_PAYMENT",
    ]);
  });

  it("always returns all eight checks after early failures", () => {
    const decision = evaluate(makeIntent(), makeContext({ allowedTokens: [] }));

    expect(decision.checks).toHaveLength(8);
    expect(decision.checks[0].status).toBe("FAIL");
    expect(decision.checks[7]).toBeDefined();
  });

  it("returns checks in the required order", () => {
    const decision = evaluate(makeIntent(), makeContext());

    expect(decision.checks.map((check) => check.id)).toEqual([
      "TOKEN_ALLOWED",
      "VENDOR_KNOWN",
      "BENEFICIARY_MATCH",
      "PER_TX_LIMIT",
      "DAILY_LIMIT",
      "SESSION_VALID",
      "DUPLICATE_PAYMENT",
      "APPROVAL_REQUIRED",
    ]);
  });

  it("uses NA for beneficiary matching when the vendor is unknown", () => {
    const decision = evaluate(makeIntent({ vendor_name: "Unknown LLC" }), makeContext());

    expect(decision.checks[2].status).toBe("NA");
    expect(decision.deny_reasons).toEqual(["VENDOR_UNKNOWN"]);
  });

  it("lets a denial override an approval review", () => {
    const decision = evaluate(
      makeIntent({ recipient: ATTACKER_RECIPIENT, amount_display: 2500 }),
      makeContext(),
    );

    expect(decision.verdict).toBe("DENY");
    expect(decision.checks[7].status).toBe("WARN");
  });

  it("reports both approval reasons for a high-value new-vendor payment", () => {
    const newVendor = { ...knownVendor, status: "NEW" as const };
    const decision = evaluate(
      makeIntent({ amount_display: 2500 }),
      makeContext({ vendors: [newVendor] }),
    );

    expect(decision.verdict).toBe("REVIEW");
    expect(decision.checks[7].detail).toContain("vendor ABC Cloud is NEW");
    expect(decision.checks[7].detail).toContain("amount 2500 exceeds 2000");
  });

  it("does not require approval at exactly 2000 for a known vendor", () => {
    const decision = evaluate(makeIntent({ amount_display: 2000 }), makeContext());

    expect(decision.verdict).toBe("ALLOW");
    expect(decision.checks[7].status).toBe("PASS");
  });

  it("fails an invalid session expiration timestamp safely", () => {
    const decision = evaluate(makeIntent(), makeContext({ sessionExpiresAt: "not-a-date" }));

    expect(decision.verdict).toBe("DENY");
    expect(decision.deny_reasons).toContain("SESSION_EXPIRED");
  });

  it("copies intent and policy identifiers into the decision", () => {
    const decision = evaluate(
      makeIntent({ intent_id: "intent-xyz" }),
      makeContext({ policyVersion: "policy-v42" }),
    );

    expect(decision.intent_id).toBe("intent-xyz");
    expect(decision.policy_version).toBe("policy-v42");
    expect(decision.evaluated_at).toBe(NOW.toISOString());
  });

  it("records a non-negative measured latency", () => {
    const decision = evaluate(makeIntent(), makeContext());

    expect(decision.latency_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(decision.latency_ms)).toBe(true);
  });

  it("is deterministic across 100 calls after excluding timing metadata", () => {
    const intent = makeIntent();
    const context = makeContext();
    const expected = JSON.stringify(stableDecision(evaluate(intent, context)));

    for (let call = 0; call < 100; call += 1) {
      expect(JSON.stringify(stableDecision(evaluate(intent, context)))).toBe(expected);
    }
  });
});
