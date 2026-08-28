import type {
  ApiResponse,
  BlastRadius,
  ExecutionResult,
  Invoice,
  PaymentIntent,
  PolicyDecision,
  PolicyReceipt,
  Vendor,
} from "@pv/shared";
import {
  findMockDecision,
  findMockReceipt,
  mockBlastRadius,
  mockDirectBypass,
  mockInvoices,
  mockPlan,
  mockReceipts,
  mockVendors,
} from "./mockData";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError("INVALID_RESPONSE", "The API returned an unreadable response.", response.status);
  }

  if (!response.ok || !payload.ok) {
    const apiError = payload.ok ? undefined : payload.error;
    throw new ApiClientError(
      apiError?.code ?? `HTTP_${response.status}`,
      apiError?.message ?? "The API request failed.",
      response.status,
    );
  }

  return payload.data;
}

async function withFallback<T>(label: string, load: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.warn(`[PolicyVault] ${label} failed; using mock fallback.`, error);
    return fallback();
  }
}

export const api = {
  getVendors: () => withFallback("GET /api/vendors", () => request<Vendor[]>("/api/vendors"), () => mockVendors),
  getInvoices: () => withFallback("GET /api/invoices", () => request<Invoice[]>("/api/invoices"), () => mockInvoices),
  createPlan: (instruction: string, invoices: Invoice[]) =>
    withFallback(
      "POST /api/agent/plan",
      () => request<{ intents: PaymentIntent[]; agent_message: string }>("/api/agent/plan", {
        method: "POST",
        body: JSON.stringify({ instruction, invoices }),
      }),
      () => mockPlan,
    ),
  evaluatePolicy: (intent: PaymentIntent) =>
    withFallback(
      "POST /api/policy/evaluate",
      () => request<PolicyDecision>("/api/policy/evaluate", { method: "POST", body: JSON.stringify({ intent }) }),
      () => findMockDecision(intent.intent_id),
    ),
  executePayment: (intent: PaymentIntent, decision: PolicyDecision) =>
    withFallback(
      "POST /api/payments/execute",
      () => request<{ execution: ExecutionResult; receipt: PolicyReceipt }>("/api/payments/execute", {
        method: "POST",
        body: JSON.stringify({ intent, decision }),
      }),
      () => {
        const mockIndex = mockPlan.intents.findIndex((candidate) => candidate.intent_id === intent.intent_id);
        const paymentId = mockIndex >= 0 ? `PV-${String(mockIndex + 1).padStart(4, "0")}` : "PV-0001";
        const receipt = findMockReceipt(paymentId);
        return { execution: receipt.execution ?? mockDirectBypass, receipt };
      },
    ),
  getBlastRadius: () => withFallback("GET /api/blast-radius", () => request<BlastRadius>("/api/blast-radius"), () => mockBlastRadius),
  getReceipts: () => withFallback("GET /api/receipts", () => request<PolicyReceipt[]>("/api/receipts"), () => mockReceipts),
  getReceipt: (paymentId: string) =>
    withFallback(
      `GET /api/receipts/${paymentId}`,
      () => request<PolicyReceipt>(`/api/receipts/${paymentId}`),
      () => findMockReceipt(paymentId),
    ),
  approvePayment: (intentId: string, approve: boolean) =>
    withFallback(
      `POST /api/approvals/${intentId}`,
      () => request<PolicyReceipt>(`/api/approvals/${intentId}`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      }),
      () => findMockReceipt("PV-0017"),
    ),
  directBypass: (recipient: string, amountDisplay: number) =>
    withFallback(
      "POST /api/attack/direct-bypass",
      () => request<ExecutionResult>("/api/attack/direct-bypass", {
        method: "POST",
        body: JSON.stringify({ recipient, amount_display: amountDisplay }),
      }),
      () => mockDirectBypass,
    ),
};
