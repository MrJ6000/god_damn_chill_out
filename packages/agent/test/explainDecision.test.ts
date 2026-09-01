import { describe, expect, it } from "vitest";
import type { PaymentIntent, PolicyDecision } from "@pv/shared";
import { explainDecision } from "../src/index.js";

const intent: PaymentIntent = {
  intent_id: "PI-001",
  invoice_id: "INV-8821",
  vendor_name: "ABC Cloud",
  recipient: "0x8888888888888888888888888888888888888888",
  amount_display: 4800,
  amount_raw: "4800000000",
  token: "USDC",
  action: "transfer",
  reasoning: "Invoice instructions requested this recipient.",
  created_at: "2026-09-01T08:00:00.000Z",
};

function decision(
  overrides: Partial<PolicyDecision> = {},
): PolicyDecision {
  return {
    intent_id: intent.intent_id,
    verdict: "ALLOW",
    checks: [],
    deny_reasons: [],
    policy_version: "policy-v1",
    evaluated_at: "2026-09-01T08:00:01.000Z",
    latency_ms: 1,
    ...overrides,
  };
}

describe("explainDecision", () => {
  it("explains an allowed payment without changing the policy result", async () => {
    await expect(explainDecision(intent, decision())).resolves.toBe(
      "Payment approved. 4800 USDC to ABC Cloud passed all checks under policy policy-v1.",
    );
  });

  it("explains that a reviewed payment still needs an authorized approver", async () => {
    const explanation = await explainDecision(
      intent,
      decision({ verdict: "REVIEW" }),
    );

    expect(explanation).toContain("Payment requires human review.");
    expect(explanation).toContain("needs an authorized approver");
    expect(explanation).toContain("No funds were moved automatically.");
  });

  it("turns a beneficiary mismatch into the human-readable Demo explanation", async () => {
    const explanation = await explainDecision(
      intent,
      decision({
        verdict: "DENY",
        deny_reasons: ["BENEFICIARY_MISMATCH"],
      }),
    );

    expect(explanation).toBe(
      "Payment blocked. The recipient address in this payment intent does not match the verified wallet on record for ABC Cloud. Only the verified vendor wallet is authorized. No funds were moved.",
    );
    expect(explanation).not.toContain("BENEFICIARY_MISMATCH");
  });

  it("explains every denial when more than one policy check failed", async () => {
    const explanation = await explainDecision(
      intent,
      decision({
        verdict: "DENY",
        deny_reasons: [
          "BENEFICIARY_MISMATCH",
          "DAILY_LIMIT_EXCEEDED",
          "DUPLICATE_PAYMENT",
        ],
      }),
    );

    expect(explanation).toContain("does not match the verified wallet");
    expect(explanation).toContain("24-hour spending limit");
    expect(explanation).toContain("Invoice INV-8821 has already been paid or is still pending.");
    expect(explanation).toMatch(/No funds were moved\.$/);
  });

  it("fails closed with a readable fallback when no denial reason is supplied", async () => {
    await expect(
      explainDecision(intent, decision({ verdict: "DENY" })),
    ).resolves.toBe(
      "Payment blocked. Policy policy-v1 did not authorize this payment. No funds were moved.",
    );
  });
});
