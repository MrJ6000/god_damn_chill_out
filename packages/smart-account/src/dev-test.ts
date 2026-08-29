import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { http, createPublicClient, encodeFunctionData, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

process.loadEnvFile("../../.env");

const RPC = process.env.BUNDLER_RPC as string;
const CFO_ROOT_PRIVATE_KEY = process.env.CFO_ROOT_PRIVATE_KEY as `0x${string}`;
const USDC_ADDRESS = process.env.USDC_ADDRESS as `0x${string}`;
const VENDOR_1_ADDRESS = "0x464DdfC8C223d05C8e7F8B5cC4dEf679A2e1BE27"; // ABC Cloud 測試地址

const chain = baseSepolia;
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function main() {
  const signer = privateKeyToAccount(CFO_ROOT_PRIVATE_KEY);

  const publicClient = createPublicClient({ transport: http(RPC), chain });

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion,
  });

  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    entryPoint,
    kernelVersion,
  });

  console.log("=== Smart Account Address ===");
  console.log(account.address);
  console.log("=== 如果下面失敗，先去 Circle 水龍頭給上面這個地址領一點 Base Sepolia USDC，再重跑一次這個腳本 ===");

  const zerodevPaymaster = createZeroDevPaymasterClient({ chain, transport: http(RPC) });

  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(RPC),
    client: publicClient,
    paymaster: {
      getPaymasterData(userOperation) {
        return zerodevPaymaster.sponsorUserOperation({ userOperation });
      },
    },
  });

  console.log("Sending 1 USDC to Vendor 1...");

  const userOpHash = await kernelClient.sendUserOperation({
    callData: await kernelClient.account.encodeCalls([
      {
        to: USDC_ADDRESS,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [VENDOR_1_ADDRESS, parseUnits("1", 6)],
        }),
      },
    ]),
  });

  console.log("UserOp Hash:", userOpHash);

  const receipt = await kernelClient.waitForUserOperationReceipt({
    hash: userOpHash,
    timeout: 1000 * 60,
  });

  console.log("=== SUCCESS ===");
  console.log("Tx Hash:", receipt.receipt.transactionHash);
  console.log("Explorer:", `https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`);
}

main().catch((err) => {
  console.error("=== FAILED ===");
  console.error(err);
  process.exit(1);
});
