process.loadEnvFile("../../.env");

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
  parseAbi,
  encodeFunctionData,
  parseUnits,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL!;
const BUNDLER_RPC = process.env.BUNDLER_RPC!;
const PAYMASTER_RPC = process.env.PAYMASTER_RPC!;
const TREASURY_POLICY_MODULE = process.env.TREASURY_POLICY_MODULE! as `0x${string}`;
const USDC_ADDRESS = process.env.USDC_ADDRESS! as `0x${string}`;
const CFO_ROOT_PRIVATE_KEY = process.env.CFO_ROOT_PRIVATE_KEY! as `0x${string}`;
const AI_SESSION_PRIVATE_KEY = process.env.AI_SESSION_PRIVATE_KEY! as `0x${string}`;

const VENDOR_1 = "0x464DdfC8C223d05C8e7F8B5cC4dEf679A2e1BE27" as const;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

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
    plugins: {
      sudo: ecdsaValidator,
      regular: permissionPlugin,
    },
    kernelVersion: KERNEL_V3_1,
  });

  console.log("Smart Account:", account.address);

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

  const invoiceHash = keccak256(toBytes("INV-DEMO-SESSION-1"));

  const callData = await account.encodeCalls([
    {
      to: TREASURY_POLICY_MODULE,
      value: 0n,
      data: encodeFunctionData({
        abi: treasuryAbi,
        functionName: "aiTransfer",
        args: [USDC_ADDRESS, VENDOR_1, parseUnits("1", 6), invoiceHash],
      }),
    },
  ]);

  console.log("Sending UserOp via AI-scoped session key...");
  const userOpHash = await kernelClient.sendUserOperation({ callData });
  console.log("UserOp Hash:", userOpHash);

  const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });
  console.log("=== SUCCESS ===");
  console.log("Tx Hash:", receipt.receipt.transactionHash);
  console.log("Explorer:", `https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`);
}

main().catch((err) => {
  console.error("=== FAILED ===");
  console.error(err);
  process.exit(1);
});
