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
