import type { ExecutionResult, PaymentIntent, PolicyDecision } from "@pv/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError, type DemoApi } from "./api";
import {
  buildCompromisedPlan,
  buildNormalPlan,
  executeApproved,
  loadBlastRadius,
  runDirectBypass,
  selectReceiptForNavigation,
  type ExecutionScene,
  type PlanScene,
} from "./demoWorkflow";
import {
  attackerAddress,
  createMockPaymentOutcome,
  mockBlastRadius,
  mockDecisions,
  mockDirectBypass,
  mockInvoices,
  mockIntents,
  mockReceipts,
  mockVendors,
} from "./mockData";

function createClient(overrides: Partial<DemoApi> = {}): DemoApi {
  const defaults: DemoApi = {
    approvePayment: async () => mockReceipts[16],
    createPlan: async () => ({ agent_message: "test plan", intents: mockIntents }),
    directBypass: async () => mockDirectBypass,
    evaluatePolicy: async (intent) => decisionFor(intent),
    executePayment: async (intent, decision) => createMockPaymentOutcome(intent, decision),
    getBlastRadius: async () => mockBlastRadius,
    getInvoices: async () => mockInvoices,
    getReceipt: async () => mockReceipts[0],
    getReceipts: async () => mockReceipts,
    getVendors: async () => mockVendors,
  };

  return { ...defaults, ...overrides };
}

function liveIntents(): PaymentIntent[] {
  return mockIntents.map((intent) => ({
    ...intent,
    intent_id: `PI-LIVE-${intent.invoice_id}`,
  }));
}

function decisionFor(intent: PaymentIntent): PolicyDecision {
  const index = mockIntents.findIndex((candidate) => candidate.invoice_id === intent.invoice_id);
  const template = mockDecisions[index];
  if (!template) throw new Error(`Missing decision fixture for ${intent.invoice_id}`);
  return { ...template, intent_id: intent.intent_id };
}

function livePlan(): PlanScene {
  const intents = liveIntents();
  return {
    agentMessage: "live plan",
    decisions: intents.map(decisionFor),
    intents,
    invoices: mockInvoices,
    notices: [],
    scenario: "normal",
    source: "api",
    updatedAt: "2026-09-01T00:00:00.000Z",
    vendors: mockVendors,
  };
}

