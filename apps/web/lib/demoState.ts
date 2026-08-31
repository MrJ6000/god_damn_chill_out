import type { PaymentIntent, PolicyDecision, PolicyReceipt, Vendor } from "@pv/shared";
import type {
  AttackScene,
  BlastRadiusScene,
  DemoScenario,
  ExecutionScene,
  InboxScene,
  PlanScene,
  ReceiptRecord,
} from "./demoWorkflow";
import {
  findMockDecision,
  findMockIntent,
  findMockReceipt,
  mockDecisions,
  mockInvoices,
  mockIntents,
  mockVendors,
} from "./mockData";

export const DEMO_STORAGE_KEY = "policyvault.demo.v1";
export const DEMO_SCHEMA_VERSION = 1;

export interface DemoState {
  attack?: AttackScene;
  blastRadius?: BlastRadiusScene;
  execution?: ExecutionScene;
  inbox?: InboxScene;
  plan?: PlanScene;
  scenario: DemoScenario;
  schemaVersion: typeof DEMO_SCHEMA_VERSION;
}

export function createInitialDemoState(): DemoState {
  return {
    scenario: "idle",
    schemaVersion: DEMO_SCHEMA_VERSION,
  };
}

export function createDirectMockPlan(): PlanScene {
  return {
    agentMessage: "直接開啟頁面：目前顯示前端備援付款計畫。",
    decisions: mockDecisions,
    intents: mockIntents,
    invoices: mockInvoices,
    notices: [],
    scenario: "normal",
    source: "mock",
    updatedAt: new Date().toISOString(),
    vendors: mockVendors,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isArrayOfRecords(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isNotice(value: unknown): boolean {
  return isRecord(value)
    && isString(value.code)
    && isString(value.message)
    && isString(value.operation)
    && (value.status === undefined || isFiniteNumber(value.status));
}

function isInvoice(value: unknown): boolean {
  return isRecord(value)
    && isString(value.invoice_id)
    && isString(value.vendor)
    && isFiniteNumber(value.amount)
    && value.currency === "USDC"
    && isString(value.payment_address);
}

function isVendor(value: unknown): boolean {
  return isRecord(value)
    && isString(value.vendor_id)
    && isString(value.display_name)
    && isString(value.verified_wallet)
    && typeof value.verified === "boolean"
    && isOneOf(value.status, ["KNOWN", "NEW"])
    && isString(value.created_at);
}

function isIntent(value: unknown): boolean {
  return isRecord(value)
    && isString(value.intent_id)
    && isString(value.invoice_id)
    && isString(value.vendor_name)
    && isString(value.recipient)
    && isFiniteNumber(value.amount_display)
    && isString(value.amount_raw)
    && value.token === "USDC"
    && value.action === "transfer"
    && isString(value.reasoning)
    && isString(value.created_at);
}

function isDecision(value: unknown): boolean {
  return isRecord(value)
    && isString(value.intent_id)
    && isOneOf(value.verdict, ["ALLOW", "REVIEW", "DENY"])
    && isArrayOfRecords(value.checks)
    && isStringArray(value.deny_reasons)
    && isString(value.policy_version)
    && isString(value.evaluated_at)
    && isFiniteNumber(value.latency_ms);
}

function isExecutionResult(value: unknown): boolean {
  return isRecord(value)
    && isString(value.intent_id)
    && isOneOf(value.status, ["EXECUTED", "REJECTED", "PENDING", "SKIPPED"])
    && isString(value.executed_at);
}

function isReceipt(value: unknown): boolean {
  return isRecord(value)
    && isString(value.payment_id)
    && isString(value.invoice_id)
    && isString(value.vendor_name)
    && isStringArray(value.deny_reasons)
    && isOneOf(value.policy_verdict, ["ALLOW", "REVIEW", "DENY"])
    && (value.execution === null || isExecutionResult(value.execution));
}

function isReceiptRecord(value: unknown): boolean {
  return isRecord(value)
    && isExecutionResult(value.execution)
    && isReceipt(value.receipt)
    && isOneOf(value.source, ["api", "mock"])
    && (value.notice === undefined || isNotice(value.notice));
}

function isInboxScene(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.invoices) && value.invoices.every(isInvoice)
    && Array.isArray(value.notices) && value.notices.every(isNotice)
    && Array.isArray(value.vendors) && value.vendors.every(isVendor)
    && isOneOf(value.source, ["api", "mock"])
    && isString(value.updatedAt);
}

function isPlanScene(value: unknown): boolean {
  return isInboxScene(value)
    && isRecord(value)
    && isString(value.agentMessage)
    && Array.isArray(value.decisions) && value.decisions.every(isDecision)
    && Array.isArray(value.intents) && value.intents.every(isIntent)
    && isOneOf(value.scenario, ["normal", "compromised"]);
}

function isExecutionScene(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.cachedDemoRecords) && value.cachedDemoRecords.every(isReceiptRecord)
    && Array.isArray(value.notices) && value.notices.every(isNotice)
    && Array.isArray(value.records) && value.records.every(isReceiptRecord)
    && isOneOf(value.source, ["api", "mock", "mixed"])
    && isString(value.updatedAt);
}

function isAttackScene(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.amountDisplay)
    && isExecutionResult(value.execution)
    && (value.notice === undefined || isNotice(value.notice))
    && isString(value.recipient)
    && isOneOf(value.source, ["api", "mock"])
    && isString(value.updatedAt);
}

