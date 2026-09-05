# Threat model

## Security objective

An AI-assisted payment workflow must not move treasury value outside the authority explicitly granted by trusted policy, even when invoice text or the AI agent is malicious.

This is a defense-in-depth prototype, not a claim of universal prompt-injection detection, formal verification, or production readiness.

## Assets

- Treasury tokens held by the treasury policy contract; the Kernel smart account is the authorized caller.
- Trusted vendor identities and beneficiary addresses.
- Session-key authority and its expiry.
- Approval and duplicate-payment state.
- Payment receipts, policy decisions, and audit evidence.
- Root/owner authority that configures the policy contract.

## Trust boundaries

1. **Invoice boundary:** invoice metadata, memo, and descriptions are untrusted input.
2. **Agent boundary:** model output is a proposal, not authorization.
3. **API/policy boundary:** the API maintains trusted vendor, limit, approval, and duplicate state for deterministic evaluation.
4. **Smart-account permission boundary:** the session signer is restricted to the permitted contract/function path.
5. **Contract boundary:** `TreasuryPolicyModule` independently enforces caller, token, recipient, amount, time-window, expiry, duplicate, and approval constraints.
6. **Root boundary:** the owner/root configuration key is trusted and more powerful than the AI session.

## Threats and controls

| Threat | Example | Primary controls | Residual risk |
| --- | --- | --- | --- |
| Prompt injection / BEC | Invoice says bank details changed and instructs the model to ignore prior rules. | Treat model output as untrusted; compare beneficiary against trusted vendor data; contract recipient whitelist. | Compromise of the trusted vendor registry or root configuration is outside this control. |
| Address replacement | One-character, case, checksum, or middle-character substitution. | Exact beneficiary verification and contract whitelist. | Incorrectly enrolled trusted addresses remain trusted until corrected. |
| Split transactions | Multiple sub-limit payments attempt to evade a larger limit. | Stateful rolling daily limit in policy and contract; sequential benchmark state. | The contract uses conservative hourly buckets, so its effective window may span 24–25 hours. |
| Duplicate payment | Same invoice or intent is submitted again. | Duplicate state in policy and used-intent tracking in contract. | Identifier quality and cross-system reconciliation still matter. |
| Vendor impersonation | Misspelled, cased, suffixed, or unknown vendor. | Trusted vendor registry and exact lookup rules. | Registry administration is a privileged process. |
| Policy override in untrusted text | Memo claims CFO approval or includes extra fields. | Ignore untrusted claims; require policy-owned approval state and supported schema. | A compromised approval service or root can authorize actions. |
| Token/action substitution | Agent changes the token or calls another function. | Token allowlist, structured intent, ZeroDev call policy scoped to `aiTransfer`, contract token check. | Bugs or misconfiguration in dependencies and permissions remain possible. |
| Direct contract bypass | Attacker calls `aiTransfer` without the authorized smart account. | Contract caller restriction; demonstrated reverted transaction. | Root-only functions intentionally retain administrative power. |
| Session-key theft | Attacker obtains the agent’s session signer. | Expiry, call target/function restriction, recipient and amount policy, approval checks. | The attacker can exercise all authority still legitimately granted to that session until expiry/revocation. |
| Replay / stale approval | Reuse a previous approval or payment request. | Used-intent tracking and one-time approval consumption. | Cross-chain or off-chain identifiers require careful domain separation in production. |
| Availability failure | OpenAI, RPC, bundler, or API is unavailable. | Offline recorded intents, prepared chain evidence, explicit source labels. | Payments may be unavailable; the design prioritizes fail-closed behavior over availability. |

## Invariants

- Model text alone cannot change the trusted beneficiary.
- A session signer cannot transfer an unsupported token through the policy path.
- A recipient outside the configured whitelist cannot receive a policy transfer.
- Per-transaction and rolling daily limits must hold for every executed intent.
- Expired sessions cannot execute.
- Reused intent identifiers cannot execute twice.
- Transfers requiring approval cannot execute without valid policy-owned approval.
- A direct, unauthorized call to the transfer function must revert.

## Out of scope / non-goals

- Detecting or classifying every prompt-injection technique.
- Protecting against compromise of the root owner, deployment keys, or trusted vendor onboarding process.
- Proving correctness of ZeroDev, EntryPoint, the token contract, RPC, or bundler.
- Complete privacy of public-chain transaction metadata.
- Production-grade key custody, monitoring, incident response, accounting reconciliation, sanctions screening, or legal compliance.
- Claiming that all 100 attack cases are end-to-end on-chain executions; they are reproducible policy-evaluation cases using recorded intents.

## Evidence map

| Claim | Evidence |
| --- | --- |
| The attack suite has 100 cases with declared expectations. | `attack-lab/cases/`, `attack-lab/index.ts`, and `attack-lab/CASES.md` |
| Offline policy decisions are reproducible. | `pnpm bench --offline` and `benchmark/benchmark-results.json` |
| The smart-account path executed a transaction. | [BaseScan success receipt](https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0) |
| A direct bypass reverted. | [BaseScan reverted receipt](https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477) |
| CI does not call OpenAI for the benchmark. | `.github/workflows/ci.yml` and the explicit `--offline` command |
