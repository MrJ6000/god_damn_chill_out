# PolicyVault Sentinel — 2-minute video script

Target length: 1:50–2:00. Record the application and browser only; exclude `.env` files, private keys, API keys, personal email, and unrelated browser tabs.

| Time | Visual | Voice-over / caption |
| --- | --- | --- |
| 0:00–0:10 | Title card and home page. | “Prompt injection can make an AI payment agent propose the wrong transfer. PolicyVault Sentinel assumes that failure will happen.” |
| 0:10–0:28 | Architecture view: invoice → agent → deterministic policy → smart account. | “The model proposes intent. A deterministic policy engine verifies vendor, beneficiary, token, limits, approvals, and duplicates before execution.” |
| 0:28–0:48 | Run **Normal payment** and show ALLOW/receipt. | “A valid invoice matches the trusted vendor record and passes policy.” |
| 0:48–1:10 | Run **AI compromised** and zoom in on both addresses. | “A realistic invoice instruction persuades the agent to replace the beneficiary. PolicyVault does not need to recognize every injection: the address mismatch is enough to deny payment.” |
| 1:10–1:28 | Run **Direct attack** and show the reverted BaseScan transaction. | “Skipping the AI does not bypass the contract. The direct call reverts because the caller lacks the authorized execution path.” |
| 1:28–1:44 | Show Blast Radius and the benchmark summary. | “Authority remains bounded. The reproducible offline suite contains 100 cases; the committed run matched all expected decisions and executed zero malicious payments.” |
| 1:44–1:58 | Closing title and repository link. | “PolicyVault Sentinel: let AI propose, but never let AI define the security boundary.” |

## On-screen evidence

- Repository: [github.com/MrJ6000/god_damn_chill_out](https://github.com/MrJ6000/god_damn_chill_out)
- Normal execution: [BaseScan](https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0)
- Rejected direct bypass: [BaseScan](https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477)
- Offline result: `benchmark/benchmark-results.json`

## Editing notes

- Add captions for `ALLOW`, `DENY`, `BENEFICIARY_MISMATCH`, and `reverted`.
- Keep both beneficiary addresses visible long enough to compare.
- Do not label a mock, cached, or pre-recorded result as live.
- Export the final video outside the repository and upload it to the organizer-approved platform.
- Do not commit `.mp4`, `.mov`, or other large binary files.

## Outstanding publication fields

- Final video URL: **TODO — add after upload**
- Final duration: **TODO — record after export**
- Presenter name: **TODO — confirm team roster**
