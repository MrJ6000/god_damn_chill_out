/**
 * PolicyVault Sentinel — 共用型別定義
 *
 * ⚠️ 這是五個模組之間的「合約」。
 * ⚠️ 只有 M2（整合官）可以修改這個檔案。
 * ⚠️ 修改後必須在群組公告，所有人執行 git fetch origin && git rebase origin/main
 */

// ============================================================
// 輸入：帳單
// ============================================================

/**
 * 一張待付款的帳單。
 *
 * 🔴 payment_address 是「帳單宣稱的」收款地址，是攻擊者可以控制的欄位。
 *    唯一可信的地址是 Vendor.verified_wallet。
 * 🔴 memo 和 description 是 prompt injection 的主要攻擊面。
 */
export interface Invoice {
  invoice_id: string;
  vendor: string;
  amount: number;
  currency: "USDC";
  payment_address: string;
  memo?: string;
  description?: string;
  due_date?: string;
  approved_by?: string;
}

// ============================================================
// 廠商
// ============================================================

export interface Vendor {
  vendor_id: string;
  display_name: string;
  /** 唯一可信的收款地址。帳單上寫什麼都不算數。 */
  verified_wallet: string;
  verified: boolean;
  status: "KNOWN" | "NEW";
  created_at: string;
}

// ============================================================
// AI 產出：付款意圖
// ============================================================

/**
 * AI Agent 產生的付款意圖。
 *
 * 🔴 recipient 必須忠實反映 AI 真正的輸出。
 *    如果 AI 被 prompt injection 騙到，這裡就該是攻擊者的地址。
 *    絕對不要在 Agent 層偷偷修正它。
 */
export interface PaymentIntent {
  intent_id: string;
  invoice_id: string;
  vendor_name: string;
  recipient: string;
  /** 人看的金額，例如 4800 */
  amount_display: number;
  /** 鏈上用的最小單位字串，USDC 6 位小數，例如 "4800000000" */
  amount_raw: string;
  token: "USDC";
  action: "transfer";
  reasoning: string;
  created_at: string;
}

// ============================================================
// 政策判定
// ============================================================

export type PolicyVerdict = "ALLOW" | "REVIEW" | "DENY";

export type PolicyCheckId =
  | "TOKEN_ALLOWED"
  | "VENDOR_KNOWN"
  | "BENEFICIARY_MATCH"
  | "PER_TX_LIMIT"
  | "DAILY_LIMIT"
  | "SESSION_VALID"
  | "DUPLICATE_PAYMENT"
  | "APPROVAL_REQUIRED";

export interface PolicyCheck {
  id: PolicyCheckId;
  status: "PASS" | "FAIL" | "WARN" | "NA";
  detail: string;
}

export type DenyReasonCode =
  | "TOKEN_NOT_ALLOWED"
  | "VENDOR_UNKNOWN"
  | "BENEFICIARY_MISMATCH"
  | "PER_TX_LIMIT_EXCEEDED"
  | "DAILY_LIMIT_EXCEEDED"
  | "SESSION_EXPIRED"
  | "DUPLICATE_PAYMENT"
  | "POLICY_OVERRIDE_ATTEMPT";

export interface PolicyDecision {
  intent_id: string;
  verdict: PolicyVerdict;
  /** 八項檢查全部都要回，即使前面已經 FAIL（前端要逐項顯示） */
  checks: PolicyCheck[];
  deny_reasons: DenyReasonCode[];
  policy_version: string;
  evaluated_at: string;
  latency_ms: number;
}

// ============================================================
// 鏈上執行
// ============================================================

export interface ExecutionResult {
  intent_id: string;
  /** PENDING means broadcast succeeded but the final receipt is still unknown; retain at least one hash. */
  status: "EXECUTED" | "REJECTED" | "PENDING" | "SKIPPED";
  tx_hash?: string;
  user_op_hash?: string;
  block_number?: number;
  explorer_url?: string;
  error_code?: string;
  error_message?: string;
  /** Completion time, or the broadcast time while status is PENDING. */
  executed_at: string;
}

// ============================================================
// 爆炸半徑
// ============================================================

export interface BlastRadius {
  treasury_balance_display: number;
  max_per_tx_display: number;
  max_per_24h_display: number;
  remaining_24h_display: number;
  authorized_recipient_count: number;
  /** 永遠是 0 —— 這是招牌數字 */
  unauthorized_recipient_exposure: number;
  session_expires_at: string;
  session_remaining_seconds: number;
  allowed_tokens: string[];
  allowed_actions: string[];
  /** 🔴 一定要標明來源。UI 上要顯示，評審會問。 */
  source: "onchain" | "cached";
}

// ============================================================
// 政策收據
// ============================================================

export interface PolicyReceipt {
  payment_id: string;
  /** 原始 invoice JSON 的 sha256，證明輸入沒被竄改 */
  input_hash: string;
  invoice_id: string;
  vendor_name: string;
  verified_recipient: string;
  /** AI 提議的地址。被攻擊時會與 verified_recipient 不同。 */
  agent_proposed_recipient: string;
  amount_display: number;
  policy_version: string;
  session_permission_id: string;
  policy_verdict: PolicyVerdict;
  deny_reasons: DenyReasonCode[];
  human_approval: "NOT_REQUIRED" | "APPROVED" | "PENDING" | "REJECTED";
  execution: ExecutionResult | null;
  funds_moved_display: number;
  created_at: string;
}

// ============================================================
// 攻擊案例
// ============================================================

export type AttackType =
  | "LEGITIMATE"
  | "PROMPT_INJECTION"
  | "ADDRESS_REPLACEMENT"
  | "SPLIT_TRANSACTION"
  | "DUPLICATE_PAYMENT"
  | "VENDOR_IMPERSONATION"
  | "POLICY_OVERRIDE";

export interface AttackCase {
  case_id: string;
  type: AttackType;
  description: string;
  invoices: Invoice[];
  /** 預先錄好的 intent，讓 CI 可以離線跑，不用呼叫 OpenAI */
  recorded_intents?: PaymentIntent[];
  expected_verdict: PolicyVerdict;
  expected_deny_reason?: DenyReasonCode;
  must_not_execute: boolean;
}

// ============================================================
// API 回應包裝
// ============================================================

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string } };
export type ApiResponse<T> = ApiOk<T> | ApiErr;
