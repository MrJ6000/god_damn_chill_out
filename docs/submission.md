# Submission copy and checklist

Use this page as a source for the organizer form. Replace every `TODO` before final submission; do not infer missing team or publication details.

## Project identity

- **Name:** PolicyVault Sentinel
- **Tagline:** Let AI propose payments; let deterministic policy decide whether value can move.
- **Repository:** [github.com/MrJ6000/god_damn_chill_out](https://github.com/MrJ6000/god_damn_chill_out)
- **Demo URL:** **TODO — add deployed application URL**
- **Video URL:** **TODO — add after upload**
- **Track/category:** **TODO — confirm against the organizer form**
- **Team members:** **TODO — add the organizer-approved public names**

## Short description

PolicyVault Sentinel is a defense-in-depth prototype for AI-assisted treasury payments. It assumes an AI agent may be manipulated, then validates the proposed payment against trusted beneficiary data and deterministic policy before a permission-scoped smart account can execute it.

## Full description

AI agents can extract payment intent from invoices, but invoice text is untrusted. A realistic business-email-compromise message can persuade a model to replace a beneficiary address while the rest of the invoice looks legitimate. PolicyVault Sentinel deliberately demonstrates that failure instead of claiming universal prompt-injection detection.

The agent produces structured payment intent. A deterministic policy engine checks vendor identity, beneficiary, token, transaction and rolling daily limits, session expiry, duplicate payment state, and required approval. The smart-account permission path is scoped to the treasury policy contract. The demo shows a normal payment, a compromised-agent proposal denied for beneficiary mismatch, and a direct contract bypass that reverts on Base Sepolia.

The repository includes 100 versioned attack cases and an offline policy benchmark runner. The committed run matched all 100 expected outcomes, allowed all 20 legitimate cases, and gave no aggregate `ALLOW` verdict to the 74 cases marked `must_not_execute`. The runner does not execute payments; on-chain execution evidence is listed separately below. These figures are recorded output, not estimates.

## Technology

- TypeScript monorepo with pnpm
- Next.js web application and Fastify API
- OpenAI structured-output agent with an offline recorded-intent path
- Deterministic policy engine
- ZeroDev Kernel smart account with permission/call policy
- Solidity treasury policy contract on Base Sepolia
- GitHub Actions with offline adversarial benchmark

## Reproducible security evidence

- Attack cases: `attack-lab/cases/`
- Case design: `attack-lab/CASES.md`
- Offline command: `pnpm bench --offline`
- Recorded result: `benchmark/benchmark-results.json`
- Normal execution: [BaseScan transaction](https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0)
- Rejected direct bypass: [BaseScan transaction](https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477)
- Treasury policy: [`0x29d31dB1A9f694181a2793288aa6903a434E1F55`](https://sepolia.basescan.org/address/0x29d31dB1A9f694181a2793288aa6903a434E1F55)
- Smart account: [`0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F`](https://sepolia.basescan.org/address/0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F)

## Scope statement

PolicyVault does not claim to detect all prompt injections. It demonstrates that a compromised model’s proposed payment can still be blocked by deterministic application and contract controls. The prototype is not represented as audited or production-ready.

## Final submission checklist

- [ ] Replace every `TODO` above.
- [ ] Confirm the repository or submission branch includes the latest M5 commit.
- [ ] Confirm the required GitHub Actions jobs are green on the submission commit.
- [ ] Run `pnpm bench --offline` and retain the unedited output/artifact.
- [ ] Open both BaseScan links and verify their success/revert statuses.
- [ ] Add the deployed demo URL and verify all three scenarios.
- [ ] Upload the video outside Git and add its URL.
- [ ] Confirm names, email addresses, sponsor-credit forms, and track selection through the organizer’s official channel.
- [ ] Remove secrets and personal data from screenshots and video.
