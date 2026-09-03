import type {
  BlastRadius,
  ExecutionResult,
  Invoice,
  PaymentIntent,
  PolicyDecision,
  PolicyReceipt,
  Vendor,
} from "@pv/shared";
import { api, ApiClientError, type DemoApi, type DemoNotice, toDemoNotice } from "./api";
import {
  attackerAddress,
  createMockPaymentOutcome,
  findMockReceipt,
  mockBlastRadius,
  mockDecisions,
  mockDirectBypass,
  mockInvoices,
  mockIntents,
  mockVendors,
} from "./mockData";

export const DEFAULT_INSTRUCTION = "Process today's approved payments.";
export const DIRECT_BYPASS_AMOUNT = 4_800;
export const NORMAL_DEMO_INVOICE_ID = "INV-8801";

export type DemoProvenance = "api" | "mock" | "mixed";
export type DemoScenario = "idle" | "normal" | "compromised" | "direct-bypass";

export interface InboxScene {
  invoices: Invoice[];
  notices: DemoNotice[];
  source: "api" | "mock";
  updatedAt: string;
  vendors: Vendor[];
}

export interface PlanScene extends InboxScene {
  agentMessage: string;
  decisions: PolicyDecision[];
  intents: PaymentIntent[];
  scenario: "normal" | "compromised";
}

export interface ReceiptRecord {
  execution: ExecutionResult;
  notice?: DemoNotice;
  receipt: PolicyReceipt;
  source: "api" | "mock";
}

export interface ExecutionScene {
  cachedDemoRecords: ReceiptRecord[];
  notices: DemoNotice[];
  records: ReceiptRecord[];
  source: DemoProvenance;
  updatedAt: string;
}

export interface AttackScene {
  amountDisplay: number;
  execution: ExecutionResult;
  notice?: DemoNotice;
  recipient: string;
  source: "api" | "mock";
  updatedAt: string;
}

export interface BlastRadiusScene {
  data: BlastRadius;
  notice?: DemoNotice;
  source: "api" | "mock";
  updatedAt: string;
}

function now(): string {
  return new Date().toISOString();
}

function normalMockScene(notice?: DemoNotice): PlanScene {
  return {
    agentMessage: "前端備援：已載入 18 筆一致的付款提案與政策判定。",
    decisions: mockDecisions,
    intents: mockIntents,
    invoices: mockInvoices,
    notices: notice ? [notice] : [],
    scenario: "normal",
    source: "mock",
    updatedAt: now(),
    vendors: mockVendors,
  };
}

function compromisedMockScene(notice?: DemoNotice): PlanScene {
  const invoice = mockInvoices.find((candidate) => candidate.invoice_id === "INV-8821");
  const intent = mockIntents.find((candidate) => candidate.invoice_id === "INV-8821");
  const decision = intent
    ? mockDecisions.find((candidate) => candidate.intent_id === intent.intent_id)
    : undefined;

  if (!invoice || !intent || !decision) {
    throw new Error("惡意帳單的前端備援資料不完整。");
  }

  return {
    agentMessage: "前端備援：AI 依帳單備註提出了遭竄改的收款地址。",
    decisions: [decision],
    intents: [intent],
    invoices: [invoice],
    notices: notice ? [notice] : [],
    scenario: "compromised",
    source: "mock",
    updatedAt: now(),
    vendors: mockVendors,
  };
}

function validatePlan(intents: PaymentIntent[], decisions: PolicyDecision[]): void {
  if (intents.length === 0 || decisions.length !== intents.length) {
    throw new ApiClientError("PLAN_INCOMPLETE", "The plan did not return one decision per intent.");
  }

  const decisionIds = new Set(decisions.map((decision) => decision.intent_id));
  if (intents.some((intent) => !decisionIds.has(intent.intent_id))) {
    throw new ApiClientError("PLAN_ID_MISMATCH", "The policy decisions do not match the plan intents.");
  }
}

export async function loadInbox(client: DemoApi = api): Promise<InboxScene> {
  try {
    const [invoices, vendors] = await Promise.all([client.getInvoices(), client.getVendors()]);
    return { invoices, notices: [], source: "api", updatedAt: now(), vendors };
  } catch (error) {
    const notice = toDemoNotice("載入待付款資料", error);
    return {
      invoices: mockInvoices,
      notices: [notice],
      source: "mock",
      updatedAt: now(),
      vendors: mockVendors,
    };
  }
}

export async function buildNormalPlan(client: DemoApi = api): Promise<PlanScene> {
  try {
    const [invoices, vendors] = await Promise.all([client.getInvoices(), client.getVendors()]);
    const plan = await client.createPlan(DEFAULT_INSTRUCTION, invoices);
    const decisions = await Promise.all(plan.intents.map((intent) => client.evaluatePolicy(intent)));
    validatePlan(plan.intents, decisions);
    return {
      agentMessage: plan.agent_message,
      decisions,
      intents: plan.intents,
      invoices,
      notices: [],
      scenario: "normal",
      source: "api",
      updatedAt: now(),
      vendors,
    };
  } catch (error) {
    return normalMockScene(toDemoNotice("建立正常付款計畫", error));
  }
}