describe("normal and compromised planning", () => {
  it("builds the complete API plan with the canonical 16/1/1 verdict split", async () => {
    const intents = liveIntents();
    const evaluatePolicy = vi.fn(async (intent: PaymentIntent) => decisionFor(intent));
    const client = createClient({
      createPlan: async () => ({ agent_message: "live agent", intents }),
      evaluatePolicy,
    });

    const scene = await buildNormalPlan(client);
    const verdicts = scene.decisions.reduce<Record<string, number>>((counts, decision) => {
      counts[decision.verdict] = (counts[decision.verdict] ?? 0) + 1;
      return counts;
    }, {});

    expect(scene.source).toBe("api");
    expect(scene.intents).toHaveLength(18);
    expect(verdicts).toEqual({ ALLOW: 16, DENY: 1, REVIEW: 1 });
    expect(evaluatePolicy).toHaveBeenCalledTimes(18);
    expect(scene.decisions.map((decision) => decision.intent_id)).toEqual(
      scene.intents.map((intent) => intent.intent_id),
    );
  });

  it("atomically replaces a partially evaluated live plan with one coherent mock scene", async () => {
    const intents = liveIntents();
    const client = createClient({
      createPlan: async () => ({ agent_message: "live agent", intents }),
      evaluatePolicy: async (intent) => {
        if (intent.invoice_id === "INV-8817") {
          throw new ApiClientError("POLICY_UNAVAILABLE", "policy unavailable", 503);
        }
        return decisionFor(intent);
      },
    });

    const scene = await buildNormalPlan(client);

    expect(scene.source).toBe("mock");
    expect(scene.notices[0]).toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
    expect(scene.intents.map((intent) => intent.intent_id)).toEqual(
      mockIntents.map((intent) => intent.intent_id),
    );
    expect(scene.decisions.every((decision) => (
      scene.intents.some((intent) => intent.intent_id === decision.intent_id)
    ))).toBe(true);
    expect(scene.intents.some((intent) => intent.intent_id.startsWith("PI-LIVE-"))).toBe(false);
  });

  it("uses INV-8821 but keeps the API-generated compromised intent ID", async () => {
    const malicious = mockInvoices.find((invoice) => invoice.invoice_id === "INV-8821");
    if (!malicious) throw new Error("Missing malicious fixture");
    const intent = {
      ...mockIntents.find((candidate) => candidate.invoice_id === malicious.invoice_id)!,
      intent_id: "PI-RANDOM-FROM-AGENT",
    };
    const createPlan = vi.fn(async (_instruction: string, invoices: typeof mockInvoices) => ({
      agent_message: "compromised",
      intents: [intent],
    }));
    const client = createClient({
      createPlan,
      evaluatePolicy: async () => decisionFor(intent),
    });

    const scene = await buildCompromisedPlan(client);

    expect(scene.source).toBe("api");
    expect(scene.invoices.map((invoice) => invoice.invoice_id)).toEqual(["INV-8821"]);
    expect(scene.intents[0]?.intent_id).toBe(intent.intent_id);
    expect(scene.decisions[0]).toMatchObject({
      deny_reasons: ["BENEFICIARY_MISMATCH"],
      intent_id: intent.intent_id,
      verdict: "DENY",
    });
    expect(createPlan.mock.calls[0]?.[1]).toEqual([malicious]);
  });
});

describe("approved execution", () => {
  it("executes only the 16 ALLOW intents and never auto-submits REVIEW or DENY", async () => {
    const executePayment = vi.fn(async (intent: PaymentIntent, decision: PolicyDecision) => (
      createMockPaymentOutcome(intent, decision)
    ));

    const scene = await executeApproved(livePlan(), createClient({ executePayment }));
    const submittedInvoiceIds = executePayment.mock.calls.map(([intent]) => intent.invoice_id);

    expect(executePayment).toHaveBeenCalledTimes(16);
    expect(submittedInvoiceIds).not.toContain("INV-8817");
    expect(submittedInvoiceIds).not.toContain("INV-8821");
    expect(scene.source).toBe("api");
    expect(scene.records).toHaveLength(16);
  });

  it("submits approved payments sequentially to avoid overflowing the API write queue", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const executePayment = vi.fn(async (intent: PaymentIntent, decision: PolicyDecision) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return createMockPaymentOutcome(intent, decision);
    });

    await executeApproved(livePlan(), createClient({ executePayment }));

    expect(executePayment).toHaveBeenCalledTimes(16);
    expect(maxInFlight).toBe(1);
  });

  it("does not turn a failed live side effect into a navigable mock success", async () => {
    const firstAllowed = livePlan();
    firstAllowed.intents = [firstAllowed.intents[0]];
    firstAllowed.decisions = [firstAllowed.decisions[0]];
    const client = createClient({
      executePayment: async () => {
        throw new ApiClientError("CHAIN_BROADCAST_FAILED", "broadcast failed", 502);
      },
    });

    const scene = await executeApproved(firstAllowed, client);

    expect(scene.notices[0]).toMatchObject({ code: "CHAIN_BROADCAST_FAILED", status: 502 });
    expect(scene.records.some((record) => (
      record.source === "mock" && record.execution.status === "EXECUTED"
    ))).toBe(false);
    expect(selectReceiptForNavigation(scene)).toBeUndefined();
  });

  it("stops after an API execution failure and isolates the cached receipt from navigation", async () => {
    const plan = livePlan();
    plan.intents = plan.intents.slice(0, 3);
    plan.decisions = plan.decisions.slice(0, 3);
    const executePayment = vi.fn(async (intent: PaymentIntent, decision: PolicyDecision) => {
      if (intent.intent_id === plan.intents[1].intent_id) {
        throw new ApiClientError("CHAIN_BROADCAST_FAILED", "broadcast failed", 502);
      }
      return createMockPaymentOutcome(intent, decision);
    });

    const scene = await executeApproved(plan, createClient({ executePayment }));
    const cached = scene.cachedDemoRecords[0];
    const destination = selectReceiptForNavigation(scene);

    expect(executePayment).toHaveBeenCalledTimes(2);
    expect(scene.records).toHaveLength(1);
    expect(cached).toBeDefined();
    expect(cached?.receipt.payment_id).toMatch(/^CACHED-/);
    expect(scene.records).not.toContain(cached);
    expect(destination?.source).toBe("api");
    expect(destination).not.toBe(cached);
  });

  it("prefers real EXECUTED evidence over pending or mock receipts", () => {
    const mockRecord = {
      ...createMockPaymentOutcome(mockIntents[0], mockDecisions[0]),
      source: "mock" as const,
    };
    const pendingRecord = {
      ...createMockPaymentOutcome(mockIntents[1], mockDecisions[1]),
      execution: {
        ...createMockPaymentOutcome(mockIntents[1], mockDecisions[1]).execution,
        status: "PENDING" as const,
        tx_hash: undefined,
        user_op_hash: `0x${"b".repeat(64)}`,
      },
      source: "api" as const,
    };
    const executedRecord = {
      ...createMockPaymentOutcome(mockIntents[2], mockDecisions[2]),
      source: "api" as const,
    };
    const scene: ExecutionScene = {
      cachedDemoRecords: [],
      notices: [],
      records: [mockRecord, pendingRecord, executedRecord],
      source: "mixed",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    expect(selectReceiptForNavigation(scene)).toBe(executedRecord);
  });
});

