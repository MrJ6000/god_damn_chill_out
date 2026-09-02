# PolicyVault Sentinel
### Compromise-Resilient Treasury Agent

> **Assume the AI is compromised. Prove the money is still safe.**

[![CI](https://github.com/MrJ6000/god_damn_chill_out/actions/workflows/ci.yml/badge.svg)](https://github.com/MrJ6000/god_damn_chill_out/actions/workflows/ci.yml)

---

⚠️ **這是骨架版 README。M5 負責在 9/3 前寫完整版。**

結構請照 `04_你的任務書.md` 的第五節：

- The Problem
- The Approach
- How It Works
- Three Demo Scenarios
- Blast Radius
- Architecture
- Adversarial Test Suite
- Quickstart
- Project Structure
- What We Deliberately Did NOT Do
- Team
- License (MIT)

---

## Quickstart（開發用）

```bash
pnpm install
cp .env.example .env
pnpm dev            # 前端 :3000 / 後端 :3001
pnpm -r test
pnpm bench          # 100 個攻擊案例（M5 完成後可用）
```

## Project Structure

```
apps/web/              前端（M4）
apps/api/              REST API（M2）
packages/shared/       共用型別 ⚠️ 只有 M2 能改
packages/agent/        Treasury AI Agent（M1）
packages/policy-engine/決定性政策引擎（M2）
packages/blast-radius/ 爆炸半徑（M2）
packages/smart-account/ZeroDev / viem 封裝（M3）
contracts/             Solidity + Foundry（M3）
attack-lab/            100 個攻擊案例（M5）
benchmark/             測試執行器與結果（M5）
docs/                  Demo 腳本、Pitch、Q&A（M5）
data/                  vendors / invoices / payments（M2）
```

## License

MIT
