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
- [ ] 階段 3：重複付款偵測
- [ ] 階段 4：人工簽核狀態

## 部署紀錄（部署後填入，並在群組公告給 M2）

| 項目 | 位址 |
|---|---|
| TreasuryPolicyModule | 0xB77128aee907EDd21619e7F46D44BF0Bc669cB39 |
| Smart Account | 0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F |
| USDC (Base Sepolia) | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| CFO Root | 0x514De60834d21eC0E67af32F937FE0A83519a4F5 |
| AI Session | 0xf32b9eBC91C74b1a527B85d194Ee08ad0D4A1D29 |
| Hacker（Demo 用） | |

## 成功交易備份（保命用，9/2 前備妥 3 筆）

| # | 用途 | Tx Hash |
|---|---|---|
| 1 | 正常付款成功 | 0xa73f63f0cfe8ad614e8dd02275bd9fe59bbee50dc0eb9432a393623f378e797c |
| 2 | 白名單外被拒 | |
| 3 | 超額被拒 | |
