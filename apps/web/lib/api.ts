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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 30_000;

export interface DemoNotice {
  code: string;
  message: string;
  operation: string;
  status?: number;
}

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

export function toDemoNotice(operation: string, error: unknown): DemoNotice {
  const apiError = error instanceof ApiClientError ? error : undefined;
  let message = "後端目前無法使用，已切換到前端備援資料。";

  if (apiError?.code === "TIMEOUT") {
    message = "後端回應逾時，已切換到前端備援資料。";
  } else if (apiError?.code === "NETWORK_ERROR") {
    message = "無法連上後端，已切換到前端備援資料。";
  } else if (apiError?.code === "INVALID_RESPONSE") {
    message = "後端回傳格式無法辨識，已切換到前端備援資料。";
  } else if (apiError?.code === "DIRECT_BYPASS_DISABLED") {
    message = "鏈上攻擊示範尚未啟用，已改用前端備援情境。";
  } else if (apiError?.code.startsWith("CHAIN_")) {
    message = "鏈上整合尚未完成這次請求，已改用前端備援情境。";
  } else if (apiError) {
    message = `後端未完成請求（${apiError.code}），已切換到前端備援資料。`;
  }

  return {
    code: apiError?.code ?? "UNKNOWN_ERROR",
    message,
    operation,
    status: apiError?.status,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiClientError("TIMEOUT", "The API request timed out.");
    }
    throw new ApiClientError("NETWORK_ERROR", "The API could not be reached.");
  } finally {
    clearTimeout(timeout);
  }

  let payload: ApiResponse<T>;
  try {
    const parsed = await response.json() as unknown;
    if (typeof parsed !== "object" || parsed === null || !("ok" in parsed) || typeof parsed.ok !== "boolean") {
      throw new Error("Invalid API envelope");
    }
    payload = parsed as ApiResponse<T>;
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

export const api = {
  getVendors: () => request<Vendor[]>("/api/vendors"),
  getInvoices: () => request<Invoice[]>("/api/invoices"),
  createPlan: (instruction: string, invoices: Invoice[]) =>
    request<{ intents: PaymentIntent[]; agent_message: string }>("/api/agent/plan", {
      method: "POST",
      body: JSON.stringify({ instruction, invoices }),
    }),
  evaluatePolicy: (intent: PaymentIntent) =>
    request<PolicyDecision>("/api/policy/evaluate", {
      method: "POST",
      body: JSON.stringify({ intent }),
    }),
  executePayment: (intent: PaymentIntent, decision: PolicyDecision) =>
    request<{ execution: ExecutionResult; receipt: PolicyReceipt }>("/api/payments/execute", {
      method: "POST",
      body: JSON.stringify({ intent, decision }),
    }),
  getBlastRadius: () => request<BlastRadius>("/api/blast-radius"),
  getReceipts: () => request<PolicyReceipt[]>("/api/receipts"),
  getReceipt: (paymentId: string) => request<PolicyReceipt>(`/api/receipts/${paymentId}`),
  approvePayment: (intentId: string, approve: boolean) =>
    request<PolicyReceipt>(`/api/approvals/${intentId}`, {
      method: "POST",
      body: JSON.stringify({ approve }),
    }),
  directBypass: (recipient: string, amountDisplay: number) =>
    request<ExecutionResult>("/api/attack/direct-bypass", {
      method: "POST",
      body: JSON.stringify({ recipient, amount_display: amountDisplay }),
    }),
};

export type DemoApi = typeof api;
