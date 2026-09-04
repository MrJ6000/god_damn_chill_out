# PolicyVault Sentinel — 3-minute demo script

This script keeps every security claim tied to visible evidence. If the live chain or API is unavailable, use the verified transaction links below and say that the live dependency is unavailable; do not describe cached or mock data as a live transaction.

## Before the presentation

- Run `pnpm dev` and confirm the web app reports the expected API/runtime source.
- Coordinate any data reset with the API owner. The web reset control does not necessarily erase backend payment history.
- Open the two BaseScan links in separate tabs before presenting.
- Keep `.env` files, private keys, API keys, and terminal history out of the recording.
- Keep a local screen recording or screenshots as a fallback, but do not commit the video to Git.
- Confirm the benchmark evidence comes from `benchmark/benchmark-results.json`.

## Live script

| Time | Action | Suggested narration | Evidence to point at |
| --- | --- | --- | --- |
| 0:00–0:20 | Show the home page. | “AI can read invoices and propose payments, but it is not the security boundary. PolicyVault assumes the AI may be manipulated.” | The three scenario buttons and the deterministic-policy message. |
| 0:20–0:55 | Click **① Normal payment** and follow the flow to the receipt. | “For a legitimate invoice, the proposed recipient matches the trusted vendor record, the amount is within policy, and execution is allowed.” | ALLOW decision, verified recipient, amount, receipt, and transaction link when live evidence is available. |
| 0:55–1:35 | Return home and click **② AI compromised**. | “This invoice contains a convincing business-email-compromise instruction. We intentionally allow the agent layer to propose the attacker’s address. The deterministic policy compares it with the trusted beneficiary and denies execution.” | Proposed address versus verified address, `BENEFICIARY_MISMATCH`, DENY, and zero value executed. |
| 1:35–1:58 | Return home and click **③ Direct attack**. | “An attacker now skips the AI and calls the payment policy contract directly. The transaction reverts because only the authorized smart-account path may execute the transfer.” | Reverted transaction and contract address. |
| 1:58–2:22 | Click **View Blast Radius**. | “Even if the agent is compromised, its authority is constrained by token, recipient, per-transaction, rolling daily, expiry, duplicate, and approval controls.” | Current configuration values and source labels shown in the UI. |
| 2:22–2:43 | Show the benchmark result in the repository or prepared terminal output. | “The offline adversarial suite contains 100 reproducible policy cases. In the recorded run, all expected outcomes matched and none of the 74 must-not-execute cases received an aggregate ALLOW verdict.” | The committed result file, including its policy-evaluation-only scope, run time, totals, and category counts. |
| 2:43–3:00 | Return to the architecture or home page. | “We do not claim to detect every prompt injection. We assume the AI can fail, then enforce a deterministic boundary below it.” | Architecture and final tagline. |

## Verified chain evidence

- Normal smart-account execution: [BaseScan transaction `0xa906…bab0`](https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0)
- Direct bypass rejected: [BaseScan transaction `0x3c74…5477`](https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477)
- Treasury policy contract: [`0x29d3…1F55`](https://sepolia.basescan.org/address/0x29d31dB1A9f694181a2793288aa6903a434E1F55)
- Smart account: [`0xeb6d…Ca2F`](https://sepolia.basescan.org/address/0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F)

## Fallback rules

1. If OpenAI is unavailable, state that the agent call is unavailable and use the recorded offline scenario. Do not call it a live model response.
2. If the RPC or bundler is unavailable, show the already-verified BaseScan transaction and state its date/source. Do not claim a new transaction was submitted.
3. If the API is unavailable, use the prepared recording or screenshots and say the live API is unavailable.
4. If the UI displays cached evidence, explicitly call it cached evidence.
5. Never expose secrets while troubleshooting on stage.

## Rehearsal checklist

- [ ] Scenario A reaches an ALLOW decision and the receipt is readable.
- [ ] Scenario B visibly shows the proposed and trusted addresses plus `BENEFICIARY_MISMATCH`.
- [ ] Scenario C opens the reverted BaseScan transaction.
- [ ] Blast Radius values match the active configuration.
- [ ] Benchmark result is the committed, reproducible offline output.
- [ ] Presenter finishes in three minutes.
- [ ] Backup recording is available outside the Git repository.
