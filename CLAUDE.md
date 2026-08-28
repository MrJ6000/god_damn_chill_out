# AGENTS.md — 給所有 AI 編碼助理的規則（Claude Code 會自動讀取）

這是 **PolicyVault Sentinel**，一個由 **5 位成員、5 個獨立 AI 帳號同時開發**的 monorepo。
違反下面的規則會造成其他成員的工作被覆蓋。請嚴格遵守。

---

## 1. 檔案所有權（最重要）

| 成員 | 只能修改 |
|---|---|
| M1 | `packages/agent/**` |
| M2 | `apps/api/**`、`packages/shared/**`、`packages/policy-engine/**`、`packages/blast-radius/**`、`data/**`、根目錄設定檔 |
| M3 | `contracts/**`、`packages/smart-account/**` |
| M4 | `apps/web/**` |
| M5 | `attack-lab/**`、`benchmark/**`、`docs/**`、`.github/**`、`README.md` |

**使用者會在對話開頭告訴你他是哪一位成員。**
在他說明之前，**不要修改任何檔案**——先問他是誰。

只修改該成員擁有的路徑。其他路徑一律**唯讀**：可以讀取、可以 import，**不可以修改**。

如果你認為需要改動別人的檔案，**停下來告訴使用者**，由他去跟該檔案的擁有者溝通。

## 2. 共用型別

`packages/shared/src/types.ts` 是五個模組之間的合約。

- 一律用 `import type { ... } from "@pv/shared"`
- **絕對不要**自己重新定義 `Invoice` / `PaymentIntent` / `PolicyDecision` /
  `BlastRadius` / `PolicyReceipt` / `ExecutionResult` / `AttackCase`
- 只有 M2 可以修改 `packages/shared/`

## 3. 套件管理

```bash
# ✅ 正確
pnpm --filter @pv/<套件名> add <package>

# ❌ 禁止
pnpm add <package>              # 在根目錄
```

**不要修改根目錄的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`**（M2 除外）。

## 4. 機密資訊

- 絕對不要建立或修改 `.env`
- 絕對不要把 API key、私鑰、助記詞寫進任何檔案
- 一律用 `process.env.XXX`
- 新增環境變數時，只在 `.env.example` 加變數名稱（值留空）

## 5. 程式碼風格

- 不要重新格式化既有程式碼。只改必要的行，讓 diff 越小越好
- 語言：TypeScript（合約用 Solidity ^0.8.23）
- 測試：Vitest（合約用 Foundry）
- 不要新增 README、文件、範例腳本，除非使用者明確要求

## 6. 專案的核心設計原則（違反會毀掉整個產品論述）

### 6.1 AI Agent 是「刻意不設防」的
`packages/agent/` 的 Treasury Agent **必須**可以被 prompt injection 攻擊成功。
- 不要加入惡意指令偵測
- 不要「修正」可疑的收款地址
- 不要在 system prompt 加防禦性語句

理由：這個產品證明的是「AI 被攻陷後仍然安全」，不是「AI 不會被攻陷」。

### 6.2 政策引擎必須是決定性的
`packages/policy-engine/` 的 `evaluate()` **必須**是同步的純函式。
- 不能 `async`／`await`
- 不能有任何 I/O（讀檔、網路、LLM）
- 不能直接用 `new Date()`（用注入的 `ctx.now`）

理由：安全邊界不能建立在機率模型或隱藏狀態上。

### 6.3 安全邊界必須真的在鏈上
不可以在 TypeScript 層「假裝」擋下交易然後回傳失敗。
所有拒絕都必須來自合約 revert 或 UserOperation 驗證失敗。
如果某個功能只能用假的方式實作，**直接告訴使用者做不到**。

### 6.4 不要捏造數據
`benchmark/` 的所有數字必須是實際跑出來的。
`README.md` 不能寫任何未實作的功能。

## 7. 每次工作結束

條列你**實際修改／新增／刪除**了哪些檔案，路徑要完整。
使用者會用 `git status` 核對。

---

## 8. 給 Claude Code 的額外說明

- 遇到需要跨多個檔案的改動，**先用 Plan Mode（Shift+Tab 兩次）提出計畫**，
  等使用者確認後再動手。
- SDK 改版很快（ZeroDev、viem、OpenAI SDK）。實作前**先用 WebFetch 讀官方最新文件**，
  不要憑記憶寫 API。
- 除錯 UserOperation 失敗時，請依序：解讀錯誤碼 → 檢查合約 → 檢查 SDK 設定 →
  列出可能原因排序 → 提出方案，**先不要直接改程式**。
