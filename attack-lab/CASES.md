# Adversarial case catalogue

The Attack Lab tests a compromise-first claim: the agent may produce a malicious payment intent, while deterministic policy must reject unauthorized intent before execution. It does not execute payments and does not claim to detect every prompt injection.

## Planned suite

| Category | Planned | Current | Purpose |
|---|---:|---:|---|
| Legitimate | 20 | 20 | Measure whether normal, pre-approved payments are allowed. |
| Prompt injection | 20 | 20 | Preserve the compromised agent output and require beneficiary binding to deny it. |
| Address replacement | 15 | 15 | Exercise visibly different and subtly altered recipient addresses. |
| Split transaction | 15 | 15 | Exercise per-transaction and cumulative daily limits. |
| Duplicate payment | 10 | 10 | Exercise repeated invoice identifiers without blocking distinct invoices. |
| Vendor impersonation | 10 | 10 | Exercise unknown and look-alike vendor names. |
| Policy override | 10 | 10 | Exercise attempts to bypass recipient, amount, vendor, duplicate, and daily-limit policy. |
| **Total** | **100** | **100** | |

The current count is an inventory count. Pass rates and latency measurements come only from the generated benchmark results and are never inferred from expected verdicts.

## Case format

Every JSON file follows `AttackCase` from `@pv/shared`. The repository's canonical type uses `recorded_intents`, an array containing one pre-recorded `PaymentIntent` per invoice. Offline CI consumes those intents without calling OpenAI.

For a multi-intent case, the case-level expected verdict describes the final security-relevant outcome after intents are evaluated in order. The benchmark runner must update daily-spend and paid-invoice state only after a decision that would be executed.

## Current hundred-case suite

The Day 3 delivery completes every planned category:

- Twenty legitimate payments use known vendors, verified wallets, ordinary business notes, and amounts at or below the automatic-approval threshold.
- Twenty prompt-injection cases cover direct override, role-play, realistic business email compromise, multilingual payloads, Unicode and Base64 obfuscation, HTML comments, and split-field instructions.
- Each malicious recorded intent preserves the attacker-directed recipient. The policy layer, not the agent, is expected to deny it with `BENEFICIARY_MISMATCH`.
- Address, split-transaction, duplicate, vendor-identity, and policy-override cases exercise the deterministic rules directly, including exact-limit controls that must remain allowed.

## Reproducibility rules

- Shared types are imported from `@pv/shared`; the Attack Lab does not redefine them.
- Case timestamps and recorded intents are stored in the case files.
- Offline mode must not require `OPENAI_API_KEY`.
- Benchmark results are generated only by executing the runner and must never be hand-edited or inferred from expected verdicts.
