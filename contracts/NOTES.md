# contracts — M3 的工作區

⚠️ 這裡不放 README.md（README 是 M5 專屬）。合約相關筆記寫在這個檔案。

## 開發指令

```bash
forge build
forge test -vvv
forge test --match-test testAiCannotRaiseLimits -vvv

forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

## 分階段實作（每階段測試通過才往下）

- [x] 階段 1：收款人白名單 + 單筆限額 + Session 過期
- [x] 階段 2：24 小時累計限額
- [x] 階段 3：重複付款偵測
- [x] 階段 4：人工簽核狀態

## 部署紀錄（部署後填入，並在群組公告給 M2）

| 項目 | 位址 |
|---|---|
| TreasuryPolicyModule | 0x29d31dB1A9f694181a2793288aa6903a434E1F55 |
| Smart Account | 0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F |
| USDC (Base Sepolia) | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| CFO Root | 0x514De60834d21eC0E67af32F937FE0A83519a4F5 |
| AI Session (Scoped, via Smart Account) | 0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F |
| Hacker（Demo 用，無人持有私鑰） | 0x8888888888888888888888888888888888888888 |

## 成功交易備份（保命用，9/2 前備妥 3 筆）

| # | 用途 | Tx Hash |
|---|---|---|
| 1 | 正常付款成功（P0-4 修復後，只用 Session Key，無 CFO 私鑰） | 0xf47afb6c1d067510947daa7029750da9ab3029980dcaca0eb1fe3b1414c74720 |
| 2 | 白名單外被拒 | 0xb2e3562654e8fd775b2aa3da1800615ebae648271c78c4179d4e20eb90905f6c |
| 3 | 超額被拒 | 0x438c1cf8f9482e5c43bbb005cbc2a924d314b9a44f2fa10d63ff4dc6711ec5c0 |
| 4 | 駭客直接繞過 Session Key（幕三 Demo，NotAiSession 被拒） | 0xb877fb69d4eca42fb4e98fb575c8fb8f4b8bfb4dd1d76efc18fdb0b0334f45df |
| 5 | 正常付款成功（新合約 0x7404…033f，桶子式 rolling window，只用 Session Key） | 0x14ba2e05d4828fe8305ba1ef04c3dd40b67a1f23c3f177680770e4b3081a0525 |
| 6 | 駭客直接繞過 Session Key（新合約 0x7404…033f，NotAiSession 被拒） | 0xd85d780afa818d24af8233aa419e59e2b25c62b77b290da312ec29fd39887398 |
| 7 | 正常付款成功（合約 0x29d3…1f55，25 桶版，只用 Session Key） | 0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0 |
| 8 | Direct Bypass，收款人為 Hacker 0x8888…8888（NotAiSession 被拒） | 0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477 |
| 9 | 正常付款成功（合約 0x29d3…1f55，經 executeTransfer 包裝器的 ERC-4337 路徑） | 0x93e5059f2bd85cb67291f5f5f8eea154af679b2fcd46ef89d60e2d65151f69d4 |
| 10 | 正常付款成功（合約 0x29d3…1f55，經 executeTransfer 包裝器的 ERC-4337 路徑） | 0x50eed4028c975440296c8934d60099ec6a2eba8726fc09cb60e65c8220c51ed1 |

## 現行合約的四筆鏈上證據（整理，2026-09-04 彙整）

- 合約 TreasuryPolicyModule：`0x29d31dB1A9f694181a2793288aa6903a434E1F55`
- 鏈：Base Sepolia（chainId 84532）
- 瀏覽器：https://sepolia.basescan.org

| # | 情境 | 金額 | 區塊 | 外層交易狀態 | gasUsed | 執行方式 |
|---|---|---|---|---|---|---|
| 7 | 正常付款成功 | 見鏈上 `Transferred` 事件 | 46205662 | 1 success | 577794 | Session Key，ERC-4337 路徑 |
| 9 | 正常付款成功 | 1 USDC（raw `1000000`） | 46246783 | 1 success | 336933 | `executeTransfer()` 包裝器送出的 ERC-4337 路徑；鏈上實際為 EntryPoint → Smart Account → `aiTransfer` |
| 10 | 正常付款成功 | 1 USDC（raw `1000000`） | 46247030 | 1 success | 302769 | 同 #9 |
| 8 | Direct Bypass，收款人 Hacker `0x8888…8888`（`NotAiSession` 被拒） | 未成交，無資金移動 | 46205664 | **0 failed** | 25139 | 繞過前端與後端，直接以 session key 送出 |

BaseScan 連結：

- #7 https://sepolia.basescan.org/tx/0xa906df870e1cf32c1e16c923e4fb65b5a28174dd197d9a775148a0002c7dbab0
- #9 https://sepolia.basescan.org/tx/0x93e5059f2bd85cb67291f5f5f8eea154af679b2fcd46ef89d60e2d65151f69d4
- #10 https://sepolia.basescan.org/tx/0x50eed4028c975440296c8934d60099ec6a2eba8726fc09cb60e65c8220c51ed1
- #8 https://sepolia.basescan.org/tx/0x3c74bb4e432007b250392de205d00ebdd27642d1323aea13bcc63eb8e015c477

補充說明：

- #9、#10 於 2026-09-01 11:24 / 11:32 UTC 送出，收款人為 VEN-001 ABC Cloud `0x464DdfC8C223d05C8e7F8B5cC4dEf679A2e1BE27`；`invoice_id` 分別為 `INV-EVIDENCE-1788261849091` 與 `INV-EVIDENCE-1788262344366`，以時間戳確保不會觸發合約的重複付款保護。
- #8 的外層交易狀態即為 `0 (failed)`，gasUsed 僅 25139，與「直接呼叫合約、在第一道 `NotAiSession` 檢查即 revert」一致；**不是**外層成功、內層 UserOp 失敗的情形。
- 合約 USDC 餘額 **18.5 USDC**（raw `18500000`）為 **2026-09-01 查詢時間點的快照**，不是固定值，每次示範付款都會改變。
- 本節不含任何私鑰、API key 或 session approval 字串。


## PR #9 Review 修復備註（M2, 8/30）
- 目前合約位址 `0xA74b27069bc2391f0Dd489f09cA6C30217aD549b` 已修復 review 提出的
  P0-2（rolling 24h 限額）、P0-3（核准綁定完整付款內容）。
- 上面第 2、3 筆「白名單外被拒 / 超額被拒」交易是對舊版合約
  （aiSession 當時還是裸 EOA）取得的證據；新合約的 aiSession 是 Smart Account，
  這兩條規則的拒絕證據之後若要對新合約重新取得，需透過 executeTransfer()
  的 ERC-4337 路徑，但 ZeroDev bundler 會在送出前就攔截模擬失敗的操作，
  沒辦法產生「真的上鏈」的失敗紀錄——這點跟 Day 3 就已知的限制一致。
  規則本身在 Foundry 測試（18 個全過，含新增的 testApprovalBoundToRecipient /
  testApprovalBoundToAmount / testRollingWindowBlocksMidnightDoubleSpend）
  已經完整覆蓋驗證過。

## PR #9 第二輪 Review 修復備註（M2, 8/31）

合約已重新部署至 `0x7404162b0197Fd187467D4EA59b1Cb4AA761033F`。
舊合約 `0xA74b…549b` 的 19 USDC 留在舊地址（合約無提領函式），新合約已由
Circle 水龍頭重新入金 20 USDC，收款人白名單已重設。
**合約每次重新部署都必須重新產生 SESSION_KEY_APPROVAL**（授權字串綁定合約位址）。

### 1. Receipt 逾時不再遺失 hash
`executeTransfer` / `executeRawTransferWithSessionKey` 的等待回執動作已獨立包裝。
一旦拿到 `userOpHash` / `txHash`，之後任何等待失敗都會保留 hash 與 explorer_url，
並回報 `error_code = "RECEIPT_TIMEOUT"`，明確表示「已送出、結果未確認」。

✅ 8/31 更新：`packages/shared` 已加入 `PENDING`（M2, PR #13），本包已接上。
逾時一律回傳 `status: "PENDING"` 並保留 `user_op_hash`。
另加一次補救查詢：逾時後會再查一次 receipt，若其實已經上鏈就回報真正的結果
（EXECUTED / REJECTED，含 tx_hash 與 explorer_url），確定查不到才回 PENDING。
合約端的 `paidInvoice` 重複付款保護為第二道防線。

⚠️ 待團隊決定：UserOp 尚未上鏈時沒有對應的 basescan 交易頁面，該情況下
`explorer_url` 會缺省（只提供 `user_op_hash`）。若前端需要連結，要先決定採用哪個
UserOp 瀏覽器再補上。

### 2. Rolling window 改為固定成本（gas DoS 修復）
原本的 `TransferRecord[] transferHistory` + 線性回掃會隨交易筆數無上限變貴，
受攻陷的 Session Key 可用大量微額交易製造 gas DoS。
已改為每小時桶子累計：`bucketSpent[timestamp / 1 hours]`，計算時固定加總 24 個桶。

實測（`testSpamTransfersDoNotInflateGas`）：舊版做完 42 筆微額轉帳後，
最後一筆 gas 由約 169,727 漲到 319,546 並持續成長；新版通過同一測試。
該測試在舊實作上會失敗，已實際驗證過，不是空測試。

取捨：這是 sliding window counter 近似法，實際視窗長度介於 23～24 小時之間，
不是精準 24 小時；但成本有上界，且原本「跨午夜重置」的漏洞仍然被擋住。

### 3. CFO / AI runtime 環境隔離（fail-closed）
- 新增 `.env.ai-runtime`（已 gitignore），只含 AI runtime 需要的 8 個變數，
  刻意不含 `CFO_ROOT_PRIVATE_KEY` 與 `DEPLOYER_PRIVATE_KEY`。
- `packages/smart-account` 改為只載入 `.env.ai-runtime`，並在載入時檢查 process 環境；
  一旦偵測到上述兩個特權金鑰即拋錯拒絕啟動。已實測：乾淨環境正常、帶 CFO 金鑰則被擋。
- 另加 `assertExpectedAccount`：由 approval 重建出的帳戶地址若與 `SMART_ACCOUNT_ADDRESS`
  不一致（例如重新部署後忘記重產 approval），直接拒絕啟動。
- 新增 `packages/smart-account/AI_RUNTIME_ENV.md`（可進版控），內含 SESSION_KEY_APPROVAL 的完整設定說明。

### 4. 非機密自我宣告欄位
`index.ts` 匯出 `sessionKeyOnly = true` 與 `sessionPermissionId`
（由 approval 字串解出的 `permissionParams.permissionId`，目前為 `0x00c61a9a`）。
兩者皆不含機密，供 M2 的 API fail-closed 驗證與稽核。

### 5. 測試
- Foundry：20 項（新增 `testSpamTransfersDoNotInflateGas`、`testBucketWindowSlidesAfterWindowPasses`）。
- Vitest：29 項，全部不需網路或私鑰。涵蓋 receipt 成功／失敗／逾時、
  金額負數／0／小數／十六進位／uint256 溢位、Account 地址不一致、permissionId 解析。
- ⚠️ GitHub CI 接線未做：依 `09_Schedule.md` Day 3，`.github/workflows/` 屬 M5 任務範圍，
  未擅自更動，已請 M2 轉知 M5。

## 9/1 保命準備（11_Admin_And_PlanB.md 風險 4）

- **收款人白名單補齊四家**（對應 `data/vendors.json` 的 VEN-001～004），
  `readSessionPermission()` 現在回報 `authorized_recipient_count: 4`，
  與 `07b_Demo_Numbers.md` 的 Demo 數字一致。
- **Hacker 地址（幕三 Demo）**：`0x8888888888888888888888888888888888888888`。
  文件上的 `0xHACKER8888…` 不是合法的十六進位位址，故改用此位址；
  已確認不在白名單（`allowedRecipient` = false），且無人持有其私鑰。
- **備援 RPC**：主節點 `https://sepolia.base.org`，
  備援 `https://base-sepolia-rpc.publicnode.com`（可用 `RPC_URL_FALLBACK` 覆寫）。
  以 viem 的 `fallback` 傳輸層串接，主節點失效時自動切換。
  已實測：將主 RPC 改為無效位址後，`readSessionPermission()` 仍正常回傳。
