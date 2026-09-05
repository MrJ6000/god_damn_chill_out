# Demo image checklist

The three screenshots below were captured from the submission checkout based on code commit `5820eb7`, using local Web/API on ports 3310/3311 with `MOCK_AGENT=1`, `MOCK_CHAIN=1`, and `ENABLE_DIRECT_BYPASS=1`. They are unedited browser captures of simulated execution, not live AI calls or chain evidence. See [verification](../verification.md) for observed results.

Included files:

- `scenario-a-normal-payment.png` — ALLOW and one INV-8801 mock receipt for 1,250 USDC; no on-chain transfer.
- `scenario-b-compromised-ai.png` — proposed attacker address, trusted address, and `BENEFICIARY_MISMATCH` DENY result.
- `scenario-c-direct-bypass.png` — API MOCK MODE / NOT SUBMITTED; the historical reverted transaction is linked separately in the README.

Before committing each image:

- Confirm the source label correctly says live, mock, recorded, or cached.
- Confirm addresses, amounts, verdicts, and links match repository evidence.
- Crop unused UI and compress the image to a reasonable web size.
- Do not add video files or large raw captures to the repository.
