import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
} catch {
  // 已經載入過，或呼叫端（M2 的 app）自己已經載入 .env 了，都沒關係
}

import {
  createZeroDevPaymasterClient,
  createKernelAccountClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { deserializePermissionAccount } from "@zerodev/permissions";
import {
  http,
  createPublicClient,
  createWalletClient,
  parseAbi,
  encodeFunctionData,
  keccak256,
  toBytes,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { PaymentIntent, ExecutionResult } from "@pv/shared";

const RPC_URL = process.env.RPC_URL!;
const BUNDLER_RPC = process.env.BUNDLER_RPC!;
const PAYMASTER_RPC = process.env.PAYMASTER_RPC!;
const TREASURY_POLICY_MODULE = process.env.TREASURY_POLICY_MODULE! as `0x${string}`;
const USDC_ADDRESS = process.env.USDC_ADDRESS! as `0x${string}`;
const AI_SESSION_PRIVATE_KEY = process.env.AI_SESSION_PRIVATE_KEY! as `0x${string}`;
const SMART_ACCOUNT_ADDRESS = process.env.SMART_ACCOUNT_ADDRESS! as `0x${string}`;
// CFO Root 事先（離線）用 generate-session-approval 腳本產生的授權字串。
// 這支檔案從頭到尾不會、也不能載入 CFO_ROOT_PRIVATE_KEY（P0-4 修復）。
const SESSION_KEY_APPROVAL = process.env.SESSION_KEY_APPROVAL!;

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

export function mapErrorCode(text: string): string {
  const lower = text.toLowerCase();
  for (const [selector, code] of Object.entries(ERROR_SELECTORS)) {
    if (lower.includes(selector.toLowerCase())) return code;
  }
  return "USER_OP_REJECTED";
}

// viem 的錯誤物件常常把真正的 revert data 包在好幾層 .cause 裡面
// （例如 err.cause.cause.data === "0xf290fcfb"），直接 JSON.stringify
// 整個 Error 物件通常拿不到這些屬性，所以用這個沿著 .cause 往下找。
export function findRevertData(err: any): string | undefined {
  let current = err;
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current.data === "string" && current.data.startsWith("0x")) {
      return current.data;
    }
    current = current.cause;
  }
  return undefined;
}

let cachedKernelClient: Awaited<ReturnType<typeof buildKernelClient>> | null = null;

async function buildKernelClient() {
  const aiAccount = privateKeyToAccount(AI_SESSION_PRIVATE_KEY);
  const aiSessionSigner = await toECDSASigner({ signer: aiAccount });

  // 用 CFO Root 事先產生好的 approval 字串 + AI 自己的 session key 重建帳戶，
  // 完全不需要（也拿不到）CFO Root 的私鑰。
  const account = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    KERNEL_V3_1,
    SESSION_KEY_APPROVAL,
    aiSessionSigner
  );

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

    if (!receipt.success) {
      // UserOp 真的送上鏈、被打包了，但合約內部執行失敗——
      // 不能只因為「有拿到 receipt」就當作執行成功（P0-1 修復）
      const reasonText = (receipt as any).reason ?? "";
      return {
        intent_id: intent.intent_id,
        status: "REJECTED",
        tx_hash: receipt.receipt.transactionHash,
        user_op_hash: userOpHash,
        block_number: Number(receipt.receipt.blockNumber),
        explorer_url: `https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`,
        error_code: mapErrorCode(reasonText),
        error_message: reasonText || "UserOperation reverted on-chain (bundler tx succeeded, inner call failed)",
        executed_at,
      };
    }

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
    const revertData = findRevertData(err);
    const text = revertData ?? `${err?.shortMessage ?? ""} ${err?.message ?? ""} ${err?.details ?? ""}`;
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
export async function executeRawTransferWithSessionKey(
  recipient: string,
  amountRaw: string
): Promise<ExecutionResult> {
  const executed_at = new Date().toISOString();
  const intent_id = `raw-bypass-${Date.now()}`;

  // 先驗證格式。格式不對代表根本沒有送上鏈，不能謊稱是「鏈上拒絕」（P0-5 修復）
  if (!isAddress(recipient, { strict: false })) {
    return {
      intent_id,
      status: "SKIPPED",
      error_code: "INVALID_ADDRESS",
      error_message: `"${recipient}" is not a valid 20-byte EVM address; nothing was broadcast on-chain`,
      executed_at,
    };
  }
  let amountBig: bigint;
  try {
    amountBig = BigInt(amountRaw);
  } catch {
    return {
      intent_id,
      status: "SKIPPED",
      error_code: "INVALID_AMOUNT",
      error_message: `"${amountRaw}" is not a valid integer amount; nothing was broadcast on-chain`,
      executed_at,
    };
  }

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
    args: [USDC_ADDRESS, recipient as `0x${string}`, amountBig, invoiceHash],
  });

  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.sendTransaction({
      to: TREASURY_POLICY_MODULE,
      data,
      gas: 200_000n,
    });
  } catch (sendErr: any) {
    // 交易根本沒送出去（RPC 錯誤、簽章失敗等），不算「鏈上拒絕」（P0-5 修復）
    return {
      intent_id,
      status: "SKIPPED",
      error_code: "RPC_ERROR",
      error_message: sendErr?.shortMessage ?? sendErr?.message ?? String(sendErr),
      executed_at,
    };
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "reverted") {
      // 交易真的上鏈了、被合約拒絕——這才是 Demo 幕三要證明的事
      let errorText = "";
      try {
        await publicClient.call({
          account: aiAccount.address,
          to: TREASURY_POLICY_MODULE,
          data,
        });
      } catch (simErr: any) {
        errorText = findRevertData(simErr) ?? (simErr?.shortMessage ?? simErr?.message ?? "");
      }
      return {
        intent_id,
        status: "REJECTED",
        tx_hash: txHash,
        block_number: Number(receipt.blockNumber),
        explorer_url: `https://sepolia.basescan.org/tx/${txHash}`,
        error_code: mapErrorCode(errorText),
        error_message: "Raw session key call rejected on-chain by TreasuryPolicyModule",
        executed_at,
      };
    }

    // 理論上不該發生：代表 aiSession 設錯了，直接用 EOA 呼叫居然成功
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
      status: "SKIPPED",
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
