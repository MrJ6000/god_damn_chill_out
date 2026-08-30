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
| TreasuryPolicyModule | 0xA74b27069bc2391f0Dd489f09cA6C30217aD549b |
| Smart Account | 0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F |
| USDC (Base Sepolia) | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| CFO Root | 0x514De60834d21eC0E67af32F937FE0A83519a4F5 |
| AI Session (Scoped, via Smart Account) | 0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F |
| Hacker（Demo 用） | |

## 成功交易備份（保命用，9/2 前備妥 3 筆）

| # | 用途 | Tx Hash |
|---|---|---|
| 1 | 正常付款成功（P0-4 修復後，只用 Session Key，無 CFO 私鑰） | 0xf47afb6c1d067510947daa7029750da9ab3029980dcaca0eb1fe3b1414c74720 |
| 2 | 白名單外被拒 | 0xb2e3562654e8fd775b2aa3da1800615ebae648271c78c4179d4e20eb90905f6c |
| 3 | 超額被拒 | 0x438c1cf8f9482e5c43bbb005cbc2a924d314b9a44f2fa10d63ff4dc6711ec5c0 |
| 4 | 駭客直接繞過 Session Key（幕三 Demo，NotAiSession 被拒） | 0xb877fb69d4eca42fb4e98fb575c8fb8f4b8bfb4dd1d76efc18fdb0b0334f45df |

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
