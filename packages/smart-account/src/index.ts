import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
} catch {
  // 已經載入過，或呼叫端（M2 的 app）自己已經載入 .env 了，都沒關係
}

import {
  createKernelAccount,
  createZeroDevPaymasterClient,
  createKernelAccountClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { toCallPolicy, CallPolicyVersion } from "@zerodev/permissions/policies";
import { toPermissionValidator } from "@zerodev/permissions";
import {
  http,
  createPublicClient,
  createWalletClient,
  parseAbi,
  encodeFunctionData,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { PaymentIntent, ExecutionResult } from "@pv/shared";

const RPC_URL = process.env.RPC_URL!;
const BUNDLER_RPC = process.env.BUNDLER_RPC!;
const PAYMASTER_RPC = process.env.PAYMASTER_RPC!;
const TREASURY_POLICY_MODULE = process.env.TREASURY_POLICY_MODULE! as `0x${string}`;
const USDC_ADDRESS = process.env.USDC_ADDRESS! as `0x${string}`;
const CFO_ROOT_PRIVATE_KEY = process.env.CFO_ROOT_PRIVATE_KEY! as `0x${string}`;
const AI_SESSION_PRIVATE_KEY = process.env.AI_SESSION_PRIVATE_KEY! as `0x${string}`;
const SMART_ACCOUNT_ADDRESS = process.env.SMART_ACCOUNT_ADDRESS! as `0x${string}`;

// 目前白名單裡的收款人候選清單（Root 手動維護；用來實際上鏈核對算出人數）
const KNOWN_RECIPIENT_CANDIDATES = (
  process.env.KNOWN_RECIPIENT_CANDIDATES ?? "0x464DdfC8C223d05C8e7F8B5cC4dEf679A2e1BE27"
)
  .split(",")
  .map((s) => s.trim() as `0x${string}`)
  .filter(Boolean);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});
const entryPoint = getEntryPoint("0.7");

const treasuryAbi = parseAbi([
  "function aiTransfer(address token, address to, uint256 amount, bytes32 invoiceHash) external returns (bool)",
  "function allowedRecipient(address) external view returns (bool)",
  "function readPermission() external view returns (address token, uint256 perTx, uint256 daily, uint256 remainingToday, uint256 expiry, uint256 policyVer)",
]);

// 跟今天手動 decode selector 用的同一張表
const ERROR_SELECTORS: Record<string, string> = {
  "28ab6450": "NOT_ROOT",
  f290fcfb: "NOT_AI_SESSION",
  "6ee9124e": "RECIPIENT_NOT_ALLOWED",
  "94403b70": "TOKEN_NOT_ALLOWED",
  "9f4af03e": "PER_TX_LIMIT_EXCEEDED",
  ef664d6a: "DAILY_LIMIT_EXCEEDED",
  "531e5a05": "SESSION_EXPIRED",
  df33b86d: "DUPLICATE_PAYMENT",
  "4faf6892": "APPROVAL_REQUIRED",
};

function mapErrorCode(text: string): string {
  const lower = text.toLowerCase();
  for (const [selector, code] of Object.entries(ERROR_SELECTORS)) {
    if (lower.includes(selector.toLowerCase())) return code;
  }
  return "USER_OP_REJECTED";
}

let cachedKernelClient: Awaited<ReturnType<typeof buildKernelClient>> | null = null;

async function buildKernelClient() {
  const rootAccount = privateKeyToAccount(CFO_ROOT_PRIVATE_KEY);
  const aiAccount = privateKeyToAccount(AI_SESSION_PRIVATE_KEY);

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    entryPoint,
    signer: rootAccount,
    kernelVersion: KERNEL_V3_1,
  });
  const aiSessionSigner = await toECDSASigner({ signer: aiAccount });
  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [
      {
        target: TREASURY_POLICY_MODULE,
        abi: treasuryAbi,
        functionName: "aiTransfer",
      },
    ],
  });
  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint,
    signer: aiSessionSigner,
    policies: [callPolicy],
    kernelVersion: KERNEL_V3_1,
  });
  const account = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator, regular: permissionPlugin },
    kernelVersion: KERNEL_V3_1,
  });

  const kernelPaymaster = createZeroDevPaymasterClient({
    chain: baseSepolia,
    transport: http(PAYMASTER_RPC),
  });
  const kernelClient = createKernelAccountClient({
    account,
    chain: baseSepolia,
    bundlerTransport: http(BUNDLER_RPC),
    paymaster: {
      getPaymasterData(userOperation) {
        return kernelPaymaster.sponsorUserOperation({ userOperation });
      },
    },
  });

  return { account, kernelClient };
}

async function getKernelClient() {
  if (!cachedKernelClient) {
    cachedKernelClient = await buildKernelClient();
  }
  return cachedKernelClient;
}