describe("direct bypass and blast-radius provenance", () => {
  it("preserves a real rejected result and its chain evidence", async () => {
    const rejected: ExecutionResult = {
      block_number: 123,
      error_code: "POLICY_MODULE_DENIED",
      error_message: "reverted",
      executed_at: "2026-09-01T00:00:00.000Z",
      intent_id: "PI-DIRECT-BYPASS",
      status: "REJECTED",
      tx_hash: `0x${"a".repeat(64)}`,
    };

    const scene = await runDirectBypass(createClient({ directBypass: async () => rejected }));

    expect(scene).toMatchObject({
      execution: rejected,
      recipient: attackerAddress,
      source: "api",
    });
  });

  it("preserves PENDING as unresolved instead of claiming a final rejection", async () => {
    const pending: ExecutionResult = {
      executed_at: "2026-09-01T00:00:00.000Z",
      intent_id: "PI-DIRECT-BYPASS",
      status: "PENDING",
      user_op_hash: `0x${"b".repeat(64)}`,
    };

    const scene = await runDirectBypass(createClient({ directBypass: async () => pending }));

    expect(scene.source).toBe("api");
    expect(scene.execution).toEqual(pending);
    expect(scene.execution.status).not.toBe("REJECTED");
  });

  it("marks an HTTP failure as a skipped mock fallback, never an on-chain rejection", async () => {
    const scene = await runDirectBypass(createClient({
      directBypass: async () => {
        throw new ApiClientError("DIRECT_BYPASS_DISABLED", "disabled", 403);
      },
    }));

    expect(scene.source).toBe("mock");
    expect(scene.notice).toMatchObject({ code: "DIRECT_BYPASS_DISABLED", status: 403 });
    expect(scene.execution).toMatchObject({ error_code: "MOCK_CHAIN", status: "SKIPPED" });
  });

  it("keeps transport provenance separate from a cached blast-radius payload", async () => {
    const scene = await loadBlastRadius(createClient({ getBlastRadius: async () => mockBlastRadius }));

    expect(scene.source).toBe("api");
    expect(scene.data.source).toBe("cached");
  });
});
