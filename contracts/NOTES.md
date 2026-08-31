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
| TreasuryPolicyModule | 0x7404162b0197Fd187467D4EA59b1Cb4AA761033F |
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
