# Judge Q&A

## 1. Why use AI if deterministic rules make the payment decision?

AI is useful for interpreting invoices, extracting intent, and handling varied business language. It is not trusted to grant itself authority. The deterministic layer answers a different question: whether the proposed action is permitted.

## 2. Why use a blockchain instead of a normal database?

The prototype targets programmable treasury execution. The smart account and policy contract make execution constraints independently auditable and produce public transaction evidence. A database is still appropriate for application state, but it is not the final execution boundary in this design.

## 3. Can PolicyVault detect every prompt injection?

No. That is explicitly not our claim. The attack lab includes cases where the AI is assumed to be deceived. Security comes from checking the resulting payment intent against trusted data and deterministic constraints before value moves.

## 4. Is the policy engine just an `if` statement?

Individual checks are simple on purpose, but the security property comes from consistent enforcement and state: trusted vendors and beneficiaries, token scope, per-transaction limits, rolling daily limits, session expiry, duplicate prevention, and one-time approvals. The same decision must be reproducible for the same state and input.

## 5. Is the custom contract an ERC-7579 module?

We should describe the current implementation precisely: the smart account uses ZeroDev Kernel and its permission/call-policy stack to restrict the session signer to `TreasuryPolicyModule.aiTransfer`. The repository also contains the custom treasury policy contract. We do not claim that this custom contract is a general-purpose ERC-7579 module.

## 6. How is this different from Safe's spending limit?

Safe provides wallet-level primitives for constrained spending and is a credible production option. PolicyVault focuses on the decision and authorization layer before execution: binding intent to trusted vendor identity, quantifying a compromised session's blast radius, and retaining an auditable path from invoice intent to execution. This prototype uses ZeroDev Kernel because its permission tooling fits the session-key flow; the choice is not a claim that Safe is insecure.

## 7. How is this different from AWS AgentCore Payments?

AgentCore provides agent payment infrastructure and guardrails. PolicyVault's demonstrated scope is enterprise treasury authorization under a compromise-first assumption: bind the proposed payment to a trusted beneficiary, calculate bounded authority, enforce deterministic policy, and retain verifiable execution evidence. The systems could be complementary.

## 8. How is this different from Google AP2 or other agent-payment protocols?

Those systems may define authorization and payment-agent workflows. PolicyVault’s specific contribution is an adversarial demonstration and deterministic treasury boundary around payment intent. A production integration could use a protocol such as AP2 upstream while retaining deterministic execution controls below it.

## 9. Who would buy this, and what does it cost?

The target users are organizations experimenting with AI-assisted accounts-payable or treasury workflows and needing bounded authority plus audit evidence. Pricing has not been validated, so we should not quote an invented price. The next commercial step is customer discovery with finance, security, and compliance teams.

## 10. Is the on-chain demo real?

The repository records historical Base Sepolia success and rejection transactions, including three successful transfers (0.5, 1, and 1 USDC) and one rejected direct call. See [the current verification record](verification.md) for receipt checks and timestamps. If the application uses cached evidence or a mock runtime, say so explicitly; those modes do not create a new chain transaction.

- [Successful execution](https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0)
- [Rejected direct bypass](https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477)

## Evidence discipline

- Say “recorded offline run” for `benchmark/benchmark-results.json`.
- Say “verified Base Sepolia transaction” for the two linked receipts.
- Say “live” only after checking the current runtime/source label.
- Do not claim universal prompt-injection detection, production readiness, formal verification, a completed security audit, or finalized pricing.
