import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planPayments } from "@pv/agent";
import type {
  Invoice,
  PaymentIntent,
  PolicyCheck,
  PolicyDecision,
} from "@pv/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { RuntimeConfig } from "./mock.js";
import { evaluatePolicy } from "./policy.js";
import type { StoredPaymentRecord } from "./store.js";

const fixtureDataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const fixedNow = new Date("2026-08-28T08:00:00.000Z");
const attackerAddress = "0x1111111111111111111111111111111111111111";

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
}

const policyChecks: PolicyCheck[] = [
  "TOKEN_ALLOWED",
  "VENDOR_KNOWN",
  "BENEFICIARY_MATCH",
  "PER_TX_LIMIT",
  "DAILY_LIMIT",
  "SESSION_VALID",
  "DUPLICATE_PAYMENT",
  "APPROVAL_REQUIRED",
].map((id) => ({
  id: id as PolicyCheck["id"],
  status: "PASS",
  detail: "client",
}));

function clientDecision(intentId: string): PolicyDecision {
  return {
    intent_id: intentId,
    verdict: "ALLOW",
    checks: policyChecks,
    deny_reasons: [],
    policy_version: "CLIENT-TAMPERED",
    evaluated_at: fixedNow.toISOString(),
    latency_ms: 0,
  };
}

