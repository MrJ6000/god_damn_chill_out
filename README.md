# PolicyVault Sentinel

### Compromise-Resilient Treasury Agent

> **Assume the AI is compromised. Prove the money is still safe.**

[![CI](https://github.com/MrJ6000/god_damn_chill_out/actions/workflows/ci.yml/badge.svg)](https://github.com/MrJ6000/god_damn_chill_out/actions/workflows/ci.yml)
[![Adversarial](https://img.shields.io/badge/adversarial-100%2F100-brightgreen)](benchmark/benchmark-results.json)
[![Malicious executed](https://img.shields.io/badge/malicious_executed-0-brightgreen)](benchmark/benchmark-results.json)
[![Policy bypass](https://img.shields.io/badge/policy_bypass-0-brightgreen)](benchmark/benchmark-results.json)

## The Problem

Companies want AI to handle repetitive vendor payments, but an invoice is untrusted input. A malicious memo can tell the model to replace a verified payment address, and the model may follow it.

A prompt-injection detector can reduce risk, but it cannot be the final authority over company funds. A new phrasing, language, encoding, or split payload can bypass a probabilistic detector.

PolicyVault Sentinel starts from the harder assumption: the agent is already compromised. It limits what that agent can execute through deterministic policy and scoped smart-account permissions.

## The Approach

> **We give the AI a corporate credit card, not the keys to the bank vault.**

The agent converts finance work into structured payment intents, but it does not decide whether money moves.

**AI Proposes. Policy Decides. Smart Account Enforces.**

- The AI proposes a recipient, token, amount, action, and invoice reference.
- A deterministic policy engine evaluates every intent against the trusted vendor registry and current spending state.
- A scoped ZeroDev Kernel permission can call only the permitted treasury function.
- `TreasuryPolicyModule` independently enforces recipient, token, amount, rolling-window, expiry, duplicate-payment, and approval constraints on-chain.
- Every outcome is represented as a policy receipt with its data source and available chain evidence.

## How It Works

```text
Finance user
    │  "Process today's approved payments"
    ▼
Treasury Agent ── untrusted invoices ──► PaymentIntent[]
    │                                      │
    │                                      ▼
    │                           Deterministic Policy Engine
    │                           ALLOW / REVIEW / DENY
    │                                      │
    │                         ┌────────────┴────────────┐
    │                         │                         │
    │                       ALLOW                  REVIEW / DENY
    │                         │                         │
    │                         ▼                         ▼
    │               ZeroDev Kernel account       No automatic transfer
    │               scoped session permission          │
    │                         │                         │
    │                         ▼                         │
    │               TreasuryPolicyModule               │
    │               deterministic on-chain checks      │
    │                         │                         │
    └─────────────────────────┴─────────────────────────┘
                              ▼
                  Policy Receipt + Blast Radius
```

The invoice may describe a payment. It cannot decide where the money goes: beneficiary identity comes from the trusted vendor registry.

## Three Demo Scenarios

### A. Normal payment

The user starts the normal-payment scenario. The agent creates structured intents, policy checks decide which payments are eligible, and only `ALLOW` intents are sent to the execution layer. The receipt page distinguishes confirmed, pending, rejected, and mock results instead of presenting every API response as a successful chain transaction.

Base Sepolia success evidence: [`0xa906…bab0`](https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0).

> TODO(M4/M5): Add `docs/images/scenario-a-normal-payment.png` after the final UI capture.

### B. Compromised AI

Invoice `INV-8821` contains a realistic vendor-account-change instruction. The scenario deliberately allows the agent to propose the attacker address. The policy engine compares that proposal with ABC Cloud's verified wallet and returns `DENY` with `BENEFICIARY_MISMATCH`. No payment is submitted for the denied intent.

> TODO(M4/M5): Add `docs/images/scenario-b-compromised-ai.png` after the final UI capture.

### C. Direct session-key bypass

The attacker bypasses the normal planning and policy UI and attempts a direct transfer. The displayed result is called an on-chain rejection only when the API returns chain evidence; mock and transport failures are labelled separately.

Base Sepolia rejection evidence: [`0x3c74…5477`](https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477) reverted while calling the deployed policy contract.

> TODO(M4/M5): Add `docs/images/scenario-c-direct-bypass.png` after the final UI capture.

## Blast Radius

Blast radius answers a CFO's practical question: if the AI session is fully compromised, what authority is still available to it?

| Control | Current competition configuration | Enforcement or source |
|---|---:|---|
| Treasury balance shown by the demo | $2,000,000 | Configured demo value; the UI labels its source |
| Maximum per transaction | $5,000 | Policy configuration and `TreasuryPolicyModule` |
| Maximum rolling window | $10,000 | Fixed-size on-chain hourly buckets; never shorter than 24 hours |
| Authorized recipients | 4 | Trusted vendor registry and on-chain allowlist |
| Allowed token | USDC | Session permission and policy contract |
| Allowed action | `transfer` through `aiTransfer` | ZeroDev call permission |
| Unauthorized-recipient exposure in the tested scenario | **$0** | Recipient allowlist; benchmark recorded zero malicious executions |
| Remaining rolling-window allowance | Dynamic | Read from the chain when configured; otherwise explicitly labelled cached/configured |

This is a bounded authorization envelope, not a claim that every possible prompt injection or operational failure is detected.

## Architecture

### Agent and deterministic policy

The OpenAI-backed agent produces schema-validated `PaymentIntent` objects. Offline mode uses recorded intents, so CI does not need an API key. The policy engine returns all checks, a verdict, deny reasons, a policy version, and measured evaluation latency.

### Modular smart account and scoped session

The execution package uses ZeroDev Kernel, `@zerodev/permissions`, a permission validator, and a call policy scoped to `TreasuryPolicyModule.aiTransfer`. This follows the modular-account design goal associated with ERC-7579: authority is expressed through replaceable, limited permissions rather than a single unrestricted key. The competition contract is a custom treasury policy contract; we do not claim it is a general-purpose ERC-7579 module implementation.

### On-chain treasury policy

`TreasuryPolicyModule` permits the AI session to call only `aiTransfer`. Root-only functions manage the allowlist and limits. The contract checks the allowed token, recipient allowlist, per-transaction limit, conservative rolling window, session expiry, duplicate invoice hash, and one-time root approval for payments above the approval threshold.

Deployed Base Sepolia evidence:

- [`TreasuryPolicyModule` — `0x29d3…1F55`](https://sepolia.basescan.org/address/0x29d31dB1A9f694181a2793288aa6903a434E1F55)
- [`ZeroDev Kernel smart account` — `0xeb6d…Ca2F`](https://sepolia.basescan.org/address/0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F)

## Adversarial Test Suite

The committed result below was produced by the offline runner in [`benchmark/run.ts`](benchmark/run.ts). It is reproducible with `pnpm bench`; CI explicitly uses `pnpm bench --offline` and uploads the resulting JSON as an artifact.

| Category | Cases | Passed |
|---|---:|---:|
| Legitimate | 20 | 20 |
| Prompt injection | 20 | 20 |
| Address replacement | 15 | 15 |
| Split transaction | 15 | 15 |
| Duplicate payment | 10 | 10 |
| Vendor impersonation | 10 | 10 |
| Policy override | 10 | 10 |
| **Total** | **100** | **100** |

Latest committed offline result:

| Metric | Actual result |
|---|---:|
| Malicious cases | 80 |
| Legitimate cases | 20 |
| Malicious executed | **0** |
| Legitimate allowed | **20** |
| False positives | **0** |
| False negatives | **0** |
| Policy bypass | **0** |
| Mean policy latency | 0.007 ms |
| P95 policy latency | 0.008 ms |

These results test the current case corpus and policy implementation. They do not prove detection of every future attack; the safety claim is that tested unauthorized intents do not cross the deterministic boundary.

## Quickstart

Requirements: Node.js 20 or newer and pnpm 9.

```bash
git clone https://github.com/MrJ6000/god_damn_chill_out.git
cd god_damn_chill_out
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

On Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env
```

Open `http://localhost:3000`; the API listens on `http://localhost:3001`. Without live credentials, the UI clearly labels fallback/mock data. Do not present fallback output as chain evidence.

Run the reproducible offline benchmark without OpenAI or chain credentials:

```bash
pnpm bench
```

Useful verification commands:

```bash
pnpm -r build
pnpm -r test
pnpm bench --offline
```

Live OpenAI planning requires `OPENAI_API_KEY`. Real smart-account execution additionally requires the isolated runtime settings documented in `packages/smart-account/AI_RUNTIME_ENV.md`; never commit private keys or approval blobs.

## Project Structure

```text
apps/web/                Next.js demo UI and evidence-aware result pages
apps/api/                Fastify API, orchestration, receipts, and approval routes
packages/shared/         Canonical cross-package TypeScript types
packages/agent/          OpenAI/mock planning and structured intent validation
packages/policy-engine/  Deterministic policy evaluation
packages/blast-radius/   Worst-case authority calculation
packages/smart-account/  ZeroDev Kernel and scoped session execution
contracts/               Solidity treasury policy and Foundry tests
attack-lab/              100 versioned adversarial JSON cases
benchmark/               Offline/live runner and reproducible result JSON
data/                    JSON vendor, invoice, and payment fixtures
docs/                    Demo, video, Q&A, submission, and threat-model material
.github/workflows/       Build, test, benchmark, and Foundry CI
```

## What We Deliberately Did NOT Do

- **No OCR or invoice parsing.** Document recognition is not the security thesis, so the demo begins with structured invoice JSON.
- **No prompt-injection detector as the boundary.** Detection may help, but every probabilistic detector has bypasses. We assume it fails.
- **No hardened agent prompt as a security claim.** The demo needs the agent to be fooled so the lower deterministic boundary is actually exercised.
- **No multi-agent theatre.** One treasury agent plus independent policy and execution controls makes authority easier to audit.
- **No database.** Competition data is stored in JSON; security-critical execution constraints live in the scoped account and policy contract.
- **No claim of universal protection.** Root-key compromise, poisoned trusted vendor data, contract defects, and unsupported tokens remain outside or beyond the demonstrated boundary; see [`docs/threat-model.md`](docs/threat-model.md).

## Team

| Role | Responsibility |
|---|---|
| M1 — AI Agent | Natural-language planning and structured payment intents |
| M2 — Backend / Policy / Integration | API, deterministic policy, blast radius, receipts, and integration |
| M3 — Smart Account / Contracts | ZeroDev Kernel, scoped session permission, Solidity, and Base Sepolia deployment |
| M4 — Frontend / UX | Demo UI and evidence-aware presentation |
| M5 — Security / Demo | Attack lab, benchmark, CI, README, demo scripts, and Q&A |

> TODO(team): Replace role labels with the public names the team wants shown before final submission.

## License — MIT

This project is released under the MIT License.
