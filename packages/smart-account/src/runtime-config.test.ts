import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentIntent } from "@pv/shared";
import type { ChainRuntimeConfig } from "./index.js";

const REQUIRED_RUNTIME_KEYS = [
  "RPC_URL",
  "BUNDLER_RPC",
  "PAYMASTER_RPC",
  "TREASURY_POLICY_MODULE",
  "USDC_ADDRESS",
  "AI_SESSION_PRIVATE_KEY",
  "SMART_ACCOUNT_ADDRESS",
  "SESSION_KEY_APPROVAL",
] as const;

const MODULE_ENV_KEYS = [
  ...REQUIRED_RUNTIME_KEYS,
  "RPC_URL_FALLBACK",
  "CFO_ROOT_PRIVATE_KEY",
  "DEPLOYER_PRIVATE_KEY",
] as const;

const TREASURY_POLICY_MODULE = "0x1111111111111111111111111111111111111111";
const USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
const SMART_ACCOUNT_ADDRESS = "0x4444444444444444444444444444444444444444";

function makeApproval(
  mutate?: (approval: Record<string, any>) => void
): string {
  const approval: Record<string, any> = {
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
                target: TREASURY_POLICY_MODULE,
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
      accountAddress: SMART_ACCOUNT_ADDRESS,
    },
    enableSignature: "0x12",
    isPreInstalled: false,
  };
  mutate?.(approval);
  return Buffer.from(JSON.stringify(approval)).toString("base64");
}

function makeValidConfig(): ChainRuntimeConfig {
  return {
    RPC_URL: "https://rpc.example",
    BUNDLER_RPC: "https://bundler.example",
    PAYMASTER_RPC: "https://paymaster.example",
    TREASURY_POLICY_MODULE,
    USDC_ADDRESS,
    AI_SESSION_PRIVATE_KEY: `0x${"33".repeat(32)}`,
    SMART_ACCOUNT_ADDRESS,
    SESSION_KEY_APPROVAL: makeApproval(),
  };
}

type RuntimeModuleMocks = {
  deserializePermissionAccount?: (...args: any[]) => any;
  createWalletClient?: (...args: any[]) => any;
};

async function loadRuntime(
  config: ChainRuntimeConfig,
  mocks: RuntimeModuleMocks = {}
) {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const key of MODULE_ENV_KEYS) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) vi.stubEnv(key, value);
  }
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined);
  vi.resetModules();
  vi.doUnmock("@zerodev/permissions");
  vi.doUnmock("viem");
  if (mocks.deserializePermissionAccount) {
    vi.doMock("@zerodev/permissions", async () => ({
      ...(await vi.importActual<typeof import("@zerodev/permissions")>(
        "@zerodev/permissions"
      )),
      deserializePermissionAccount: mocks.deserializePermissionAccount,
    }));
  }
  if (mocks.createWalletClient) {
    vi.doMock("viem", async () => ({
      ...(await vi.importActual<typeof import("viem")>("viem")),
      createWalletClient: mocks.createWalletClient,
    }));
  }
  return import("./index.js");
}

function makeIntent(): PaymentIntent {
  return {
    intent_id: "runtime-test-intent",
    invoice_id: "INV-RUNTIME-TEST",
    vendor_name: "Runtime Test Vendor",
    recipient: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
    amount_display: 1,
    amount_raw: "1000000",
    token: "USDC",
    action: "transfer",
    reasoning: "runtime readiness regression",
    created_at: "2026-09-01T00:00:00.000Z",
  };
}

import { KERNEL_INIT_CODE_FIXTURE } from "./test-fixtures.js";