- **Gas 餘額**：Deployer / CFO Root / AI Session 各約 0.0002 ETH。
  依實測 gas 價格（約 0.006 gwei），一次合約部署約 0.0000076 ETH，餘額充裕。
  Demo 前一天需再確認一次。

## PR #9 第三輪 Review 修復備註（M2, 8/31）

合約重新部署至 `0x29d31dB1A9f694181a2793288aa6903a434E1F55`，
四家白名單已重設、USDC 已重新入金、`SESSION_KEY_APPROVAL` 已重產
（新 `sessionPermissionId` = `0xdf8f4c53`）。

### 1. CI 的 SESSION_KEY_APPROVAL 問題（本機綠燈是假的）
先前 `sessionPermissionId` 在模組載入當下就解析 approval。本機有 `.env.ai-runtime`
所以看似正常，但乾淨的 CI 環境沒有該檔，解析直接拋錯 → 測試檔 import 失敗 →
**Vitest 實際執行 0 項**。已重現確認（`Tests no tests`）。

修正後的行為：
- approval 不存在 → `sessionPermissionId` 為 `undefined`，模組可正常 import
- approval 存在但格式錯誤 → 仍然拋錯，不會靜靜吞掉
- `buildKernelClient()`（真正動用資金的路徑）→ 缺 approval 時 fail-closed 拋錯