function isBlastRadiusScene(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  return isFiniteNumber(value.data.unauthorized_recipient_exposure)
    && isStringArray(value.data.allowed_tokens)
    && isStringArray(value.data.allowed_actions)
    && isOneOf(value.data.source, ["onchain", "cached"])
    && (value.notice === undefined || isNotice(value.notice))
    && isOneOf(value.source, ["api", "mock"])
    && isString(value.updatedAt);
}

export function serializeDemoState(state: DemoState): string {
  return JSON.stringify(state);
}

export function parseDemoState(raw: string | null): DemoState | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.schemaVersion !== DEMO_SCHEMA_VERSION) return null;
    if (!new Set(["idle", "normal", "compromised", "direct-bypass"]).has(String(value.scenario))) {
      return null;
    }
    if (value.inbox !== undefined && !isInboxScene(value.inbox)) return null;
    if (value.plan !== undefined && !isPlanScene(value.plan)) return null;
    if (value.execution !== undefined && !isExecutionScene(value.execution)) return null;
    if (value.attack !== undefined && !isAttackScene(value.attack)) return null;
    if (value.blastRadius !== undefined && !isBlastRadiusScene(value.blastRadius)) return null;

    return value as unknown as DemoState;
  } catch {
    return null;
  }
}

export function selectPlan(state: DemoState): PlanScene {
  return state.plan ?? createDirectMockPlan();
}

export function selectIntent(state: DemoState, intentId: string): PaymentIntent | undefined {
  return state.plan?.intents.find((intent) => intent.intent_id === intentId) ?? findMockIntent(intentId);
}

export function selectDecision(state: DemoState, intentId: string): PolicyDecision | undefined {
  return state.plan?.decisions.find((decision) => decision.intent_id === intentId) ?? findMockDecision(intentId);
}

export function selectVendor(state: DemoState, displayName: string): Vendor | undefined {
  const matchesVerifiedVendor = (vendor: Vendor) =>
    vendor.verified && vendor.display_name.toLowerCase() === displayName.toLowerCase();
  if (state.plan) {
    return state.plan.vendors.find(matchesVerifiedVendor);
  }
  if (state.inbox) {
    return state.inbox.vendors.find(matchesVerifiedVendor);
  }
  return mockVendors.find(matchesVerifiedVendor);
}

export function selectReceiptRecord(state: DemoState, paymentId: string): ReceiptRecord | undefined {
  return state.execution?.records.find((record) => record.receipt.payment_id === paymentId);
}

export function selectReceipt(state: DemoState, paymentId: string): PolicyReceipt | undefined {
  return selectReceiptRecord(state, paymentId)?.receipt ?? findMockReceipt(paymentId);
}
