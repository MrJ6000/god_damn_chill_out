import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Invoice,
  PaymentIntent,
  PolicyCheck,
  PolicyDecision,
} from "@pv/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { evaluateMockPolicy, type RuntimeConfig } from "./mock.js";
import type { StoredPaymentRecord } from "./store.js";

const fixtureDataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const fixedNow = new Date("2026-08-28T08:00:00.000Z");

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

  beforeEach(async () => {
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
      config: {
        policyVersion: "V18",
        maxPerTxDisplay: 5_000,
        maxPer24hDisplay: 10_000,
        approvalThresholdDisplay: 2_000,
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
        receipt: { policy_verdict: "DENY", funds_moved_display: 0 },
      },
    });
    if (!denied.body.ok) throw new Error(denied.body.error.message);
    const expectedInputHash = createHash("sha256")
      .update(JSON.stringify(maliciousInvoice))
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
      },
      execution: {
        ...records[0].execution,
        intent_id: "PI-PRIOR-SPEND",
        status: "EXECUTED" as const,
        executed_at: fixedNow.toISOString(),
      },
      receipt: {
        ...records[0].receipt,
        payment_id: "PV-PRIOR-SPEND",
        invoice_id: "INV-PRIOR-SPEND",
        execution: {
          ...records[0].execution,
          intent_id: "PI-PRIOR-SPEND",
          status: "EXECUTED" as const,
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
      recipient: "0xHACKER8888888888888888888888888888888888",
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
    const realModeApp = createApp({
      dataDir,
      now: () => new Date(fixedNow),
      mockAgent: false,
      mockChain: false,
      webOrigin: "http://localhost:3000",
      config: {
        policyVersion: "V18",
        maxPerTxDisplay: 5_000,
        maxPer24hDisplay: 10_000,
        approvalThresholdDisplay: 2_000,
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
            recipient: "0xHACKER8888888888888888888888888888888888",
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

  it("rejects non-finite and unsafe monetary values as validation errors", async () => {
    const bypassResponse = await fetch(
      `${baseUrl}/api/attack/direct-bypass`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"recipient":"0xHACKER8888888888888888888888888888888888","amount_display":1e309}',
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
      approvalThresholdDisplay: 2_000,
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

    const rollingDecision = evaluateMockPolicy(
      intent,
      [vendor],
      [previousPayment],
      now,
      config,
    );
    expect(rollingDecision.verdict).toBe("DENY");
    expect(rollingDecision.deny_reasons).toContain("DAILY_LIMIT_EXCEEDED");

    const unverifiedDecision = evaluateMockPolicy(
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
