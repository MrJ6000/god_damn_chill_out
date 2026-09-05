# 提交準備：驗證紀錄

本紀錄區分本機檢查、遠端 CI、模擬畫面與歷史鏈上證據。文件整理以 `5820eb7d80db718b369939a16d4b9b2eca80274a` 為程式基準，沒有修改應用程式、政策或合約實作。

準備日期：2026-09-05～09-06（Asia/Taipei）；以下機器時間使用 UTC。這是提交準備紀錄，不代表 Google Form 已送出。

## 本機安裝與測試

| 項目 | 實際結果 |
| --- | --- |
| 環境 | Windows PowerShell、Node.js 24.13.1、pnpm 9.12.0 |
| `corepack pnpm install --frozen-lockfile` | 成功；lockfile 未改動 |
| `corepack pnpm -r build` | 成功；包含 Next.js production build 與各套件型別檢查 |
| `corepack pnpm -r test` | 195 項通過；OPENAI_API_KEY 清空，使用 CI 的非機密 session approval fixture |
| `corepack pnpm bench --offline` | 100/100 案例符合預期；未呼叫真實模型、未送鏈上交易 |
| 本機 Foundry | 本次未執行；遠端主分支 contracts job 結果列於下一節 |
| 文件檢查 | 11 份 Markdown、76 個相對連結均有對應檔案；`git diff --check` 通過；展示文件無 TODO／Fastify 殘留 |

| Vitest 範圍 | 通過數 |
| --- | ---: |
| AI Agent | 15 |
| Policy Engine | 25 |
| Web | 32 |
| Smart Account | 85 |
| API | 38 |
| **總計** | **195** |

Shared 沒有測試；Blast Radius 沒有獨立測試檔，並未加入通過數。完整指令與測試 fixture 見 [重現指南](reproduce.md)。

## 離線 benchmark 原始輸出

[offline-benchmark-2026-09-05.json](evidence/offline-benchmark-2026-09-05.json) 是本次 runner 產生的未改寫輸出。執行前以 `GITHUB_SHA` 注入程式基準，避免輸出只有 `uncommitted`。

- Code commit：`5820eb7`。
- Run time：`2026-09-05T15:53:04.770Z`。
- Scope：`policy_evaluation_only`。
- 100 個案例、20 個合法、80 個惡意，全部符合既定預期。
- 74 個 `must_not_execute` 案例的整體 `ALLOW` 數為 0；20 個合法案例皆獲准。
- Mean policy latency：0.005 ms；P95：0.007 ms。這只量測政策函式，不含模型、網路或鏈上確認時間。

多筆 intents 的案例以 `DENY > REVIEW > ALLOW` 聚合。某個拆單案例整體遭拒，不表示較早的所有 intents 也都遭拒。上述數值不能推導未知攻擊防護率或實際鏈上損失上限。

## GitHub 狀態

