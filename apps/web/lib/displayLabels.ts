import type { DenyReasonCode, PolicyReceipt } from "@pv/shared";

const denyReasonLabels: Record<DenyReasonCode, string> = {
  TOKEN_NOT_ALLOWED: "幣別不在允許清單",
  VENDOR_UNKNOWN: "廠商未登記",
  BENEFICIARY_MISMATCH: "收款地址不符",
  PER_TX_LIMIT_EXCEEDED: "超過單筆金額上限",
  DAILY_LIMIT_EXCEEDED: "超過每日總額上限",
  SESSION_EXPIRED: "本次權限已過期",
  DUPLICATE_PAYMENT: "偵測到重複付款",
  POLICY_OVERRIDE_ATTEMPT: "偵測到繞過安全規則",
};

const humanApprovalLabels: Record<PolicyReceipt["human_approval"], string> = {
  NOT_REQUIRED: "不需核准",
  APPROVED: "已核准",
  PENDING: "等待核准",
  REJECTED: "已拒絕",
};

export function formatDenyReason(reason: DenyReasonCode): string {
  return denyReasonLabels[reason];
}

export function formatHumanApproval(status: PolicyReceipt["human_approval"]): string {
  return humanApprovalLabels[status];
}