// 1. 正常執行（M2 在政策 ALLOW 後呼叫）
export async function executeTransfer(intent: PaymentIntent): Promise<ExecutionResult> {
  const executed_at = new Date().toISOString();
  try {
    const { account, kernelClient } = await getKernelClient();
    const invoiceHash = keccak256(toBytes(intent.invoice_id));

    const callData = await account.encodeCalls([
      {
        to: TREASURY_POLICY_MODULE,
        value: 0n,
        data: encodeFunctionData({
          abi: treasuryAbi,
          functionName: "aiTransfer",
          args: [USDC_ADDRESS, intent.recipient as `0x${string}`, BigInt(intent.amount_raw), invoiceHash],
        }),
      },
    ]);

    const userOpHash = await kernelClient.sendUserOperation({ callData });
    const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });

    return {
      intent_id: intent.intent_id,
      status: "EXECUTED",
      tx_hash: receipt.receipt.transactionHash,
      user_op_hash: userOpHash,
      block_number: Number(receipt.receipt.blockNumber),
      explorer_url: `https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`,
      executed_at,
    };
  } catch (err: any) {
    const text = `${err?.message ?? ""} ${err?.details ?? ""} ${JSON.stringify(err?.cause ?? {})}`;
    return {
      intent_id: intent.intent_id,
      status: "REJECTED",
      error_code: mapErrorCode(text),
      error_message: err?.shortMessage ?? err?.message ?? String(err),
      executed_at,
    };
  }
}

// 2. Demo 幕三：模擬駭客偷走 AI session 私鑰、直接呼叫合約（繞過 Smart Account）
//    刻意不走 ERC-4337 bundler（bundler 會在送出前就攔截模擬失敗的交易，
//    無法產生「真的上鏈、真的被拒絕」的紀錄），改用最原始的 EOA 交易，
//    並明確帶 gas 才能跳過 eth_estimateGas 的預先攔截，讓交易真的送上鏈。
export async function executeRawTransferWithSessionKey(
  recipient: string,
  amountRaw: string
): Promise<ExecutionResult> {
  const executed_at = new Date().toISOString();
  const intent_id = `raw-bypass-${Date.now()}`;
  try {
    const aiAccount = privateKeyToAccount(AI_SESSION_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account: aiAccount,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });
    const invoiceHash = keccak256(toBytes(`RAW-BYPASS-${Date.now()}`));
    const data = encodeFunctionData({
      abi: treasuryAbi,
      functionName: "aiTransfer",
      args: [USDC_ADDRESS, recipient as `0x${string}`, BigInt(amountRaw), invoiceHash],
    });

    const txHash = await walletClient.sendTransaction({
      to: TREASURY_POLICY_MODULE,
      data,
      gas: 200_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "reverted") {
      let errorText = "";
      try {
        await publicClient.call({
          account: aiAccount.address,
          to: TREASURY_POLICY_MODULE,
          data,
          blockNumber: receipt.blockNumber,
        });
      } catch (simErr: any) {
        errorText = `${simErr?.message ?? ""} ${JSON.stringify(simErr?.cause ?? {})}`;
      }
      return {
        intent_id,
        status: "REJECTED",
        tx_hash: txHash,
        block_number: Number(receipt.blockNumber),
        explorer_url: `https://sepolia.basescan.org/tx/${txHash}`,
        error_code: mapErrorCode(errorText || "f290fcfb"),
        error_message: "Raw session key call rejected on-chain by TreasuryPolicyModule",
        executed_at,
      };
    }

    return {
      intent_id,
      status: "EXECUTED",
      tx_hash: txHash,
      block_number: Number(receipt.blockNumber),
      explorer_url: `https://sepolia.basescan.org/tx/${txHash}`,
      executed_at,
    };
  } catch (err: any) {
    return {
      intent_id,
      status: "REJECTED",
      error_code: "RPC_ERROR",
      error_message: err?.shortMessage ?? err?.message ?? String(err),
      executed_at,
    };
  }
}

// 3. 給 Blast Radius 讀鏈上真實權限
export async function readSessionPermission() {
  const [token, perTx, daily, remainingToday, expiry] = await publicClient.readContract({
    address: TREASURY_POLICY_MODULE,
    abi: treasuryAbi,
    functionName: "readPermission",
  });

  let authorized_recipient_count = 0;
  for (const candidate of KNOWN_RECIPIENT_CANDIDATES) {
    const ok = await publicClient.readContract({
      address: TREASURY_POLICY_MODULE,
      abi: treasuryAbi,
      functionName: "allowedRecipient",
      args: [candidate],
    });
    if (ok) authorized_recipient_count++;
  }

  return {
    allowed_token: token,
    max_per_tx_raw: perTx.toString(),
    max_per_24h_raw: daily.toString(),
    remaining_24h_raw: remainingToday.toString(),
    expires_at: new Date(Number(expiry) * 1000).toISOString(),
    authorized_recipient_count,
  };
}

// 4. 健康檢查（M2 啟動時會呼叫）
export async function chainHealth() {
  try {
    const [chainId, blockNumber, permission] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getBlockNumber(),
      readSessionPermission(),
    ]);
    const sessionKeyValid = new Date(permission.expires_at).getTime() > Date.now();
    return {
      ok: true,
      chainId,
      blockNumber: Number(blockNumber),
      smartAccount: SMART_ACCOUNT_ADDRESS,
      sessionKeyValid,
    };
  } catch {
    return {
      ok: false,
      chainId: 0,
      blockNumber: 0,
      smartAccount: SMART_ACCOUNT_ADDRESS,
      sessionKeyValid: false,
    };
  }
}
