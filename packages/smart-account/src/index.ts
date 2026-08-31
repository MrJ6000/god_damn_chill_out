import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Review #3：本模組只允許在「AI runtime」環境執行。
// 讀的是 .env.ai-runtime（刻意不含 CFO Root / Deployer 私鑰），
// 而不是根目錄那份什麼都有的 .env。
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env.ai-runtime"));
} catch {
  // 已經載入過，或呼叫端（M2 的 app）自己已經載入了，都沒關係
}

// Fail-closed：只要這個 process 的環境中出現特權私鑰，就代表載入了錯誤的
// 環境檔（例如整份根目錄 .env）。此時直接拒絕啟動，不帶著特權金鑰運作。
for (const forbidden of ["CFO_ROOT_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]) {
  if (process.env[forbidden]) {
    throw new Error(
      `[smart-account] 拒絕啟動：process 環境中存在 ${forbidden}。` +
        "AI runtime 只能載入 .env.ai-runtime。若是在終端機 source 過根目錄 .env，" +
        "請改用乾淨的 shell，或以 env -u CFO_ROOT_PRIVATE_KEY -u DEPLOYER_PRIVATE_KEY <指令> 執行。"
    );
  }
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

/**
 * Review #4：讓 M2 的 API 可以 fail-closed 驗證這個模組的執行模式。
 * 這兩個匯出值都不含任何機密資訊。
 */

/**
 * Review #1：用於「已廣播、但結果尚未確認」的狀態。
 * shared 的 ExecutionResult.status 已加入 "PENDING"（M2 於 PR #13 補上）。
 * 一旦取得 userOpHash / txHash，之後任何等待失敗都回報此狀態，並保留 hash 與
 * error_code = "RECEIPT_TIMEOUT"，讓呼叫端能區分「未確認」與「確定被鏈上拒絕」，
 * 避免把可能已成功的付款誤判為失敗而重送。
 * 合約端的 paidInvoice 重複付款保護是第二道防線。
 */
const PENDING_STATUS: ExecutionResult["status"] = "PENDING";

/** 靜態宣告：本模組只會使用 AI Session Key，不會使用 CFO Root Key。 */
export const sessionKeyOnly = true;

/**
 * 從 SESSION_KEY_APPROVAL 取出穩定、非秘密的 permissionId。
 * 這個值由權限政策內容推導而來，可用來辨識「目前生效的是哪一組權限設定」。
 * 解析失敗時直接拋錯（fail-closed），不回傳空值。
 */
export function readPermissionIdFromApproval(approval: string): string {
  let decoded: any;
  try {
    decoded = JSON.parse(Buffer.from(approval, "base64").toString("utf-8"));
  } catch {
    throw new Error("SESSION_KEY_APPROVAL 無法解碼為 JSON，請重新產生 approval 字串。");
  }
  const id = decoded?.permissionParams?.permissionId;
  if (typeof id !== "string" || !id.startsWith("0x")) {
    throw new Error("SESSION_KEY_APPROVAL 中找不到 permissionParams.permissionId，請重新產生 approval 字串。");
  }
  return id;
}

/** 目前生效的權限設定識別碼（非秘密，可供 API 記錄與稽核）。 */
export const sessionPermissionId = readPermissionIdFromApproval(SESSION_KEY_APPROVAL);

/**
 * Review #5：金額驗證抽成純函式，不需要網路或私鑰即可測試。
 * 規則：只接受十進位非負整數字串；0 允許（合約未禁止），負數、小數、
 * 十六進位、空字串、超過 uint256 上限一律拒絕。
 */
export type AmountValidation =
  | { ok: true; value: bigint }
  | { ok: false; error_code: string; error_message: string };

const UINT256_MAX = (1n << 256n) - 1n;

/** receipt 判讀所需的最小結構，讓單元測試可以餵假物件進來。 */
export type UserOpReceiptLike = {
  success: boolean;
  reason?: string;
  receipt: { transactionHash: string; blockNumber: bigint | number };
};

/**
 * Review #5：把「拿到 receipt 之後怎麼判讀」抽成純函式。
 * UserOp 被打包成功（外層交易 success）不等於內層呼叫成功，必須看 receipt.success。
 */
export function interpretUserOpReceipt(
  receipt: UserOpReceiptLike,
  ctx: { intent_id: string; user_op_hash: string; executed_at: string }
): ExecutionResult {
  const txHash = receipt.receipt.transactionHash;
  const base = {
    intent_id: ctx.intent_id,
    tx_hash: txHash,
    user_op_hash: ctx.user_op_hash,
    block_number: Number(receipt.receipt.blockNumber),
    explorer_url: `https://sepolia.basescan.org/tx/${txHash}`,
    executed_at: ctx.executed_at,
  };
  if (!receipt.success) {
    const reasonText = receipt.reason ?? "";
    return {
      ...base,
      status: "REJECTED",
      error_code: mapErrorCode(reasonText),
      error_message:
        reasonText || "UserOperation reverted on-chain (bundler tx succeeded, inner call failed)",
    };
  }
  return { ...base, status: "EXECUTED" };
}

/**
 * Review #1：已送出但等不到 receipt 時的結果。一定保留已取得的 hash，
 * 並用 error_code = "RECEIPT_TIMEOUT" 表明「未確認」而非「已被拒絕」。
 */
export function buildReceiptTimeoutResult(ctx: {
  intent_id: string;
  executed_at: string;
  user_op_hash?: string;
  tx_hash?: string;
  cause?: any;
}): ExecutionResult {
  const causeText =
    ctx.cause?.shortMessage ?? ctx.cause?.message ?? (ctx.cause ? String(ctx.cause) : "");
  const ref = ctx.tx_hash ?? ctx.user_op_hash ?? "(unknown)";
  return {
    intent_id: ctx.intent_id,
    status: PENDING_STATUS,
    ...(ctx.tx_hash
      ? { tx_hash: ctx.tx_hash, explorer_url: `https://sepolia.basescan.org/tx/${ctx.tx_hash}` }
      : {}),
    ...(ctx.user_op_hash ? { user_op_hash: ctx.user_op_hash } : {}),
    error_code: "RECEIPT_TIMEOUT",
    error_message:
      `等待 receipt 逾時：${ref} 已送出但結果尚未確認，仍可能成功。` +
      `請以 hash 回鏈上查證。（原始錯誤：${causeText}）`,
    executed_at: ctx.executed_at,
  };
}

/**
 * Fail-closed：由 approval 字串重建出的帳戶，必須就是環境檔登記的 Smart Account。
 * 不一致通常代表 approval 與 .env 不同步（例如合約重新部署後忘了重新產生 approval），
 * 這時寧可當場停下來，也不要從非預期的地址送出付款。
 * 抽成純函式以便單元測試。
 */
export function assertExpectedAccount(
  actual: string,
  expected: string = SMART_ACCOUNT_ADDRESS
): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `[smart-account] 拒絕啟動：由 SESSION_KEY_APPROVAL 重建出的帳戶地址 ${actual} ` +
        `與環境設定的 SMART_ACCOUNT_ADDRESS ${expected} 不一致。` +
        "合約重新部署後請重新產生 approval 字串。"
    );
  }
}

