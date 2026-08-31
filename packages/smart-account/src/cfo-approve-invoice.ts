import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
} catch {
  // ignore
}

// ⚠️ 這支腳本（連同 generate-session-approval.ts、Deploy.s.sol）
// 是唯二／唯三會用到 CFO_ROOT_PRIVATE_KEY 的地方。
// 平常 AI 執行付款用的 index.ts 完全不會載入這把鑰匙。
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

const RPC_URL = process.env.RPC_URL!;
const TREASURY_POLICY_MODULE = process.env.TREASURY_POLICY_MODULE! as `0x${string}`;
const USDC_ADDRESS = process.env.USDC_ADDRESS! as `0x${string}`;
const CFO_ROOT_PRIVATE_KEY = process.env.CFO_ROOT_PRIVATE_KEY! as `0x${string}`;

const treasuryAbi = parseAbi([
  "function approveInvoice(address token, address recipient, uint256 amount, bytes32 invoiceHash) external",
]);

async function main() {
  const [, , recipient, amountRaw, invoiceId] = process.argv;
  if (!recipient || !amountRaw || !invoiceId) {
    console.error(
      "用法：pnpm --filter @pv/smart-account run cfo-approve -- <recipient> <amountRaw> <invoiceId>"
    );
    process.exit(1);
  }

  const rootAccount = privateKeyToAccount(CFO_ROOT_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account: rootAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const invoiceHash = keccak256(toBytes(invoiceId));
  const data = encodeFunctionData({
    abi: treasuryAbi,
    functionName: "approveInvoice",
    args: [USDC_ADDRESS, recipient as `0x${string}`, BigInt(amountRaw), invoiceHash],
  });

  console.log(`CFO Root (${rootAccount.address}) 核准付款：`);
  console.log(`  收款人: ${recipient}`);
  console.log(`  金額 (最小單位): ${amountRaw}`);
  console.log(`  發票 ID: ${invoiceId} -> invoiceHash: ${invoiceHash}`);

  const txHash = await walletClient.sendTransaction({ to: TREASURY_POLICY_MODULE, data });
  console.log("Approve tx:", txHash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("Status:", receipt.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
