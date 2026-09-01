import { describe, expect, it } from "vitest";
import {
  createDirectMockPlan,
  createInitialDemoState,
  parseDemoState,
  selectDecision,
  selectIntent,
  selectReceipt,
  selectVendor,
  serializeDemoState,
  type DemoState,
} from "./demoState";
import { createMockPaymentOutcome, mockDecisions, mockIntents, mockReceipts } from "./mockData";

describe("demo state persistence", () => {
  it("round-trips a complete plan without losing provenance or route IDs", () => {
    const state: DemoState = {
      ...createInitialDemoState(),
      plan: createDirectMockPlan(),
      scenario: "normal",
    };

    const restored = parseDemoState(serializeDemoState(state));

    expect(restored).toEqual(state);
    expect(restored?.plan?.source).toBe("mock");
    expect(restored?.plan?.intents[0]?.intent_id).toBe(mockIntents[0]?.intent_id);
  });

  it.each([
    ["missing storage", null],
    ["invalid JSON", "{"],
    ["unknown schema", JSON.stringify({ scenario: "idle", schemaVersion: 2 })],
    ["unknown scenario", JSON.stringify({ scenario: "other", schemaVersion: 1 })],
    ["invalid plan shape", JSON.stringify({ plan: { intents: {} }, scenario: "normal", schemaVersion: 1 })],
    ["invalid nested plan item", JSON.stringify({
      plan: {
        decisions: [],
        intents: [null],
        invoices: [],
        notices: [],
        source: "api",
        vendors: [],
      },
      scenario: "normal",
      schemaVersion: 1,
    })],
    ["invalid plan provenance", JSON.stringify({
      plan: {
        decisions: [],
        intents: [],
        invoices: [],
        notices: [],
        source: "onchain",
        vendors: [],
      },
      scenario: "normal",
      schemaVersion: 1,
    })],
    ["invalid attack shape", JSON.stringify({ attack: [], scenario: "direct-bypass", schemaVersion: 1 })],
  ])("returns null for %s", (_label, raw) => {
    expect(parseDemoState(raw)).toBeNull();
  });
});

describe("demo route selectors", () => {
  it("uses exact stored IDs before consulting the mock catalog", () => {
    const liveIntent = { ...mockIntents[0], intent_id: "PI-LIVE-001" };
    const liveDecision = { ...mockDecisions[0], intent_id: liveIntent.intent_id };
    const plan = {
      ...createDirectMockPlan(),
      decisions: [liveDecision],
      intents: [liveIntent],
      source: "api" as const,
    };
    const state: DemoState = {
      ...createInitialDemoState(),
      plan,
      scenario: "normal",
    };

    expect(selectIntent(state, liveIntent.intent_id)).toBe(liveIntent);
    expect(selectDecision(state, liveIntent.intent_id)).toBe(liveDecision);
  });

  it("returns undefined for unknown intent, decision, and receipt IDs", () => {
    const state = createInitialDemoState();

    expect(selectIntent(state, "PI-NOT-FOUND")).toBeUndefined();
    expect(selectDecision(state, "PI-NOT-FOUND")).toBeUndefined();
    expect(selectReceipt(state, "PV-NOT-FOUND")).toBeUndefined();
  });

  it("selects an exact stored receipt instead of a same-position mock receipt", () => {
    const outcome = createMockPaymentOutcome(mockIntents[0], mockDecisions[0]);
    const storedReceipt = { ...outcome.receipt, payment_id: "PV-LIVE-7777" };
    const state: DemoState = {
      ...createInitialDemoState(),
      execution: {
        cachedDemoRecords: [],
        notices: [],
        records: [{ ...outcome, receipt: storedReceipt, source: "api" }],
        source: "api",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      scenario: "normal",
    };

    expect(selectReceipt(state, storedReceipt.payment_id)).toBe(storedReceipt);
    expect(selectReceipt(state, mockReceipts[0].payment_id)).toBe(mockReceipts[0]);
  });

  it("matches API vendors case-insensitively but never treats an unverified vendor as trusted", () => {
    const plan = createDirectMockPlan();
    plan.source = "api";
    plan.vendors = [{ ...plan.vendors[0], display_name: "abc cloud" }];
    const state: DemoState = {
      ...createInitialDemoState(),
      plan,
      scenario: "normal",
    };

    expect(selectVendor(state, "ABC Cloud")?.vendor_id).toBe(plan.vendors[0].vendor_id);

    plan.vendors = [{ ...plan.vendors[0], display_name: "ABC Cloud", verified: false }];
    expect(selectVendor(state, "ABC Cloud")).toBeUndefined();
    expect(selectVendor(state, "Northwind Logistics")).toBeUndefined();
  });
});