describe("chain runtime configuration validation", () => {
  let runtime: typeof import("./index.js");

  beforeAll(async () => {
    runtime = await loadRuntime({});
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("accepts a complete, syntactically valid runtime configuration", () => {
    expect(runtime.validateChainRuntimeConfig(makeValidConfig())).toBe(true);
  });

  it.each(REQUIRED_RUNTIME_KEYS)("rejects a runtime missing %s", (key) => {
    const config = makeValidConfig();
    delete config[key];
    expect(runtime.validateChainRuntimeConfig(config)).toBe(false);
  });

  it("uses the documented fallback RPC default when RPC_URL_FALLBACK is absent", () => {
    const config = makeValidConfig();
    delete config.RPC_URL_FALLBACK;
    expect(runtime.validateChainRuntimeConfig(config)).toBe(true);
  });

  // 既有的正向案例使用空的 initCode（"0x"）。這一項確認「真實、非空的
  // Kernel initCode」同樣能通過 decodeParamsFromInitCode 檢查。
  it("accepts a real, non-empty Kernel initCode", () => {
    const approval = makeApproval((a) => {
      a.accountParams.initCode = KERNEL_INIT_CODE_FIXTURE;
    });
    expect(
      runtime.validateChainRuntimeConfig({
        ...makeValidConfig(),
        SESSION_KEY_APPROVAL: approval,
      })
    ).toBe(true);
  });

  // 前後空白會讓端點字串在不同環境被解讀成不同的值，必須擋掉。
  it.each(["RPC_URL", "BUNDLER_RPC", "PAYMASTER_RPC"] as const)(
    "rejects an untrimmed %s",
    (key) => {
      expect(
        runtime.validateChainRuntimeConfig({
          ...makeValidConfig(),
          [key]: " https://rpc.example ",
        })
      ).toBe(false);
    }
  );

  it.each([
    ["RPC_URL", "ftp://rpc.example"],
    ["RPC_URL_FALLBACK", "not-a-url"],
    ["BUNDLER_RPC", "ws://bundler.example"],
    ["PAYMASTER_RPC", "https://"],
    ["TREASURY_POLICY_MODULE", "0x1234"],
    ["USDC_ADDRESS", "not-an-address"],
    ["AI_SESSION_PRIVATE_KEY", "0x1234"],
    ["SMART_ACCOUNT_ADDRESS", "0x1234"],
    ["SESSION_KEY_APPROVAL", "not-base64-json"],
  ] as const)("rejects invalid %s format", (key, value) => {
    expect(
      runtime.validateChainRuntimeConfig({ ...makeValidConfig(), [key]: value })
    ).toBe(false);
  });

  it.each(["TREASURY_POLICY_MODULE", "USDC_ADDRESS", "SMART_ACCOUNT_ADDRESS"] as const)(
    "rejects zero address for %s",
    (key) => {
      expect(
        runtime.validateChainRuntimeConfig({
          ...makeValidConfig(),
          [key]: "0x0000000000000000000000000000000000000000",
        })
      ).toBe(false);
    }
  );

  it.each([`0x${"00".repeat(32)}`, `0x${"ff".repeat(32)}`])(
    "rejects an invalid secp256k1 private key scalar",
    (privateKey) => {
      expect(
        runtime.validateChainRuntimeConfig({
          ...makeValidConfig(),
          AI_SESSION_PRIVATE_KEY: privateKey,
        })
      ).toBe(false);
    }
  );

  it.each([
    ["non-canonical base64", `${makeApproval()}!`],
    [
      "non-4-byte permissionId",
      makeApproval((approval) => {
        approval.permissionParams.permissionId = "0xabcd";
      }),
    ],
    [
      "embedded private key",
      makeApproval((approval) => {
        approval.privateKey = `0x${"55".repeat(32)}`;
      }),
    ],
    [
      "missing account params",
      makeApproval((approval) => {
        delete approval.accountParams;
      }),
    ],
    [
      "empty policies",
      makeApproval((approval) => {
        approval.permissionParams.policies = [];
      }),
    ],
    [
      "wrong smart account",
      makeApproval((approval) => {
        approval.accountParams.accountAddress =
          "0x5555555555555555555555555555555555555555";
      }),
    ],
    [
      "wrong call-policy target",
      makeApproval((approval) => {
        approval.permissionParams.policies[0].policyParams.permissions[0].target =
          "0x5555555555555555555555555555555555555555";
      }),
    ],
    [
      "wrong call selector",
      makeApproval((approval) => {
        approval.permissionParams.policies[0].policyParams.permissions[0].selector =
          "0xdeadbeef";
      }),
    ],
    [
      "delegate call",
      makeApproval((approval) => {
        approval.permissionParams.policies[0].policyParams.permissions[0].callType =
          "0xff";
      }),
    ],
    [
      "non-zero native value limit",
      makeApproval((approval) => {
        approval.permissionParams.policies[0].policyParams.permissions[0].valueLimit =
          "999";
      }),
    ],
    [
      "an extra permission",
      makeApproval((approval) => {
        approval.permissionParams.policies[0].policyParams.permissions.push({
          ...approval.permissionParams.policies[0].policyParams.permissions[0],
          target: "0x5555555555555555555555555555555555555555",
        });
      }),
    ],
    [
      "a custom policy address",
      makeApproval((approval) => {
        approval.permissionParams.policies[0].policyParams.policyAddress =
          "0x5555555555555555555555555555555555555555";
      }),
    ],
    [
      "invalid initCode",
      makeApproval((approval) => {
        approval.accountParams.initCode = "0x12";
      }),
    ],
    [
      "invalid validity data",
      makeApproval((approval) => {
        approval.validityData.validUntil = "never";
      }),
    ],
    [
      "an empty enable signature",
      makeApproval((approval) => {
        approval.enableSignature = "0x";
      }),
    ],
  ])("rejects approval with %s", (_label, approval) => {
    expect(
      runtime.validateChainRuntimeConfig({
        ...makeValidConfig(),
        SESSION_KEY_APPROVAL: approval,
      })
    ).toBe(false);
  });
});

describe("chain runtime module wiring and execution guards", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("imports a complete runtime as ready and exposes its permission ID", async () => {
    const runtime = await loadRuntime(makeValidConfig());
    expect(runtime.chainRuntimeReady()).toBe(true);
    expect(runtime.sessionPermissionId).toBe("0xabcd1234");
  });

  it.each(REQUIRED_RUNTIME_KEYS)("reports not ready when env %s is missing", async (key) => {
    const config = makeValidConfig();
    delete config[key];
    const runtime = await loadRuntime(config);
    expect(runtime.chainRuntimeReady()).toBe(false);
  });

  it("keeps import safe when approval is malformed", async () => {
    const runtime = await loadRuntime({
      ...makeValidConfig(),
      SESSION_KEY_APPROVAL: "not-base64-json",
    });
    expect(runtime.sessionPermissionId).toBeUndefined();
    expect(runtime.chainRuntimeReady()).toBe(false);
  });

  it("executeTransfer throws before executor/RPC work when valid input has incomplete runtime", async () => {
    const config = makeValidConfig();
    delete config.RPC_URL;
    const deserializePermissionAccount = vi.fn();
    const runtime = await loadRuntime(config, { deserializePermissionAccount });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected network access"));
    await expect(runtime.executeTransfer(makeIntent())).rejects.toThrow(
      /CHAIN_RUNTIME_NOT_CONFIGURED/
    );
    expect(deserializePermissionAccount).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("executeRawTransferWithSessionKey throws before executor/RPC work when runtime is incomplete", async () => {
    const config = makeValidConfig();
    delete config.RPC_URL;
    const sendTransaction = vi.fn();
    const createWalletClient = vi.fn(() => ({ sendTransaction }));
    const runtime = await loadRuntime(config, { createWalletClient });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected network access"));
    await expect(
      runtime.executeRawTransferWithSessionKey(
        "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
        "1000000"
      )
    ).rejects.toThrow(/CHAIN_RUNTIME_NOT_CONFIGURED/);
    expect(createWalletClient).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
