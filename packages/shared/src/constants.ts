/** USDC 的小數位數。1 USDC = 1_000_000 最小單位。 */
export const USDC_DECIMALS = 6;

/** 把人看的金額轉成鏈上最小單位字串 */
export function toRawAmount(display: number): string {
  return BigInt(Math.round(display * 10 ** USDC_DECIMALS)).toString();
}

/** 把鏈上最小單位轉回人看的金額 */
export function toDisplayAmount(raw: string): number {
  return Number(BigInt(raw)) / 10 ** USDC_DECIMALS;
}

/** 地址比對一律走這個函式（大小寫不敏感） */
export function addressEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 縮短地址顯示：0xAAA0000…0001 */
export function shortAddress(a: string): string {
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export const EXPLORER_TX_BASE = "https://sepolia.basescan.org/tx/";
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const ALL_POLICY_CHECK_IDS = [
  "TOKEN_ALLOWED",
  "VENDOR_KNOWN",
  "BENEFICIARY_MATCH",
  "PER_TX_LIMIT",
  "DAILY_LIMIT",
  "SESSION_VALID",
  "DUPLICATE_PAYMENT",
  "APPROVAL_REQUIRED",
] as const;
