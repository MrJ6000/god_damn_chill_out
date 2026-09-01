import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiClientError, toDemoNotice } from "./api";
import { attackerAddress, mockDirectBypass, mockInvoices } from "./mockData";

describe("web API client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps a successful API envelope and sends the direct-bypass contract", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, data: mockDirectBypass }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }));

    await expect(api.directBypass(attackerAddress, 4_800)).resolves.toEqual(mockDirectBypass);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/attack\/direct-bypass$/);
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(String(init.body))).toEqual({
      amount_display: 4_800,
      recipient: attackerAddress,
    });
  });

  it("throws the API error envelope instead of silently substituting mock data", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: { code: "DIRECT_BYPASS_DISABLED", message: "disabled" },
    }), {
      headers: { "Content-Type": "application/json" },
      status: 403,
    }));

    await expect(api.directBypass(attackerAddress, 4_800)).rejects.toMatchObject({
      code: "DIRECT_BYPASS_DISABLED",
      message: "disabled",
      status: 403,
    });
  });

  it("distinguishes invalid JSON from an API envelope failure", async () => {
    fetchMock.mockResolvedValue(new Response("not-json", { status: 502 }));

    await expect(api.getInvoices()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    });
  });

  it("normalizes transport failures without returning a plausible live payload", async () => {
    fetchMock.mockRejectedValue(new TypeError("connection refused"));

    await expect(api.getInvoices()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(mockInvoices).toHaveLength(18);
  });
});

describe("toDemoNotice", () => {
  it("preserves operation, code, and status for visible fallback provenance", () => {
    const notice = toDemoNotice(
      "執行直接攻擊情境",
      new ApiClientError("CHAIN_RECEIPT_UNAVAILABLE", "receipt unavailable", 502),
    );

    expect(notice).toEqual({
      code: "CHAIN_RECEIPT_UNAVAILABLE",
      message: "鏈上整合尚未完成這次請求，已改用前端備援情境。",
      operation: "執行直接攻擊情境",
      status: 502,
    });
  });
});