已實測：移除 `.env.ai-runtime` 後，30 項測試確實執行並通過。

### 2. BUCKET_COUNT 24 → 25
24 桶時，在某個桶的**最後一秒**把額度花滿，經過 23 小時又 1 秒時桶號恰好前進 24 格，
最舊那格被擠出視窗、額度提早釋放，實際視窗只有約 23 小時，不符合 Max per 24h。
改為 25 桶後，有效視窗為 24～25 小時，永遠不會短於承諾值。

新增 `testBucketTailNotReleasedBefore24h` 驗證此情境。該測試在 24 桶版本會
FAIL（`next call did not revert as expected`），已實際確認，不是空測試。

連帶調整：`testDailyLimitResetsNextDay` 的等待時間由 24h+1s 改為 25h+1s，
以符合新的視窗定義（只改該行，未改動其他既有程式碼）。

Foundry 測試 21 項全過。

### 3. 設定不完整不得偽裝成付款結果（第三輪追加發現）

修完 CI 問題後實測發現更深的問題：沒有 approval 時，`buildKernelClient()` 的
fail-closed 錯誤會被 `executeTransfer` 自己的 catch 接走、包裝成格式完整的
`REJECTED` 回傳，`apps/api` 因此回 **200**——等於把「環境沒設定好」記成
「這筆付款被鏈上拒絕」。這與本專案的誠實回報原則直接抵觸。

已修正：
- 新增 `chainRuntimeReady(): boolean`（非機密），供呼叫端在動用資金前判斷就緒狀態
- 內部 `assertChainRuntimeReady()` 於**輸入驗證之後、接觸鏈之前**檢查，
  設定不足一律向上拋，不再包成付款結果
- 順序很重要：地址格式／金額等輸入驗證仍在最前面，
  確保 CI 的離線測試完全不需要任何機密即可執行

實測（移除 `.env.ai-runtime` 模擬 CI）：
- `packages/smart-account` 30 項測試通過（有無 approval 皆然）
- `apps/api` 該情境由 200 改為 **502**（不再謊稱付款完成）

待 M2（`apps/api` 為其範圍，本包未修改）：
若要讓該情境回 503 `CHAIN_INTEGRATION_NOT_READY`，可在既有就緒判斷加上
`|| !smartAccount.chainRuntimeReady?.()`，即可在呼叫前 fail-closed。

