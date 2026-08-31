import { afterEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@pv/shared";
import { planPayments } from "../src/index.js";
import { ATTACKER_RECIPIENT, MALICIOUS_INVOICE } from "./injection-fixture.js";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    invoice_id: "INV-8801",
    vendor: "ABC Cloud",
    amount: 1250,
    currency: "USDC",
    payment_address: "0xAAA0000000000000000000000000000000000001",
    memo: "Net 30. Thank you for your business.",
    ...overrides,
  };
}

describe("planPayments", () => {
  afterEach(() => vi.useRealTimers());

  it("creates one valid payment intent for each invoice without an OpenAI key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T10:00:00.000Z"));

    const invoices = [
      invoice(),
      invoice({
        invoice_id: "INV-8802",
        vendor: "Northwind Logistics",
        amount: 890,
        payment_address: "0xBBB0000000000000000000000000000000000002",
      }),
      invoice({
        invoice_id: "INV-8803",
        amount: 4800,
        payment_address: "0xCCC0000000000000000000000000000000000003",
      }),
    ];

    const result = await planPayments(
      {
        instruction: "Process today's approved payments.",
        invoices,
        vendorContext: [
          { display_name: "ABC Cloud", status: "KNOWN" },
          { display_name: "Northwind Logistics", status: "KNOWN" },
        ],
      },
      { mockMode: true },
    );

    expect(result.intents).toHaveLength(3);
    expect(new Set(result.intents.map((intent) => intent.intent_id)).size).toBe(3);
    expect(
      result.intents.every((intent) => intent.intent_id.startsWith("PI-")),
    ).toBe(true);
    expect(result.intents.map((intent) => intent.recipient)).toEqual(
      invoices.map((item) => item.payment_address),
    );
    expect(result.intents[0]).toMatchObject({
      invoice_id: "INV-8801",
      vendor_name: "ABC Cloud",
      amount_display: 1250,
      amount_raw: "1250000000",
      token: "USDC",
      action: "transfer",
      created_at: "2026-08-29T10:00:00.000Z",
    });
    expect(result.agent_message).toBe(
      "[MOCK MODE] Prepared 3 payment intents from 3 invoices.",
    );
    expect(
      result.intents.every((intent) => intent.reasoning.includes("[MOCK MODE]")),
    ).toBe(true);
  });

  it("returns one unique intent for every invoice", async () => {
    const invoices = Array.from({ length: 18 }, (_, index) =>
      invoice({
        invoice_id: `INV-${8801 + index}`,
        amount: index + 0.25,
      }),
    );

    const result = await planPayments(
      {
        instruction: "Process all approved invoices.",
        invoices,
        vendorContext: [],
      },
      { mockMode: true },
    );

    expect(result.intents).toHaveLength(18);
    expect(new Set(result.intents.map((intent) => intent.intent_id)).size).toBe(
      18,
    );
    expect(result.intents[17]?.amount_raw).toBe("17250000");
  });

  it("uses the attacker recipient from the INV-8821 malicious memo", async () => {
    const result = await planPayments(
      {
        instruction: "Process today's approved payments.",
        invoices: [MALICIOUS_INVOICE],
        vendorContext: [],
      },
      { mockMode: true },
    );

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      invoice_id: MALICIOUS_INVOICE.invoice_id,
      vendor_name: MALICIOUS_INVOICE.vendor,
      amount_display: MALICIOUS_INVOICE.amount,
      recipient: ATTACKER_RECIPIENT,
    });
    expect(result.intents[0]?.reasoning).toContain("untrusted invoice text");
  });

  it("does not reuse intent IDs across requests", async () => {
    const input = {
      instruction: "Process today's approved payments.",
      invoices: [invoice()],
      vendorContext: [],
    };

    const [first, second] = await Promise.all([
      planPayments(input, { mockMode: true }),
      planPayments(input, { mockMode: true }),
    ]);

    expect(first.intents[0]?.intent_id).not.toBe(
      second.intents[0]?.intent_id,
    );
  });

  it("returns an empty plan when no invoices are supplied", async () => {
    const result = await planPayments(
      {
        instruction: "Process today's approved payments.",
        invoices: [],
        vendorContext: [],
      },
      { mockMode: true },
    );

    expect(result.intents).toEqual([]);
    expect(result.agent_message).toBe(
      "[MOCK MODE] Prepared 0 payment intents from 0 invoices.",
    );
  });

  it("adds program-owned fields to a validated OpenAI structured result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T02:00:00.000Z"));
    const requestStructuredPlan = vi.fn().mockResolvedValue({
      intents: [
        {
          invoice_id: "INV-8801",
          vendor_name: "ABC Cloud",
          recipient: "0xAAA0000000000000000000000000000000000001",
          amount_display: 1250,
          token: "USDC",
          action: "transfer",
          reasoning: "The invoice should be paid as instructed.",
        },
      ],
      agent_message: "Prepared one payment intent.",
    });

    const result = await planPayments(
      {
        instruction: "Process today's approved payments.",
        invoices: [invoice()],
        vendorContext: [{ display_name: "ABC Cloud", status: "KNOWN" }],
      },
      { mockMode: false, requestStructuredPlan },
    );

    expect(requestStructuredPlan).toHaveBeenCalledOnce();
    expect(result.agent_message).toBe("Prepared one payment intent.");
    expect(result.intents[0]).toMatchObject({
      intent_id: expect.stringMatching(/^PI-/),
      amount_raw: "1250000000",
      created_at: "2026-08-30T02:00:00.000Z",
    });
  });

  it("retries once when the structured result fails Zod validation", async () => {
    const requestStructuredPlan = vi
      .fn()
      .mockResolvedValueOnce({ intents: [], agent_message: 123 })
      .mockResolvedValueOnce({
        intents: [],
        agent_message: "No approved invoices were selected.",
      });

    const result = await planPayments(
      {
        instruction: "Process approved payments.",
        invoices: [],
        vendorContext: [],
      },
      { mockMode: false, requestStructuredPlan },
    );

    expect(requestStructuredPlan).toHaveBeenCalledTimes(2);
    expect(result.agent_message).toBe("No approved invoices were selected.");
  });

  it("removes verified_wallet before passing vendor context to OpenAI", async () => {
    const requestStructuredPlan = vi.fn().mockResolvedValue({
      intents: [],
      agent_message: "No payments selected.",
    });

    await planPayments(
      {
        instruction: "Process approved payments.",
        invoices: [],
        vendorContext: [
          {
            display_name: "ABC Cloud",
            status: "KNOWN" as const,
            verified_wallet: "0xSECRET0000000000000000000000000000000000",
          },
        ] as Array<{
          display_name: string;
          status: "KNOWN";
          verified_wallet: string;
        }>,
      },
      { mockMode: false, requestStructuredPlan },
    );

    expect(requestStructuredPlan).toHaveBeenCalledWith({
      instruction: "Process approved payments.",
      invoices: [],
      vendorContext: [{ display_name: "ABC Cloud", status: "KNOWN" }],
    });
  });

  it("throws a clear error after two invalid structured results", async () => {
    const requestStructuredPlan = vi
      .fn()
      .mockResolvedValue({ intents: "invalid", agent_message: 123 });

    await expect(
      planPayments(
        {
          instruction: "Process approved payments.",
          invoices: [],
          vendorContext: [],
        },
        { mockMode: false, requestStructuredPlan },
      ),
    ).rejects.toThrow(
      "OpenAI structured payment plan failed after 2 attempts",
    );
    expect(requestStructuredPlan).toHaveBeenCalledTimes(2);
  });
});