export function validateAmount(amountRaw: string): AmountValidation {
  const text = typeof amountRaw === "string" ? amountRaw.trim() : "";
  if (!/^[0-9]+$/.test(text)) {
    return {
      ok: false,
      error_code: "INVALID_AMOUNT",
      error_message: `"${amountRaw}" is not a valid non-negative integer amount; nothing was broadcast on-chain`,
    };
  }
  const value = BigInt(text);
  if (value > UINT256_MAX) {
    return {
      ok: false,
      error_code: "AMOUNT_OVERFLOW",
      error_message: `"${amountRaw}" exceeds uint256 range; nothing was broadcast on-chain`,
    };
  }
  return { ok: true, value };
}



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
  assertExpectedAccount(account.address);

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

  // Review #5：送上鏈之前先驗證輸入。還沒廣播就失敗的，一律 SKIPPED，
  // 不能謊稱是鏈上拒絕（REJECTED）。
  if (!isAddress(intent.recipient, { strict: false })) {
    return {
      intent_id: intent.intent_id,
      status: "SKIPPED",
      error_code: "INVALID_ADDRESS",
      error_message: `"${intent.recipient}" is not a valid 20-byte EVM address; nothing was broadcast on-chain`,
      executed_at,
    };
  }
  const amountCheck = validateAmount(intent.amount_raw);
  if (!amountCheck.ok) {
    return {
      intent_id: intent.intent_id,
      status: "SKIPPED",
      error_code: amountCheck.error_code,
      error_message: amountCheck.error_message,
      executed_at,
    };
  }

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
          args: [USDC_ADDRESS, intent.recipient as `0x${string}`, amountCheck.value, invoiceHash],
        }),
      },
    ]);

    const userOpHash = await kernelClient.sendUserOperation({ callData });

    // Review #1：UserOp 已經送出去了。從這一刻起，任何等待失敗都不能謊稱
    // 「沒送出」或「已被拒絕」，而且必須把 hash 留下來，讓呼叫端可以事後
    // 自己回鏈上查證真正的結果。
    let receipt: Awaited<ReturnType<typeof kernelClient.waitForUserOperationReceipt>>;
    try {
      receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });
    } catch (waitErr: any) {
      // 逾時不等於失敗。先盡力補查一次：如果其實已經上鏈，就回報真正的結果，
      // 不要把一筆可能已完成的付款回報成 PENDING。
      try {
        const late = await kernelClient.getUserOperationReceipt({ hash: userOpHash });
        if (late) {
          return interpretUserOpReceipt(late as unknown as UserOpReceiptLike, {
            intent_id: intent.intent_id,
            user_op_hash: userOpHash,
            executed_at,
          });
        }
      } catch {
        // 補查也失敗，維持「未確認」的誠實回報
      }
      return buildReceiptTimeoutResult({
        intent_id: intent.intent_id,
        executed_at,
        user_op_hash: userOpHash,
        cause: waitErr,
      });
    }

    // Review #5：receipt 判讀抽成純函式，成功／失敗兩種情況都能單元測試。
    return interpretUserOpReceipt(receipt, {
      intent_id: intent.intent_id,
      user_op_hash: userOpHash,
      executed_at,
    });
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
  const amountCheck = validateAmount(amountRaw);
  if (!amountCheck.ok) {
    return {
      intent_id,
      status: "SKIPPED",
      error_code: amountCheck.error_code,
      error_message: amountCheck.error_message,
      executed_at,
    };
  }
  const amountBig = amountCheck.value;

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
    // Review #1：交易已經廣播出去（txHash 存在），等待回執失敗時不能謊稱
    // SKIPPED（宣稱沒送出），也不能謊稱 REJECTED（宣稱被鏈上拒絕）。保留 hash。
    return buildReceiptTimeoutResult({
      intent_id,
      executed_at,
      tx_hash: txHash,
      cause: err,
    });
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