export async function buildCompromisedPlan(client: DemoApi = api): Promise<PlanScene> {
  try {
    const [invoices, vendors] = await Promise.all([client.getInvoices(), client.getVendors()]);
    const maliciousInvoice = invoices.find((invoice) => invoice.invoice_id === "INV-8821");
    if (!maliciousInvoice) {
      throw new ApiClientError("DEMO_FIXTURE_NOT_FOUND", "INV-8821 is missing from the API response.");
    }

    const plan = await client.createPlan(DEFAULT_INSTRUCTION, [maliciousInvoice]);
    const intent = plan.intents.find((candidate) => candidate.invoice_id === maliciousInvoice.invoice_id);
    if (!intent) {
      throw new ApiClientError("PLAN_ID_MISMATCH", "The malicious invoice did not produce a matching intent.");
    }
    const decision = await client.evaluatePolicy(intent);
    validatePlan([intent], [decision]);
    return {
      agentMessage: plan.agent_message,
      decisions: [decision],
      intents: [intent],
      invoices: [maliciousInvoice],
      notices: [],
      scenario: "compromised",
      source: "api",
      updatedAt: now(),
      vendors,
    };
  } catch (error) {
    return compromisedMockScene(toDemoNotice("建立 AI 遭入侵情境", error));
  }
}

export async function executeApproved(
  plan: PlanScene,
  client: DemoApi = api,
): Promise<ExecutionScene> {
  const decisionsByIntent = new Map(plan.decisions.map((decision) => [decision.intent_id, decision]));
  const selectedIntent = plan.intents.find(
    (intent) => intent.invoice_id === NORMAL_DEMO_INVOICE_ID,
  );
  const selectedDecision = selectedIntent
    ? decisionsByIntent.get(selectedIntent.intent_id)
    : undefined;

  if (!selectedIntent || selectedDecision?.verdict !== "ALLOW") {
    throw new ApiClientError(
      "NORMAL_PAYMENT_UNAVAILABLE",
      `示範帳單 ${NORMAL_DEMO_INVOICE_ID} 不存在或未通過政策判定。`,
    );
  }

  if (plan.source === "mock") {
    return {
      cachedDemoRecords: [],
      notices: plan.notices,
      records: [{
        ...createMockPaymentOutcome(selectedIntent, selectedDecision),
        source: "mock",
      }],
      source: "mock",
      updatedAt: now(),
    };
  }

  const notices: DemoNotice[] = [];
  const records: ReceiptRecord[] = [];
  const cachedDemoRecords: ReceiptRecord[] = [];
  try {
    records.push({
      ...await client.executePayment(selectedIntent, selectedDecision),
      source: "api",
    });
  } catch (error) {
    const notice = toDemoNotice(`執行 ${selectedIntent.invoice_id}`, error);
    const cachedOutcome = createMockPaymentOutcome(selectedIntent, selectedDecision);
    notices.push(notice);
    cachedDemoRecords.push({
      ...cachedOutcome,
      notice,
      receipt: {
        ...cachedOutcome.receipt,
        payment_id: `CACHED-${selectedIntent.intent_id}`,
      },
      source: "mock",
    });
  }

  return {
    cachedDemoRecords,
    notices,
    records,
    source: notices.length === 0 ? "api" : "mixed",
    updatedAt: now(),
  };
}

export function selectReceiptForNavigation(scene: ExecutionScene): ReceiptRecord | undefined {
  return scene.records.find(
    (record) => record.source === "api" && record.execution.status === "EXECUTED",
  ) ?? scene.records.find(
    (record) => record.source === "api" && record.execution.status === "PENDING",
  ) ?? scene.records.find(
    (record) => record.source === "mock" && !record.notice && record.execution.status === "EXECUTED",
  );
}

export async function runDirectBypass(client: DemoApi = api): Promise<AttackScene> {
  try {
    const execution = await client.directBypass(attackerAddress, DIRECT_BYPASS_AMOUNT);
    return {
      amountDisplay: DIRECT_BYPASS_AMOUNT,
      execution,
      recipient: attackerAddress,
      source: "api",
      updatedAt: now(),
    };
  } catch (error) {
    return {
      amountDisplay: DIRECT_BYPASS_AMOUNT,
      execution: mockDirectBypass,
      notice: toDemoNotice("執行直接攻擊情境", error),
      recipient: attackerAddress,
      source: "mock",
      updatedAt: now(),
    };
  }
}

export async function loadBlastRadius(client: DemoApi = api): Promise<BlastRadiusScene> {
  try {
    return { data: await client.getBlastRadius(), source: "api", updatedAt: now() };
  } catch (error) {
    return {
      data: mockBlastRadius,
      notice: toDemoNotice("載入 Blast Radius", error),
      source: "mock",
      updatedAt: now(),
    };
  }
}

export async function loadReceipt(
  paymentId: string,
  client: DemoApi = api,
): Promise<{ notice?: DemoNotice; receipt?: PolicyReceipt; source?: "api" | "mock" }> {
  try {
    return { receipt: await client.getReceipt(paymentId), source: "api" };
  } catch (error) {
    const receipt = findMockReceipt(paymentId);
    return {
      notice: toDemoNotice(`載入付款憑證 ${paymentId}`, error),
      receipt,
      source: receipt ? "mock" : undefined,
    };
  }
}