準備時查驗 [main CI 33842721710](https://github.com/MrJ6000/god_damn_chill_out/actions/runs/33842721710)：

| 欄位 | 結果 |
| --- | --- |
| Head | `5820eb7d80db718b369939a16d4b9b2eca80274a` |
| Run | completed / success |
| `test` job | success；build、workspace tests、offline benchmark 與 artifact |
| `contracts` job | success；Foundry |

Repository 準備時為 **PRIVATE**，PR #26 仍開啟。上述 CI 不代表本次文件分支或日後合併 commit 的 CI；最終繳交需再核對其 SHA、必要 jobs 與評審存取權。[最終清單](submission-checklist.md)

## 瀏覽器展示驗證

使用本次獨立 checkout，Web `localhost:3310`、API `localhost:3311`，避免干擾既有 3000／3001 服務。啟用 `MOCK_AGENT=1`、`MOCK_CHAIN=1`、`ENABLE_DIRECT_BYPASS=1`；模擬 session 到期時間設為啟動後七天。

| 情境 | 觀察結果 | 截圖 |
| --- | --- | --- |
| 正常付款 | `/receipt/PV-0001`；`INV-8801`、1,250 USDC、`ALLOW`、`MOCK_CHAIN`；API receipts 僅一筆；執行時間 `2026-09-05T15:53:58.571Z` | [正常付款](images/scenario-a-normal-payment.png) |
| AI 遭入侵 | `INV-8821`；提案地址 `0x8888…8888`，可信地址 `0x464D…BE27`；`BENEFICIARY_MISMATCH`；顯示付款未送出 | [政策拒絕](images/scenario-b-compromised-ai.png) |
| 直接攻擊 | `NOT SUBMITTED`、`API MOCK MODE`、`MOCK_CHAIN`、無 TX／USER OP | [直接攻擊模擬](images/scenario-c-direct-bypass.png) |

截圖為瀏覽器原始畫面，保留模式標示。`API 回應` 不等於真實模型呼叫或鏈上付款；模擬 receipt 的 hash 也不是可提交 BaseScan 查驗的交易。驗證產生的付款紀錄不納入提交資料。

## 歷史鏈上紀錄：本次重新核對

在 `2026-09-05T15:55:24Z`～`15:56:58Z`，透過 `https://sepolia.base.org` 的唯讀 JSON-RPC 核對。`eth_chainId = 84532`（Base Sepolia），方法包含 `eth_getTransactionReceipt`、`eth_getTransactionByHash` 與 `eth_call`；交易時間來自 RPC transaction 的 `blockTimestamp`。此次沒有發出新交易。

| 紀錄 | 交易時間 UTC | Status | 區塊 | Gas used | 實際 USDC 轉帳 |
| --- | --- | --- | ---: | ---: | ---: |
| [#7 a906…bab0](https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0) | 2026-08-31 12:33:32 | `0x1` | 46205662 | 577794 | **0.5** |
| [#8 3c74…5477](https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477) | 2026-08-31 12:33:36 | `0x0` | 46205664 | 25139 | **0** |
| [#9 93e5…69d4](https://sepolia.basescan.org/tx/0x93e5059f2bd85cb67291f5f5f8eea154af679b2fcd46ef89d60e2d65151f69d4) | 2026-09-01 11:24:14 | `0x1` | 46246783 | 336933 | **1** |
| [#10 50ee…1ed1](https://sepolia.basescan.org/tx/0x50eed4028c975440296c8934d60099ec6a2eba8726fc09cb60e65c8220c51ed1) | 2026-09-01 11:32:28 | `0x1` | 46247030 | 302769 | **1** |

三筆成功交易的官方測試 USDC `Transfer` 與財務合約 `Transferred` logs 相符：

- Token：`0x036CbD53842c5426634e7929541eC2318f3dCF7e`，`decimals() = 6`。
- 付款來源：`TreasuryPolicyModule`，`0x29d31dB1A9f694181a2793288aa6903a434E1F55`。
- 收款人：ABC Cloud，`0x464DdfC8C223d05C8e7F8B5cC4dEf679A2e1BE27`。
- #7 raw amount = `500000`；#9／#10 = `1000000`。
- 外層目的地為 EntryPoint `0x0000000071727De22E5e9d8BAf0edAc6f37da032`，包含 Kernel `0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F` 的 UserOperation 事件。這不能單憑 receipt 證明當時由哪一個 TypeScript wrapper 發送。

失敗的 #8 **嘗試轉 1 USDC，實際轉 0 USDC**，receipt 無 logs。在歷史區塊 46205664 重放唯讀 `eth_call` 得到 `0xf290fcfb`，與 `NotAiSession()` selector 相符。該次呼叫者是外部帳戶 `0xf32b9ebc91c74b1a527b85d194ee08ad0d4a1d29`，不是當時的授權 Kernel。

因此，此證據支持「未經授權 EOA 直接呼叫遭 caller restriction 拒絕」。它未到達收款人或金額檢查，不等同於 session-key UserOperation 通過 Kernel 後再被白名單拒絕。交易失敗仍消耗 gas。

在歷史區塊 46247030，合約餘額為 raw `18500000`＝18.5 USDC。這是歷史快照，不是目前餘額，也不是 UI 顯示的 2,000,000 美元配置值。

## 尚未完成的繳交步驟

公開／評審可存取的 repository、正式表單網址、可觀看影片、線上 Demo（是否必填待表單確認）、以及成功送出回執，仍須依 [提交資料](submission.md) 與 [檢查清單](submission-checklist.md) 完成。
