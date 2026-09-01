import { describe, it, expect } from "vitest";
import {
  mapErrorCode,
  findRevertData,
  executeRawTransferWithSessionKey,
} from "./index.js";

describe("mapErrorCode", () => {
  it("maps known revert selectors to their error codes", () => {
    expect(mapErrorCode("0x6ee9124e...")).toBe("RECIPIENT_NOT_ALLOWED");
    expect(mapErrorCode("reverted with 0x9f4af03e")).toBe("PER_TX_LIMIT_EXCEEDED");
    expect(mapErrorCode("0xef664d6a")).toBe("DAILY_LIMIT_EXCEEDED");
    expect(mapErrorCode("0x531e5a05")).toBe("SESSION_EXPIRED");
    expect(mapErrorCode("0xf290fcfb")).toBe("NOT_AI_SESSION");
    expect(mapErrorCode("0x28ab6450")).toBe("NOT_ROOT");
    expect(mapErrorCode("0xdf33b86d")).toBe("DUPLICATE_PAYMENT");
    expect(mapErrorCode("0x4faf6892")).toBe("APPROVAL_REQUIRED");
    expect(mapErrorCode("0x94403b70")).toBe("TOKEN_NOT_ALLOWED");
  });

  it("is case-insensitive", () => {
    expect(mapErrorCode("0xF290FCFB")).toBe("NOT_AI_SESSION");
  });

  it("falls back to USER_OP_REJECTED for unknown revert text", () => {
    expect(mapErrorCode("some unrelated error")).toBe("USER_OP_REJECTED");
    expect(mapErrorCode("")).toBe("USER_OP_REJECTED");
  });
});

describe("findRevertData", () => {
  it("finds .data on the top-level error", () => {
    expect(findRevertData({ data: "0xf290fcfb" })).toBe("0xf290fcfb");
  });

  it("walks nested .cause chains to find .data (viem's real error shape)", () => {
    const err = {
      message: "Execution reverted for an unknown reason.",
      cause: {
        message: "RPC Request failed.",
        cause: {
          code: 3,
          message: "execution reverted",
          data: "0xf290fcfb",
        },
      },
    };
    expect(findRevertData(err)).toBe("0xf290fcfb");
  });

  it("returns undefined when no .data is found anywhere in the chain", () => {
    expect(findRevertData({ message: "network timeout" })).toBeUndefined();
  });

  it("does not infinite-loop on circular .cause references", () => {
    const circular: any = { message: "loop" };
    circular.cause = circular;
    expect(findRevertData(circular)).toBeUndefined();
  });
});

// P0-5 修復驗證：這兩種情況必須在送出任何鏈上交易「之前」就短路回傳，
// 不需要連線、不需要私鑰簽章，才能安全地在 CI 裡測試。
describe("executeRawTransferWithSessionKey input validation (no chain access)", () => {
  it("returns SKIPPED for a malformed recipient address, without broadcasting", async () => {
    const result = await executeRawTransferWithSessionKey("0xHACKER_STOLE_THE_KEY", "1000000");
    expect(result.status).toBe("SKIPPED");
    expect(result.error_code).toBe("INVALID_ADDRESS");
    expect(result.tx_hash).toBeUndefined();
  });

  it("returns SKIPPED for a non-integer amount, without broadcasting", async () => {
    const result = await executeRawTransferWithSessionKey(
      "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
      "not-a-number"
    );
    expect(result.status).toBe("SKIPPED");
    expect(result.error_code).toBe("INVALID_AMOUNT");
    expect(result.tx_hash).toBeUndefined();
  });
});


import type { PaymentIntent } from "@pv/shared";
import { validateAmount, readPermissionIdFromApproval, executeTransfer } from "./index.js";

const UINT256_MAX_STR = ((1n << 256n) - 1n).toString();