describe("PolicyVault mock API contract", () => {
  let dataDir: string | undefined;
  let server: Server | undefined;
  let baseUrl: string;
  let agentMockModes: Array<boolean | undefined>;

  beforeEach(async () => {
    agentMockModes = [];
    dataDir = await mkdtemp(path.join(tmpdir(), "pv-api-"));
    await Promise.all([
      copyFile(
        path.join(fixtureDataDir, "vendors.json"),
        path.join(dataDir, "vendors.json"),
      ),
      copyFile(
        path.join(fixtureDataDir, "invoices.json"),
        path.join(dataDir, "invoices.json"),
      ),
      writeFile(path.join(dataDir, "payments.json"), "[]\n", "utf8"),
    ]);

    const app = createApp({
      dataDir,
      now: () => new Date(fixedNow),
      mockAgent: true,
      mockChain: true,
      webOrigin: "http://localhost:3000",
      agentRuntime: {
        openAIConfigured: true,
        plan: async (input, options) => {
          agentMockModes.push(options?.mockMode);
          if (options?.mockMode !== true) {
            throw new Error("API mock tests must never call the real Agent.");
          }
          return planPayments(input, { mockMode: true });
        },
      },
      config: {
        policyVersion: "V18",
        maxPerTxDisplay: 5_000,
        maxPer24hDisplay: 10_000,
        sessionExpiresAt: "2026-09-07T23:59:00Z",
        treasuryBalanceDisplay: 2_000_000,
      },
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    server = undefined;
    dataDir = undefined;
  });

  async function get<T>(
    route: string,
  ): Promise<{ response: Response; body: ApiSuccess<T> | ApiFailure }> {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { Origin: "http://localhost:3000" },
    });
    return {
      response,
      body: (await response.json()) as ApiSuccess<T> | ApiFailure,
    };
  }

  async function post<T>(
    route: string,
    body: unknown,
  ): Promise<{ response: Response; body: ApiSuccess<T> | ApiFailure }> {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      response,
      body: (await response.json()) as ApiSuccess<T> | ApiFailure,
    };
  }

  async function invoices(): Promise<Invoice[]> {
    const result = await get<Invoice[]>("/api/invoices");
    if (!result.body.ok) throw new Error(result.body.error.message);
    return result.body.data;
  }

  async function plan(selectedInvoices: Invoice[]): Promise<PaymentIntent[]> {
    const result = await post<{
      intents: PaymentIntent[];
      agent_message: string;
    }>("/api/agent/plan", {
      instruction: "Pay approved invoices",
      invoices: selectedInvoices,
    });
    if (!result.body.ok) throw new Error(result.body.error.message);
    expect(result.body.data.agent_message).toContain("MOCK MODE");
    return result.body.data.intents;
  }

  it("serves health, vendors, invoices, CORS, and cached blast radius", async () => {
    const health = await get<{
      status: string;
      version: string;
      uptime_s: number;
    }>("/api/health");
    expect(health.response.status).toBe(200);
    expect(health.response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(health.body).toMatchObject({
      ok: true,
      data: { status: "ok", version: "0.1.0" },
    });

    const vendors = await get<unknown[]>("/api/vendors");
    expect(vendors.body.ok && vendors.body.data).toHaveLength(4);

    const invoiceList = await invoices();
    expect(invoiceList).toHaveLength(18);

    const blastRadius = await get<{
      source: string;
      treasury_balance_display: number;
      remaining_24h_display: number;
      authorized_recipient_count: number;
      unauthorized_recipient_exposure: number;
    }>("/api/blast-radius");
    expect(blastRadius.body).toMatchObject({
      ok: true,
      data: {
        source: "cached",
        treasury_balance_display: 2_000_000,
        remaining_24h_display: 10_000,
        authorized_recipient_count: 4,
        unauthorized_recipient_exposure: 0,
      },
    });
  });

  it("uses @pv/agent mock planning with unique PI ids and mode markers", async () => {
    const invoiceList = await invoices();
    const first = await post<{
      intents: PaymentIntent[];
      agent_message: string;
    }>("/api/agent/plan", {
      instruction: "Pay all approved invoices",
      invoices: invoiceList,
    });
    expect(first.response.status).toBe(200);
    if (!first.body.ok) throw new Error(first.body.error.message);

    expect(first.body.data.intents).toHaveLength(18);
    expect(first.body.data.agent_message).toContain("[MOCK MODE]");
    expect(first.body.data.intents.map((intent) => intent.invoice_id)).toEqual(
      invoiceList.map((invoice) => invoice.invoice_id),
    );
    expect(
      first.body.data.intents.every(
        (intent) =>
          intent.intent_id.startsWith("PI-") &&
          intent.reasoning.includes("[MOCK MODE]"),
      ),
    ).toBe(true);
    expect(
      new Set(first.body.data.intents.map((intent) => intent.intent_id)).size,
    ).toBe(18);

    const second = await post<{
      intents: PaymentIntent[];
      agent_message: string;
    }>("/api/agent/plan", {
      instruction: "Plan the first invoice again",
      invoices: [invoiceList[0]],
    });
    if (!second.body.ok) throw new Error(second.body.error.message);
    expect(second.body.data.intents[0].intent_id).not.toBe(
      first.body.data.intents[0].intent_id,
    );
    expect(agentMockModes).toEqual([true, true]);
  });

  it("plans the documented compromised intent and policy denies it", async () => {
    const maliciousInvoice = (await invoices()).find(
      (invoice) => invoice.invoice_id === "INV-8821",
    );
    expect(maliciousInvoice).toBeDefined();
    const [intent] = await plan([maliciousInvoice as Invoice]);
    expect(intent.recipient).toBe(
      "0xHACKER8888888888888888888888888888888888",
    );

    const result = await post<PolicyDecision>("/api/policy/evaluate", { intent });
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        intent_id: intent.intent_id,
        verdict: "DENY",
        deny_reasons: ["BENEFICIARY_MISMATCH"],
      },
    });
    if (!result.body.ok) throw new Error(result.body.error.message);
    expect(result.body.data.checks.map((check) => check.id)).toEqual([
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

  it("uses the deterministic policy engine for API evaluations", async () => {
    const [intent] = await plan([(await invoices())[0]]);
    const result = await post<PolicyDecision>("/api/policy/evaluate", {
      intent: { ...intent, vendor_name: "Unknown LLC" },
    });

    expect(result.body).toMatchObject({
      ok: true,
      data: {
        verdict: "DENY",
        deny_reasons: ["VENDOR_UNKNOWN"],
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "BENEFICIARY_MATCH",
            status: "NA",
          }),
        ]),
      },
    });
  });

  it("canonicalizes vendor name casing without changing the proposed recipient", async () => {
    const [plannedIntent] = await plan([(await invoices())[0]]);
    const intent = { ...plannedIntent, vendor_name: "abc cloud" };
    const evaluation = await post<PolicyDecision>("/api/policy/evaluate", {
      intent,
    });

    expect(evaluation.body).toMatchObject({
      ok: true,
      data: {
        verdict: "ALLOW",
        deny_reasons: [],
      },
    });

    const execution = await post<{
      receipt: {
        policy_verdict: string;
        agent_proposed_recipient: string;
      };
    }>("/api/payments/execute", {
      intent,
      decision: clientDecision(intent.intent_id),
    });
    expect(execution.body).toMatchObject({
      ok: true,
      data: {
        receipt: {
          policy_verdict: "ALLOW",
          agent_proposed_recipient: intent.recipient,
        },
      },
    });
  });

  it("produces the documented 16 ALLOW / 1 REVIEW / 1 DENY split", async () => {
    const intents = await plan(await invoices());
    const results = await Promise.all(
      intents.map((intent) =>
        post<PolicyDecision>("/api/policy/evaluate", { intent }),
      ),
    );
    const verdicts = results.map((result) => {
      if (!result.body.ok) throw new Error(result.body.error.message);
      return result.body.data.verdict;
    });

    expect(verdicts.filter((verdict) => verdict === "ALLOW")).toHaveLength(16);
    expect(verdicts.filter((verdict) => verdict === "REVIEW")).toHaveLength(1);
    expect(verdicts.filter((verdict) => verdict === "DENY")).toHaveLength(1);
  });

  it("simulates an allowed payment execution and clearly marks mock mode", async () => {
    const [intent] = await plan([(await invoices())[0]]);
    const result = await post<{
      execution: { status: string; error_code: string; error_message: string };
      receipt: { policy_verdict: string; funds_moved_display: number };
    }>("/api/payments/execute", {
      intent,
      decision: clientDecision(intent.intent_id),
    });

    expect(result.body).toMatchObject({
      ok: true,
      data: {
        execution: { status: "EXECUTED", error_code: "MOCK_CHAIN" },
        receipt: { policy_verdict: "ALLOW", funds_moved_display: 1_250 },
      },
    });
    expect(result.body.ok && result.body.data.execution.error_message).toContain(
      "MOCK MODE",
    );

    const approval = await post<unknown>(`/api/approvals/${intent.intent_id}`, {
      approve: true,
    });
    expect(approval.response.status).toBe(409);
    expect(approval.body).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_NOT_ALLOWED" },
    });
  });

  it("rejects inconsistent display and raw USDC amounts", async () => {
    const [intent] = await plan([(await invoices())[0]]);
    const result = await post<unknown>("/api/policy/evaluate", {
      intent: { ...intent, amount_raw: "999999999999999999" },
    });

    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("re-evaluates execution, persists receipts, and supports review approval", async () => {
    const allInvoices = await invoices();
    const maliciousInvoice = allInvoices.find(
      (invoice) => invoice.invoice_id === "INV-8821",
    ) as Invoice;
    const reviewInvoice = allInvoices.find(
      (invoice) => invoice.invoice_id === "INV-8817",
    ) as Invoice;
    const [maliciousIntent, reviewIntent] = await plan([
      maliciousInvoice,
      reviewInvoice,
    ]);

    const denied = await post<{
      execution: { status: string; error_code: string };
      receipt: {
        payment_id: string;
        input_hash: string;
        policy_verdict: string;
        verified_recipient: string;
        agent_proposed_recipient: string;
        funds_moved_display: number;
      };
    }>("/api/payments/execute", {
      intent: maliciousIntent,
      decision: clientDecision(maliciousIntent.intent_id),
    });
    expect(denied.body).toMatchObject({
      ok: true,
      data: {
        execution: { status: "SKIPPED", error_code: "POLICY_DENIED" },
        receipt: {
          policy_verdict: "DENY",
          verified_recipient: maliciousInvoice.payment_address,
          agent_proposed_recipient: maliciousIntent.recipient,
          funds_moved_display: 0,
        },
      },
    });
    if (!denied.body.ok) throw new Error(denied.body.error.message);
    const sourceInvoices = JSON.parse(
      await readFile(path.join(fixtureDataDir, "invoices.json"), "utf8"),
    ) as Invoice[];
    const originalInvoice = sourceInvoices.find(
      (invoice) => invoice.invoice_id === maliciousInvoice.invoice_id,
    ) as Invoice;
    const expectedInputHash = createHash("sha256")
      .update(JSON.stringify(originalInvoice))
      .digest("hex")
      .slice(0, 8);
    expect(denied.body.data.receipt.input_hash).toBe(expectedInputHash);

    const review = await post<{
      execution: { status: string };
      receipt: {
        payment_id: string;
        policy_verdict: string;
        human_approval: string;
      };
    }>("/api/payments/execute", {
      intent: reviewIntent,
      decision: clientDecision(reviewIntent.intent_id),
    });
    expect(review.body).toMatchObject({
      ok: true,
      data: {
        execution: { status: "SKIPPED" },
        receipt: { policy_verdict: "REVIEW", human_approval: "PENDING" },
      },
    });
    if (!review.body.ok) throw new Error(review.body.error.message);

    const receipts = await get<unknown[]>("/api/receipts");
    expect(receipts.body.ok && receipts.body.data).toHaveLength(2);

    const receipt = await get<unknown>(
      `/api/receipts/${review.body.data.receipt.payment_id}`,
    );
    expect(receipt.body).toMatchObject({
      ok: true,
      data: { payment_id: review.body.data.receipt.payment_id },
    });

    const approval = await post<unknown>(
      `/api/approvals/${reviewIntent.intent_id}`,
      { approve: true },
    );
    expect(approval.body).toMatchObject({
      ok: true,
      data: {
        human_approval: "APPROVED",
        policy_verdict: "REVIEW",
        execution: { status: "EXECUTED", error_code: "MOCK_CHAIN" },
        funds_moved_display: 1_500,
      },
    });

    const persisted = await get<unknown>(
      `/api/receipts/${review.body.data.receipt.payment_id}`,
    );
    expect(persisted.body).toMatchObject({
      ok: true,
      data: {
        human_approval: "APPROVED",
        execution: { status: "EXECUTED" },
        funds_moved_display: 1_500,
      },
    });
  });

  it("persists a rejected human review without simulating execution", async () => {
    const reviewInvoice = (await invoices()).find(
      (invoice) => invoice.invoice_id === "INV-8817",
    ) as Invoice;
    const [reviewIntent] = await plan([reviewInvoice]);
    await post("/api/payments/execute", {
      intent: reviewIntent,
      decision: clientDecision(reviewIntent.intent_id),
    });

    const rejection = await post<unknown>(
      `/api/approvals/${reviewIntent.intent_id}`,
      { approve: false },
    );
    expect(rejection.body).toMatchObject({
      ok: true,
      data: {
        human_approval: "REJECTED",
        policy_verdict: "REVIEW",
        execution: { status: "SKIPPED" },
        funds_moved_display: 0,
      },
    });
  });

  it("re-evaluates policy before an approved review can execute", async () => {
    if (!dataDir) throw new Error("Missing test data directory");
    const reviewInvoice = (await invoices()).find(
      (invoice) => invoice.invoice_id === "INV-8817",
    ) as Invoice;
    const [reviewIntent] = await plan([reviewInvoice]);
    const review = await post("/api/payments/execute", {
      intent: reviewIntent,
      decision: clientDecision(reviewIntent.intent_id),
    });
    expect(review.body).toMatchObject({
      ok: true,
      data: { receipt: { human_approval: "PENDING" } },
    });

    const paymentsPath = path.join(dataDir, "payments.json");
    const records = JSON.parse(
      await readFile(paymentsPath, "utf8"),
    ) as StoredPaymentRecord[];
    const priorExecution = {
      ...records[0],
      intent: {
        ...records[0].intent,
        intent_id: "PI-PRIOR-SPEND",
        invoice_id: "INV-PRIOR-SPEND",
        amount_display: 9_000,
        amount_raw: "9000000000",
      },
      decision: {
        ...records[0].decision,
        intent_id: "PI-PRIOR-SPEND",
      },
      execution: {
        ...records[0].execution,
        intent_id: "PI-PRIOR-SPEND",
        status: "EXECUTED" as const,
        tx_hash: `0x${"1".repeat(64)}`,
        error_code: "MOCK_CHAIN",
        executed_at: fixedNow.toISOString(),
      },
      receipt: {
        ...records[0].receipt,
        payment_id: "PV-PRIOR-SPEND",
        invoice_id: "INV-PRIOR-SPEND",
        amount_display: 9_000,
        human_approval: "APPROVED" as const,
        execution: {
          ...records[0].execution,
          intent_id: "PI-PRIOR-SPEND",
          status: "EXECUTED" as const,
          tx_hash: `0x${"1".repeat(64)}`,
          error_code: "MOCK_CHAIN",
          executed_at: fixedNow.toISOString(),
        },
        funds_moved_display: 9_000,
      },
    };
    records.push(priorExecution);
    await writeFile(paymentsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

    const approval = await post<unknown>(
      `/api/approvals/${reviewIntent.intent_id}`,
      { approve: true },
    );
    expect(approval.response.status).toBe(409);
    expect(approval.body).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_POLICY_CHANGED" },
    });

    const persisted = await get<unknown>("/api/receipts/PV-0001");
    expect(persisted.body).toMatchObject({
      ok: true,
      data: {
        human_approval: "PENDING",
        execution: { status: "SKIPPED" },
        funds_moved_display: 0,
      },
    });
  });

  it("rejects intent fields that do not match the original invoice", async () => {
    const [intent] = await plan([(await invoices())[0]]);
    const tamperedIntent = {
      ...intent,
      amount_display: 1,
      amount_raw: "1000000",
    };
    const result = await post<unknown>("/api/payments/execute", {
      intent: tamperedIntent,
      decision: clientDecision(intent.intent_id),
    });

    expect(result.response.status).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: "INTENT_INVOICE_MISMATCH" },
    });
    const receipts = await get<unknown[]>("/api/receipts");
    expect(receipts.body.ok && receipts.body.data).toHaveLength(0);
  });

  it("rejects a client decision for a different intent", async () => {
    const [intent] = await plan([(await invoices())[0]]);
    const result = await post<unknown>("/api/payments/execute", {
      intent,
      decision: clientDecision("PI-DIFFERENT"),
    });

    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    const receipts = await get<unknown[]>("/api/receipts");
    expect(receipts.body.ok && receipts.body.data).toHaveLength(0);
  });

  it("makes concurrent payment retries idempotent and rejects intent id reuse", async () => {
    const [intent] = await plan([(await invoices())[0]]);
    const payload = {
      intent,
      decision: clientDecision(intent.intent_id),
    };
    const [first, retry] = await Promise.all([
      post<{
        execution: { tx_hash?: string };
        receipt: { payment_id: string };
      }>("/api/payments/execute", payload),
      post<{
        execution: { tx_hash?: string };
        receipt: { payment_id: string };
      }>("/api/payments/execute", payload),
    ]);

    if (!first.body.ok) throw new Error(first.body.error.message);
    if (!retry.body.ok) throw new Error(retry.body.error.message);
    expect(retry.body.data.receipt.payment_id).toBe(
      first.body.data.receipt.payment_id,
    );
    expect(retry.body.data.execution.tx_hash).toBe(
      first.body.data.execution.tx_hash,
    );

    const conflict = await post<unknown>("/api/payments/execute", {
      intent: {
        ...intent,
        recipient: "0x1111111111111111111111111111111111111111",
      },
      decision: clientDecision(intent.intent_id),
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toMatchObject({
      ok: false,
      error: { code: "INTENT_ID_CONFLICT" },
    });

    const receipts = await get<unknown[]>("/api/receipts");
    expect(receipts.body.ok && receipts.body.data).toHaveLength(1);
  });

  it("keeps mock payment records isolated from real-chain mode", async () => {
    if (!dataDir) throw new Error("Missing test data directory");
    const [intent] = await plan([(await invoices())[0]]);
    const payload = {
      intent,
      decision: clientDecision(intent.intent_id),
    };
    const mockExecution = await post("/api/payments/execute", payload);
    expect(mockExecution.body).toMatchObject({ ok: true });

    const paymentsPath = path.join(dataDir, "payments.json");
    const legacyRecords = JSON.parse(
      await readFile(paymentsPath, "utf8"),
    ) as Array<Record<string, unknown>>;
    delete legacyRecords[0].execution_mode;
    await writeFile(
      paymentsPath,
      `${JSON.stringify(legacyRecords, null, 2)}\n`,
      "utf8",
    );
    const legacyReceipts = await get<unknown[]>("/api/receipts");
    expect(legacyReceipts.body.ok && legacyReceipts.body.data).toHaveLength(1);

    const [secondIntent] = await plan([(await invoices())[1]]);
    const migratedExecution = await post("/api/payments/execute", {
      intent: secondIntent,
      decision: clientDecision(secondIntent.intent_id),
    });
    expect(migratedExecution.body).toMatchObject({ ok: true });
    const migratedRecords = JSON.parse(
      await readFile(paymentsPath, "utf8"),
    ) as StoredPaymentRecord[];
    expect(
      migratedRecords.every((record) => record.execution_mode === "MOCK"),
    ).toBe(true);

    const realChainApp = createApp({
      dataDir,
      now: () => new Date(fixedNow),
      mockAgent: true,
      mockChain: false,
      webOrigin: "http://localhost:3000",
      config: {
        policyVersion: "V18",
        maxPerTxDisplay: 5_000,
        maxPer24hDisplay: 10_000,
        sessionExpiresAt: "2026-09-07T23:59:00Z",
        treasuryBalanceDisplay: 2_000_000,
      },
    });
    const realChainServer = realChainApp.listen(0);
    await new Promise<void>((resolve) =>
      realChainServer.once("listening", resolve),
    );
    const address = realChainServer.address();
    if (!address || typeof address === "string") {
      realChainServer.close();
      throw new Error("Missing real-chain test port");
    }
    const realChainUrl = `http://127.0.0.1:${address.port}`;

    try {
      const retry = await fetch(`${realChainUrl}/api/payments/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(retry.status).toBe(409);
      expect(await retry.json()).toMatchObject({
        ok: false,
        error: { code: "INTENT_MODE_CONFLICT" },
      });

      const [freshIntent] = await plan([(await invoices())[2]]);
      const unavailableExecution = await fetch(
        `${realChainUrl}/api/payments/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: freshIntent,
            decision: clientDecision(freshIntent.intent_id),
          }),
        },
      );
      expect(unavailableExecution.status).toBe(503);
      expect(await unavailableExecution.json()).toMatchObject({
        ok: false,
        error: { code: "CHAIN_INTEGRATION_NOT_READY" },
      });

      const realReceipts = await fetch(`${realChainUrl}/api/receipts`);
      expect(await realReceipts.json()).toMatchObject({
        ok: true,
        data: [],
      });
      const mockReceipts = await get<unknown[]>("/api/receipts");
      expect(mockReceipts.body.ok && mockReceipts.body.data).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        realChainServer.close((error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }
  });

  it("serializes concurrent payment writes without losing receipts or IDs", async () => {
    const normalInvoices = (await invoices()).filter((invoice) =>
      /^INV-88(?:0[1-9]|1[0-6])$/.test(invoice.invoice_id),
    );
    const intents = await plan(normalInvoices);
    const executions = await Promise.all(
      intents.map((intent) =>
        post<{ receipt: { payment_id: string } }>("/api/payments/execute", {
          intent,
          decision: clientDecision(intent.intent_id),
        }),
      ),
    );
    const paymentIds = executions.map((result) => {
      if (!result.body.ok) throw new Error(result.body.error.message);
      return result.body.data.receipt.payment_id;
    });

    expect(new Set(paymentIds).size).toBe(16);
    const receipts = await get<unknown[]>("/api/receipts");
    expect(receipts.body.ok && receipts.body.data).toHaveLength(16);

    const blastRadius = await get<{
      treasury_balance_display: number;
      remaining_24h_display: number;
      source: string;
    }>("/api/blast-radius");
    expect(blastRadius.body).toMatchObject({
      ok: true,
      data: {
        treasury_balance_display: 1_993_160,
        remaining_24h_display: 3_160,
        source: "cached",
      },
    });
  });

  it("marks direct bypass as mock SKIPPED instead of faking an on-chain rejection", async () => {
    const result = await post<{
      status: string;
      error_code: string;
      error_message: string;
    }>("/api/attack/direct-bypass", {
      recipient: attackerAddress,
      amount_display: 4_800,
    });
    expect(result.body).toMatchObject({
      ok: true,
      data: { status: "SKIPPED", error_code: "MOCK_CHAIN" },
    });
    expect(result.body.ok && result.body.data.error_message).toContain("MOCK MODE");
  });

  it("fails closed when real agent and chain integrations are requested but unavailable", async () => {
    if (!dataDir) throw new Error("Missing test data directory");
    let unavailableAgentCalled = false;
    const realModeApp = createApp({
      dataDir,
      now: () => new Date(fixedNow),
      mockAgent: false,
      mockChain: false,
      enableDirectBypass: true,
      expectedTokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      webOrigin: "http://localhost:3000",
      agentRuntime: {
        openAIConfigured: false,
        plan: async () => {
          unavailableAgentCalled = true;
          throw new Error("An unconfigured Agent must not be called.");
        },
      },
      config: {
        policyVersion: "V18",
        maxPerTxDisplay: 5_000,
        maxPer24hDisplay: 10_000,
        sessionExpiresAt: "2026-09-07T23:59:00Z",
        treasuryBalanceDisplay: 2_000_000,
      },
    });
    const realModeServer = realModeApp.listen(0);
    await new Promise<void>((resolve) =>
      realModeServer.once("listening", resolve),
    );
    const address = realModeServer.address();
    if (!address || typeof address === "string") {
      realModeServer.close();
      throw new Error("Missing real-mode test port");
    }
    const realModeUrl = `http://127.0.0.1:${address.port}`;

    try {
      const invoiceList = await invoices();
      const agentResponse = await fetch(`${realModeUrl}/api/agent/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: "Pay approved invoices",
          invoices: [invoiceList[0]],
        }),
      });
      expect(agentResponse.status).toBe(503);
      expect(await agentResponse.json()).toMatchObject({
        ok: false,
        error: { code: "AGENT_INTEGRATION_NOT_READY" },
      });
      expect(unavailableAgentCalled).toBe(false);

      const [normalIntent] = await plan([invoiceList[0]]);
      const executeResponse = await fetch(
        `${realModeUrl}/api/payments/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: normalIntent,
            decision: clientDecision(normalIntent.intent_id),
          }),
        },
      );
      expect(executeResponse.status).toBe(503);
      expect(await executeResponse.json()).toMatchObject({
        ok: false,
        error: { code: "CHAIN_INTEGRATION_NOT_READY" },
      });

      const bypassResponse = await fetch(
        `${realModeUrl}/api/attack/direct-bypass`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: attackerAddress,
            amount_display: 4_800,
          }),
        },
      );
      expect(bypassResponse.status).toBe(503);
      expect(await bypassResponse.json()).toMatchObject({
        ok: false,
        error: { code: "CHAIN_INTEGRATION_NOT_READY" },
      });

      const receipts = await get<unknown[]>("/api/receipts");
      expect(receipts.body.ok && receipts.body.data).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        realModeServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("uses the Smart Account runtime for confirmed real-chain operations", async () => {
    if (!dataDir) throw new Error("Missing test data directory");
    const invoiceList = await invoices();
    const maliciousInvoice = invoiceList.find(
      (invoice) => invoice.invoice_id === "INV-8821",
    ) as Invoice;
    const reviewInvoice = invoiceList.find(
      (invoice) => invoice.invoice_id === "INV-8817",
    ) as Invoice;
    const planned = await plan([
      invoiceList[0],
      invoiceList[1],
      maliciousInvoice,
      reviewInvoice,
    ]);
    const [allowedIntent, unconfirmedIntent, deniedIntent, reviewIntent] =
      planned;
    const minedHash = `0x${"a".repeat(64)}`;
    const rejectedHash = `0x${"b".repeat(64)}`;
    const executeTransfer = vi.fn(async (intent: PaymentIntent) => {
      if (intent.intent_id === unconfirmedIntent.intent_id) {
        return {
          intent_id: intent.intent_id,
          status: "REJECTED" as const,
          error_code: "RPC_ERROR",
          error_message: "test transport failure",
          executed_at: fixedNow.toISOString(),
        };
      }
      return {
        intent_id: intent.intent_id,
        status: "EXECUTED" as const,
        tx_hash: minedHash,
        user_op_hash: `0x${"c".repeat(64)}`,
        block_number: 123,
        explorer_url: `https://sepolia.basescan.org/tx/${minedHash}`,
        executed_at: fixedNow.toISOString(),
      };
    });
    const executeRawTransferWithSessionKey = vi.fn(async () => ({
      intent_id: "raw-bypass-test",
      status: "REJECTED" as const,
      tx_hash: rejectedHash,
      block_number: 124,
      explorer_url: `https://sepolia.basescan.org/tx/${rejectedHash}`,
      error_code: "NOT_AI_SESSION",
      error_message: "Rejected on-chain",
      executed_at: fixedNow.toISOString(),
    }));
    const readSessionPermission = vi.fn(async () => ({
      allowed_token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      max_per_tx_raw: "5000000000",
      max_per_24h_raw: "10000000000",
      remaining_24h_raw: "7250000000",
      expires_at: "2026-09-07T23:59:00Z",
      authorized_recipient_count: 4,
    }));

    const realApp = createApp({
      dataDir,
      now: () => new Date(fixedNow),
      mockAgent: true,
      mockChain: false,
      enableDirectBypass: true,
      expectedTokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      webOrigin: "http://localhost:3000",
      smartAccountRuntime: {
        sessionKeyOnly: true,
        sessionPermissionId: "ZERODEV-PERMISSION-TEST",
        executeTransfer,
        executeRawTransferWithSessionKey,
        readSessionPermission,
      },
      config: {
        policyVersion: "V18",
        maxPerTxDisplay: 5_000,
        maxPer24hDisplay: 10_000,
        sessionExpiresAt: "2026-09-07T23:59:00Z",
        treasuryBalanceDisplay: 2_000_000,
      },
    });
    const realServer = realApp.listen(0);
    await new Promise<void>((resolve) => realServer.once("listening", resolve));
    const address = realServer.address();
    if (!address || typeof address === "string") {
      realServer.close();
      throw new Error("Missing real-chain test port");
    }
    const realUrl = `http://127.0.0.1:${address.port}`;
    const realPost = (route: string, body: unknown) =>
      fetch(`${realUrl}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      const allowed = await realPost("/api/payments/execute", {
        intent: allowedIntent,
        decision: clientDecision(allowedIntent.intent_id),
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({
        ok: true,
        data: {
          execution: { status: "EXECUTED", tx_hash: minedHash },
          receipt: {
            policy_verdict: "ALLOW",
            human_approval: "NOT_REQUIRED",
            funds_moved_display: allowedIntent.amount_display,
          },
        },
      });

      const unconfirmed = await realPost("/api/payments/execute", {
        intent: unconfirmedIntent,
        decision: clientDecision(unconfirmedIntent.intent_id),
      });
      expect(unconfirmed.status).toBe(502);
      expect(await unconfirmed.json()).toMatchObject({
        ok: false,
        error: { code: "CHAIN_EXECUTION_UNCONFIRMED" },
      });

      const denied = await realPost("/api/payments/execute", {
        intent: deniedIntent,
        decision: clientDecision(deniedIntent.intent_id),
      });
      expect(denied.status).toBe(200);
      expect(await denied.json()).toMatchObject({
        ok: true,
        data: {
          execution: { status: "SKIPPED" },
          receipt: {
            policy_verdict: "DENY",
            human_approval: "NOT_REQUIRED",
          },
        },
      });

      const review = await realPost("/api/payments/execute", {
        intent: reviewIntent,
        decision: clientDecision(reviewIntent.intent_id),
      });
      expect(review.status).toBe(200);
      expect(await review.json()).toMatchObject({
        ok: true,
        data: {
          receipt: { policy_verdict: "REVIEW", human_approval: "PENDING" },
        },
      });
      const approval = await realPost(
        `/api/approvals/${reviewIntent.intent_id}`,
        { approve: true },
      );
      expect(approval.status).toBe(200);
      expect(await approval.json()).toMatchObject({
        ok: true,
        data: {
          human_approval: "APPROVED",
          session_permission_id: "ZERODEV-PERMISSION-TEST",
          execution: { status: "EXECUTED", tx_hash: minedHash },
        },
      });

      const bypass = await realPost("/api/attack/direct-bypass", {
        recipient: attackerAddress,
        amount_display: 4_800,
      });
      expect(bypass.status).toBe(200);
      expect(await bypass.json()).toMatchObject({
        ok: true,
        data: {
          status: "REJECTED",
          tx_hash: rejectedHash,
          error_code: "NOT_AI_SESSION",
        },
      });
      expect(executeRawTransferWithSessionKey).toHaveBeenCalledWith(
        attackerAddress,
        "4800000000",
      );

      const blastRadius = await fetch(`${realUrl}/api/blast-radius`);
      expect(blastRadius.status).toBe(200);
      expect(await blastRadius.json()).toMatchObject({
        ok: true,
        data: {
          source: "cached",
          max_per_tx_display: 5_000,
          max_per_24h_display: 10_000,
          remaining_24h_display: 7_250,
          authorized_recipient_count: 4,
          unauthorized_recipient_exposure: 0,
        },
      });

      const receiptResponse = await fetch(`${realUrl}/api/receipts`);
      const receiptBody = (await receiptResponse.json()) as ApiSuccess<
        Array<{ session_permission_id: string }>
      >;
      expect(receiptBody.ok).toBe(true);
      expect(receiptBody.data).toHaveLength(3);
      expect(
        receiptBody.data.every(
          (receipt) => receipt.session_permission_id !== "SP-MOCK",
        ),
      ).toBe(true);
      expect(executeTransfer).toHaveBeenCalledTimes(3);

      const mockReceipts = await get<unknown[]>("/api/receipts");
      expect(mockReceipts.body.ok && mockReceipts.body.data).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        realServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("validates direct-bypass recipients before a chain call", async () => {
    const result = await post<unknown>("/api/attack/direct-bypass", {
      recipient: "0xHACKER8888888888888888888888888888888888",
      amount_display: 4_800,
    });
    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("forwards explicit real mode to a configured Agent runtime", async () => {
    if (!dataDir) throw new Error("Missing test data directory");
    const receivedModes: Array<boolean | undefined> = [];
    const realModeApp = createApp({
      dataDir,
      now: () => new Date(fixedNow),
      mockAgent: false,
      mockChain: true,
      webOrigin: "http://localhost:3000",
      agentRuntime: {
        openAIConfigured: true,
        plan: async (input, options) => {
          receivedModes.push(options?.mockMode);
          const safePlan = await planPayments(input, { mockMode: true });
          return {
            intents: safePlan.intents.map((intent) => ({
              ...intent,
              reasoning: "Generated by the real Agent test double.",
            })),
            agent_message: "Prepared by the real Agent test double.",
          };
        },
      },
    });
    const realModeServer = realModeApp.listen(0);
    await new Promise<void>((resolve) =>
      realModeServer.once("listening", resolve),
    );
    const address = realModeServer.address();
    if (!address || typeof address === "string") {
      realModeServer.close();
      throw new Error("Missing real-mode test port");
    }

    try {
      const invoiceList = await invoices();
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/agent/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: "Pay approved invoices",
            invoices: [invoiceList[0]],
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        data: {
          agent_message: "Prepared by the real Agent test double.",
          intents: [
            {
              invoice_id: invoiceList[0].invoice_id,
              reasoning: "Generated by the real Agent test double.",
            },
          ],
        },
      });
      expect(receivedModes).toEqual([false]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        realModeServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("validates Agent output and sanitizes upstream failures", async () => {
    if (!dataDir) throw new Error("Missing test data directory");
    const controlledApp = createApp({
      dataDir,
      mockAgent: false,
      mockChain: true,
      agentRuntime: {
        openAIConfigured: true,
        plan: async (input) => {
          if (input.instruction === "Return invalid output") {
            return {
              intents: [],
              agent_message: 123,
            } as unknown as Awaited<ReturnType<typeof planPayments>>;
          }
          throw new Error("private upstream detail");
        },
      },
    });
    const controlledServer = controlledApp.listen(0);
    await new Promise<void>((resolve) =>
      controlledServer.once("listening", resolve),
    );
    const address = controlledServer.address();
    if (!address || typeof address === "string") {
      controlledServer.close();
      throw new Error("Missing controlled Agent test port");
    }
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const invoiceList = await invoices();
      const request = (instruction: string) =>
        fetch(`http://127.0.0.1:${address.port}/api/agent/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, invoices: [invoiceList[0]] }),
        });

      const invalidResponse = await request("Return invalid output");
      expect(invalidResponse.status).toBe(502);
      expect(await invalidResponse.json()).toMatchObject({
        ok: false,
        error: {
          code: "AGENT_INVALID_RESPONSE",
          message: "@pv/agent returned an invalid payment plan.",
        },
      });

      const upstreamResponse = await request("Trigger upstream failure");
      expect(upstreamResponse.status).toBe(502);
      const upstreamBody = (await upstreamResponse.json()) as ApiFailure;
      expect(upstreamBody).toMatchObject({
        ok: false,
        error: {
          code: "AGENT_ERROR",
          message: "@pv/agent could not create a payment plan.",
        },
      });
      expect(upstreamBody.error.message).not.toContain("private upstream detail");
    } finally {
      errorLog.mockRestore();
      await new Promise<void>((resolve, reject) =>
        controlledServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each([
    ["/api/agent/plan", {}],
    ["/api/policy/evaluate", {}],
    ["/api/payments/execute", {}],
    ["/api/approvals/PI-1", { approve: "yes" }],
    ["/api/attack/direct-bypass", {}],
  ])(
    "returns the standard 400 envelope for invalid body at %s",
    async (route, body) => {
      const result = await post<unknown>(route, body);
      expect(result.response.status).toBe(400);
      expect(result.body).toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
    },
  );

  it("returns standard not-found envelopes", async () => {
    const missingReceipt = await get<unknown>("/api/receipts/PV-NOT-FOUND");
    expect(missingReceipt.response.status).toBe(404);
    expect(missingReceipt.body).toMatchObject({
      ok: false,
      error: { code: "RECEIPT_NOT_FOUND" },
    });

    const missingRoute = await get<unknown>("/api/nope");
    expect(missingRoute.response.status).toBe(404);
    expect(missingRoute.body).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });

    const missingIntent = await post<unknown>("/api/approvals/PI-NOT-FOUND", {
      approve: true,
    });
    expect(missingIntent.response.status).toBe(404);
    expect(missingIntent.body).toMatchObject({
      ok: false,
      error: { code: "INTENT_NOT_FOUND" },
    });
  });

  it("returns JSON envelopes for malformed and oversized bodies", async () => {
    const malformedResponse = await fetch(`${baseUrl}/api/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });

    const oversizedResponse = await fetch(`${baseUrl}/api/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "x".repeat(2_100_000), invoices: [] }),
    });
    expect(oversizedResponse.status).toBe(413);
    expect(await oversizedResponse.json()).toMatchObject({
      ok: false,
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it.each([
    ["vendors.json", "/api/vendors", "{"],
    ["invoices.json", "/api/invoices", "[{}]"],
    ["payments.json", "/api/receipts", "[{}]"],
  ])(
    "fails closed when persisted %s data is invalid",
    async (fileName, route, invalidData) => {
      if (!dataDir) throw new Error("Missing test data directory");
      await writeFile(path.join(dataDir, fileName), invalidData, "utf8");
      const errorLog = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        const result = await get<unknown>(route);
        expect(result.response.status).toBe(500);
        expect(result.body).toMatchObject({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "The API could not complete the request.",
          },
        });
      } finally {
        errorLog.mockRestore();
      }
    },
  );

  it("rejects duplicate and internally inconsistent payment records", async () => {
    if (!dataDir) throw new Error("Missing test data directory");
    const [intent] = await plan([(await invoices())[0]]);
    await post("/api/payments/execute", {
      intent,
      decision: clientDecision(intent.intent_id),
    });

    const paymentsPath = path.join(dataDir, "payments.json");
    const records = JSON.parse(
      await readFile(paymentsPath, "utf8"),
    ) as StoredPaymentRecord[];
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await writeFile(
        paymentsPath,
        `${JSON.stringify([...records, records[0]], null, 2)}\n`,
        "utf8",
      );
      const duplicate = await get<unknown[]>("/api/receipts");
      expect(duplicate.response.status).toBe(500);
      expect(duplicate.body).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });

      const inconsistent = {
        ...records[0],
        receipt: {
          ...records[0].receipt,
          funds_moved_display: 0,
        },
      };
      await writeFile(
        paymentsPath,
        `${JSON.stringify([inconsistent], null, 2)}\n`,
        "utf8",
      );
      const invalid = await get<unknown[]>("/api/receipts");
      expect(invalid.response.status).toBe(500);
      expect(invalid.body).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });

      const unapprovedReview = {
        ...records[0],
        decision: {
          ...records[0].decision,
          verdict: "REVIEW" as const,
        },
        receipt: {
          ...records[0].receipt,
          policy_verdict: "REVIEW" as const,
          human_approval: "PENDING" as const,
        },
      };
      await writeFile(
        paymentsPath,
        `${JSON.stringify([unapprovedReview], null, 2)}\n`,
        "utf8",
      );
      const unapproved = await get<unknown[]>("/api/receipts");
      expect(unapproved.response.status).toBe(500);
      expect(unapproved.body).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });

      const mockEvidenceInRealMode = {
        ...records[0],
        execution_mode: "REAL" as const,
      };
      await writeFile(
        paymentsPath,
        `${JSON.stringify([mockEvidenceInRealMode], null, 2)}\n`,
        "utf8",
      );
      const fakeReal = await get<unknown[]>("/api/receipts");
      expect(fakeReal.response.status).toBe(500);
      expect(fakeReal.body).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });
    } finally {
      errorLog.mockRestore();
    }
  });

  it("rejects non-finite and unsafe monetary values as validation errors", async () => {
    const bypassResponse = await fetch(
      `${baseUrl}/api/attack/direct-bypass`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: `{"recipient":"${attackerAddress}","amount_display":1e309}`,
      },
    );
    expect(bypassResponse.status).toBe(400);
    expect(await bypassResponse.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });

    const agentResponse = await fetch(`${baseUrl}/api/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"instruction":"Pay","invoices":[{"invoice_id":"INV-X","vendor":"ABC Cloud","amount":1e309,"currency":"USDC","payment_address":"0xAAA"}]}',
    });
    expect(agentResponse.status).toBe(400);
    expect(await agentResponse.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });

    const overflowResponse = await fetch(`${baseUrl}/api/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"instruction":"Pay","invoices":[{"invoice_id":"INV-X","vendor":"ABC Cloud","amount":1e308,"currency":"USDC","payment_address":"0xAAA"}]}',
    });
    expect(overflowResponse.status).toBe(400);
    expect(await overflowResponse.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("uses a rolling 24-hour window and trusts only verified vendors", () => {
    const now = new Date("2026-08-29T00:01:00.000Z");
    const config: RuntimeConfig = {
      policyVersion: "V18",
      maxPerTxDisplay: 5_000,
      maxPer24hDisplay: 10_000,
      sessionExpiresAt: "2026-09-07T23:59:00Z",
      treasuryBalanceDisplay: 2_000_000,
    };
    const vendor = {
      vendor_id: "VEN-001",
      display_name: "ABC Cloud",
      verified_wallet: "0xAAA0000000000000000000000000000000000001",
      verified: true,
      status: "KNOWN" as const,
      created_at: "2025-01-10T00:00:00Z",
    };
    const intent: PaymentIntent = {
      intent_id: "PI-ROLLING",
      invoice_id: "INV-ROLLING",
      vendor_name: vendor.display_name,
      recipient: vendor.verified_wallet,
      amount_display: 5_000,
      amount_raw: "5000000000",
      token: "USDC",
      action: "transfer",
      reasoning: "test",
      created_at: now.toISOString(),
    };
    const previousPayment = {
      intent: { invoice_id: "INV-PREVIOUS" },
      execution: {
        status: "EXECUTED",
        executed_at: "2026-08-28T23:59:00.000Z",
      },
      receipt: { funds_moved_display: 6_000 },
    } as StoredPaymentRecord;

    const rollingDecision = evaluatePolicy(
      intent,
      [vendor],
      [previousPayment],
      now,
      config,
    );
    expect(rollingDecision.verdict).toBe("DENY");
    expect(rollingDecision.deny_reasons).toContain("DAILY_LIMIT_EXCEEDED");

    const historicalPayment = {
      ...previousPayment,
      intent: {
        ...previousPayment.intent,
        invoice_id: intent.invoice_id,
      },
      execution: {
        ...previousPayment.execution,
        executed_at: "2026-08-27T23:59:00.000Z",
      },
    } as StoredPaymentRecord;
    const duplicateDecision = evaluatePolicy(
      intent,
      [vendor],
      [historicalPayment],
      now,
      config,
    );
    expect(duplicateDecision.verdict).toBe("REVIEW");
    expect(duplicateDecision.deny_reasons).not.toContain("DUPLICATE_PAYMENT");
    expect(
      duplicateDecision.checks.find((check) => check.id === "DAILY_LIMIT")
        ?.status,
    ).toBe("PASS");

    const unverifiedDecision = evaluatePolicy(
      { ...intent, amount_display: 1_000, amount_raw: "1000000000" },
      [{ ...vendor, verified: false }],
      [],
      now,
      config,
    );
    expect(unverifiedDecision.verdict).toBe("DENY");
    expect(unverifiedDecision.deny_reasons).toContain("VENDOR_UNKNOWN");
  });
});
