import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
} catch {
  // ignore
}

import { createKernelAccount } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { toCallPolicy, CallPolicyVersion } from "@zerodev/permissions/policies";
import { toPermissionValidator, serializePermissionAccount } from "@zerodev/permissions";
import { http, createPublicClient, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ⚠️ 這支腳本是唯一會用到 CFO_ROOT_PRIVATE_KEY 的地方。
// 目的：CFO Root「離線」授權一次，產生出可攜式的 approval 字串，
// 之後平常執行付款的 index.ts 完全不需要碰 CFO Root 私鑰。
const RPC_URL = process.env.RPC_URL!;
const TREASURY_POLICY_MODULE = process.env.TREASURY_POLICY_MODULE! as `0x${string}`;
const CFO_ROOT_PRIVATE_KEY = process.env.CFO_ROOT_PRIVATE_KEY! as `0x${string}`;
const AI_SESSION_PRIVATE_KEY = process.env.AI_SESSION_PRIVATE_KEY! as `0x${string}`;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
const entryPoint = getEntryPoint("0.7");
const treasuryAbi = parseAbi([
  "function aiTransfer(address token, address to, uint256 amount, bytes32 invoiceHash) external returns (bool)",
]);

async function main() {
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

  const approval = await serializePermissionAccount(account);
  console.log("Smart Account:", account.address);
  console.log("SESSION_KEY_APPROVAL=" + approval);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