function makeIntent(overrides: Partial<PaymentIntent>): PaymentIntent {
  return {
    intent_id: "test-intent",
    invoice_id: "INV-TEST",
    vendor_name: "Test Vendor",
    recipient: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
    amount_display: 1,
    amount_raw: "1000000",
    token: "USDC",
    action: "transfer",
    reasoning: "unit test",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("validateAmount", () => {
  it("accepts zero (合約未禁止 0，不該由這一層加政策)", () => {
    const r = validateAmount("0");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0n);
  });

  it("accepts a normal USDC amount", () => {
    const r = validateAmount("4800000000");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(4800000000n);
  });

  it("rejects a negative amount", () => {
    const r = validateAmount("-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_code).toBe("INVALID_AMOUNT");
  });

  it("rejects a decimal amount", () => {
    const r = validateAmount("1.5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_code).toBe("INVALID_AMOUNT");
  });

  it("rejects an empty string", () => {
    const r = validateAmount("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_code).toBe("INVALID_AMOUNT");
  });

  it("rejects a hex string", () => {
    const r = validateAmount("0x10");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_code).toBe("INVALID_AMOUNT");
  });

  it("accepts exactly uint256 max", () => {
    const r = validateAmount(UINT256_MAX_STR);
    expect(r.ok).toBe(true);
  });

  it("rejects uint256 max + 1 as AMOUNT_OVERFLOW", () => {
    const r = validateAmount((((1n << 256n) - 1n) + 1n).toString());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_code).toBe("AMOUNT_OVERFLOW");
  });
});

describe("readPermissionIdFromApproval", () => {
  it("extracts permissionId from a valid approval blob", () => {
    const blob = Buffer.from(
      JSON.stringify({
        permissionParams: {
          permissionId: "0xabcd1234",
          policies: [
            {
              policyParams: {
                type: "call",
                policyVersion: "0.0.4",
                policyFlag: "0x0000",
                permissions: [
                  {
                    target: "0x1111111111111111111111111111111111111111",
                    functionName: "aiTransfer",
                    selector: "0xd4eb9b1e",
                    callType: "0x00",
                    valueLimit: "0",
                    rules: [],
                    abi: [
                      {
                        type: "function",
                        name: "aiTransfer",
                        stateMutability: "nonpayable",
                        inputs: [
                          { name: "token", type: "address" },
                          { name: "to", type: "address" },
                          { name: "amount", type: "uint256" },
                          { name: "invoiceHash", type: "bytes32" },
                        ],
                        outputs: [{ type: "bool" }],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        action: {
          address: "0x0000000000000000000000000000000000000000",
          selector: "0xe9ae5c53",
        },
        validityData: { validAfter: 0, validUntil: 0 },
        accountParams: {
          initCode: "0x",
          accountAddress: "0x2222222222222222222222222222222222222222",
        },
        enableSignature: "0x12",
        isPreInstalled: false,
      })
    ).toString("base64");
    expect(readPermissionIdFromApproval(blob)).toBe("0xabcd1234");
  });

  it("throws when the blob is not decodable JSON", () => {
    expect(() => readPermissionIdFromApproval("zzzz-not-json")).toThrow();
  });

  it("throws when permissionId is missing", () => {
    const blob = Buffer.from(JSON.stringify({ permissionParams: {} })).toString("base64");
    expect(() => readPermissionIdFromApproval(blob)).toThrow();
  });
});

describe("executeTransfer input validation (no chain access)", () => {
  it("returns SKIPPED for a malformed recipient, without broadcasting", async () => {
    const r = await executeTransfer(makeIntent({ recipient: "not-an-address" }));
    expect(r.status).toBe("SKIPPED");
    expect(r.error_code).toBe("INVALID_ADDRESS");
    expect(r.tx_hash).toBeUndefined();
  });

  it("returns SKIPPED for a negative amount, without broadcasting", async () => {
    const r = await executeTransfer(makeIntent({ amount_raw: "-100" }));
    expect(r.status).toBe("SKIPPED");
    expect(r.error_code).toBe("INVALID_AMOUNT");
    expect(r.tx_hash).toBeUndefined();
  });
});


import { assertExpectedAccount } from "./index.js";

describe("assertExpectedAccount", () => {
  it("accepts the same address regardless of letter casing", () => {
    expect(() =>
      assertExpectedAccount(
        "0xEB6D274DAA1C821AE4A16FAC71C74B960750CA2F",
        "0xeb6d274daa1c821ae4a16fac71c74b960750ca2f"
      )
    ).not.toThrow();
  });

  it("throws when the rebuilt account does not match the configured one", () => {
    expect(() =>
      assertExpectedAccount(
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222"
      )
    ).toThrow(/不一致/);
  });
});


import { interpretUserOpReceipt, buildReceiptTimeoutResult } from "./index.js";

const receiptCtx = { intent_id: "i-1", user_op_hash: "0xop", executed_at: "2026-08-31T00:00:00.000Z" };

describe("interpretUserOpReceipt", () => {
  it("returns EXECUTED when the inner call succeeded", () => {
    const r = interpretUserOpReceipt(
      { success: true, receipt: { transactionHash: "0xtx", blockNumber: 123n } },
      receiptCtx
    );
    expect(r.status).toBe("EXECUTED");
    expect(r.tx_hash).toBe("0xtx");
    expect(r.user_op_hash).toBe("0xop");
    expect(r.block_number).toBe(123);
    expect(r.error_code).toBeUndefined();
  });

  it("returns REJECTED when the outer tx was mined but the inner call failed", () => {
    const r = interpretUserOpReceipt(
      { success: false, reason: "", receipt: { transactionHash: "0xtx", blockNumber: 456n } },
      receiptCtx
    );
    expect(r.status).toBe("REJECTED");
    // 被鏈上拒絕也必須保留證據
    expect(r.tx_hash).toBe("0xtx");
    expect(r.block_number).toBe(456);
    expect(r.error_code).toBe("USER_OP_REJECTED");
  });
});

describe("buildReceiptTimeoutResult", () => {
  it("keeps user_op_hash and marks RECEIPT_TIMEOUT", () => {
    const r = buildReceiptTimeoutResult({
      intent_id: "i-2",
      executed_at: receiptCtx.executed_at,
      user_op_hash: "0xop",
      cause: new Error("timed out"),
    });
    expect(r.user_op_hash).toBe("0xop");
    expect(r.error_code).toBe("RECEIPT_TIMEOUT");
  });

  it("keeps tx_hash and explorer_url when the tx was already broadcast", () => {
    const r = buildReceiptTimeoutResult({
      intent_id: "i-3",
      executed_at: receiptCtx.executed_at,
      tx_hash: "0xtx",
      cause: new Error("timed out"),
    });
    expect(r.tx_hash).toBe("0xtx");
    expect(r.explorer_url).toContain("0xtx");
  });

  it("never claims SKIPPED, because the operation really was broadcast", () => {
    const r = buildReceiptTimeoutResult({
      intent_id: "i-4",
      executed_at: receiptCtx.executed_at,
      tx_hash: "0xtx",
    });
    expect(r.status).not.toBe("SKIPPED");
  });
});


describe("PENDING status (shared 型別已支援)", () => {
  it("reports PENDING with the hash preserved, never a silent failure", () => {
    const r = buildReceiptTimeoutResult({
      intent_id: "i-5",
      executed_at: "2026-08-31T00:00:00.000Z",
      user_op_hash: "0xop",
      cause: new Error("timed out"),
    });
    expect(r.status).toBe("PENDING");
    expect(r.user_op_hash).toBe("0xop");
    expect(r.error_code).toBe("RECEIPT_TIMEOUT");
  });
});


import { validateChainRuntimeConfig } from "./index.js";
import { KERNEL_INIT_CODE_FIXTURE } from "./test-fixtures.js";

const FIXTURE_ACCOUNT = "0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F";
const FIXTURE_TREASURY = "0x29d31dB1A9f694181a2793288aa6903a434E1F55";

/** 組出一份結構完全合法的 approval（不含任何機密）。 */
function buildApproval(overrides: Record<string, unknown> = {}): string {
  const approval = {
    permissionParams: {
      permissionId: "0xabcd1234",
      policies: [
        {
          policyParams: {
            type: "call",
            policyVersion: "0.0.4",
            policyFlag: "0x0000",
            permissions: [
              {
                functionName: "aiTransfer",
                selector: "0xd4eb9b1e",
                callType: "0x00",
                valueLimit: "0",
                rules: [],
                target: FIXTURE_TREASURY,
                abi: [
                  {
                    type: "function",
                    name: "aiTransfer",
                    inputs: [
                      { type: "address" },
                      { type: "address" },
                      { type: "uint256" },
                      { type: "bytes32" },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    action: {
      address: "0x0000000000000000000000000000000000000000",
      selector: "0xe9ae5c53",
    },
    validityData: { validAfter: 0, validUntil: 0 },
    accountParams: {
      accountAddress: FIXTURE_ACCOUNT,
      initCode: KERNEL_INIT_CODE_FIXTURE,
    },
    enableSignature: "0xabcd",
    isPreInstalled: false,
    ...overrides,
  };
  return Buffer.from(JSON.stringify(approval)).toString("base64");
}

function validConfig(overrides: Record<string, string | undefined> = {}) {
  return {
    RPC_URL: "https://example.invalid/rpc",
    BUNDLER_RPC: "https://example.invalid/bundler",
    PAYMASTER_RPC: "https://example.invalid/paymaster",
    TREASURY_POLICY_MODULE: FIXTURE_TREASURY,
    USDC_ADDRESS: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    AI_SESSION_PRIVATE_KEY: "0x" + "1".repeat(64),
    SMART_ACCOUNT_ADDRESS: FIXTURE_ACCOUNT,
    SESSION_KEY_APPROVAL: buildApproval(),
    ...overrides,
  };
}

describe("validateChainRuntimeConfig", () => {
  // 沒有這一項，下面所有「應為 false」的測試就算函式永遠回傳 false 也會過
  it("accepts a fully valid configuration", () => {
    expect(validateChainRuntimeConfig(validConfig())).toBe(true);
  });

  it("rejects the configuration when any required key is missing", () => {
    const keys = [
      "RPC_URL",
      "BUNDLER_RPC",
      "PAYMASTER_RPC",
      "TREASURY_POLICY_MODULE",
      "USDC_ADDRESS",
      "AI_SESSION_PRIVATE_KEY",
      "SMART_ACCOUNT_ADDRESS",
      "SESSION_KEY_APPROVAL",
    ];
    for (const key of keys) {
      expect(validateChainRuntimeConfig(validConfig({ [key]: undefined }))).toBe(false);
    }
  });

  it("rejects a non-http RPC endpoint", () => {
    expect(validateChainRuntimeConfig(validConfig({ BUNDLER_RPC: "ws://example.invalid" }))).toBe(false);
  });

  it("rejects an untrimmed URL", () => {
    expect(validateChainRuntimeConfig(validConfig({ RPC_URL: " https://example.invalid " }))).toBe(false);
  });

  it("rejects the zero address", () => {
    expect(
      validateChainRuntimeConfig(
        validConfig({ USDC_ADDRESS: "0x0000000000000000000000000000000000000000" })
      )
    ).toBe(false);
  });

  it("rejects a malformed session private key", () => {
    expect(validateChainRuntimeConfig(validConfig({ AI_SESSION_PRIVATE_KEY: "0xtooshort" }))).toBe(false);
  });

  it("rejects an undecodable approval", () => {
    expect(validateChainRuntimeConfig(validConfig({ SESSION_KEY_APPROVAL: "zzzz" }))).toBe(false);
  });

  it("rejects an approval whose account does not match SMART_ACCOUNT_ADDRESS", () => {
    expect(
      validateChainRuntimeConfig(
        validConfig({ SMART_ACCOUNT_ADDRESS: "0x1111111111111111111111111111111111111111" })
      )
    ).toBe(false);
  });

  it("rejects when the policy module is not among the approval call targets", () => {
    expect(
      validateChainRuntimeConfig(
        validConfig({ TREASURY_POLICY_MODULE: "0x2222222222222222222222222222222222222222" })
      )
    ).toBe(false);
  });
});
