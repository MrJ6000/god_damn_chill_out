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
| TreasuryPolicyModule | 0xff3Aaf05e83c6d5877b4703a201Ec1442cEE9AaA |
| Smart Account | 0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F |
| USDC (Base Sepolia) | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| CFO Root | 0x514De60834d21eC0E67af32F937FE0A83519a4F5 |
| AI Session (Scoped, via Smart Account) | 0xeb6d274dAA1c821ae4A16Fac71C74B960750Ca2F |
| Hacker（Demo 用） | |

## 成功交易備份（保命用，9/2 前備妥 3 筆）

| # | 用途 | Tx Hash |
|---|---|---|
| 1 | 正常付款成功 | 0xe1144e42afb1d8f41780a0ed4010ad2aa94e7083a183354ead4c6dd88955b112 |
| 2 | 白名單外被拒 | 0xb2e3562654e8fd775b2aa3da1800615ebae648271c78c4179d4e20eb90905f6c |
| 3 | 超額被拒 | 0x438c1cf8f9482e5c43bbb005cbc2a924d314b9a44f2fa10d63ff4dc6711ec5c0 |
| 4 | 駭客直接繞過 Session Key（幕三 Demo，NotAiSession 被拒） | 0xb0f35ee2d6688344269399ac0603a1e59d1ddf6ab97c0c93661281eecd168345 |
