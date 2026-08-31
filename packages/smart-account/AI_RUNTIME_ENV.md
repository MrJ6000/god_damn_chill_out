# AI runtime 環境設定

把下面的內容複製成 repo 根目錄的 `.env.ai-runtime` 並填入實際值。
該檔已被 `.gitignore` 排除，不會進版控。

```bash
# ---------------------------------------------------------------
# AI runtime 專用環境檔範本
# 用法：複製成 .env.ai-runtime 並填入實際值。
#
# ⚠️ 本檔「刻意」不含 CFO_ROOT_PRIVATE_KEY 與 DEPLOYER_PRIVATE_KEY。
#    packages/smart-account 載入時會檢查，一旦在 process 環境中偵測到這兩個
#    變數就直接拋錯拒絕啟動（fail-closed）。
#    → 執行 AI runtime 時，請勿在同一個 shell 內 source 根目錄的 .env。
# ---------------------------------------------------------------

# 鏈與節點
RPC_URL=https://sepolia.base.org
# 選填：備援 RPC。未設定時預設 https://base-sepolia-rpc.publicnode.com
RPC_URL_FALLBACK=https://base-sepolia-rpc.publicnode.com
BUNDLER_RPC=<ZeroDev bundler RPC>
PAYMASTER_RPC=<ZeroDev paymaster RPC>

# 合約與代幣
TREASURY_POLICY_MODULE=0x...
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# AI Session Key（權限受限：只能呼叫 TreasuryPolicyModule.aiTransfer）
AI_SESSION_PRIVATE_KEY=0x...
SMART_ACCOUNT_ADDRESS=0x...

# --- SESSION_KEY_APPROVAL 設定說明 ---------------------------------
# 這是一段 base64 字串，由 CFO Root 事先簽發，內容記錄 AI Session Key 被允許
# 的操作範圍（CallPolicy：只能呼叫哪個合約的哪個函式）。
# 它「不是」私鑰，本身不含機密，可以安全放進 runtime 環境。
#
# 產生方式（只有 CFO Root 能做，需要根目錄 .env 裡的 CFO_ROOT_PRIVATE_KEY）：
#   pnpm --filter @pv/smart-account run generate-approval
# 指令會印出一行 SESSION_KEY_APPROVAL=...，整行貼到下面即可。
#
# ⚠️ 這段字串綁定了 TREASURY_POLICY_MODULE 的合約位址。合約一旦重新部署就
#    必須重新產生，否則 AI 會對著舊合約付款。模組啟動時會比對重建出的帳戶
#    地址與 SMART_ACCOUNT_ADDRESS，不一致會拒絕啟動。
#
# 模組另外匯出兩個非機密欄位供 API 端稽核：
#   sessionKeyOnly       固定 true，宣告本模組只使用 AI Session Key
#   sessionPermissionId  由本字串推導出的權限設定識別碼
SESSION_KEY_APPROVAL=

# 選填：白名單收款人候選清單（逗號分隔），用於統計目前生效的收款人數
# KNOWN_RECIPIENT_CANDIDATES=0x...,0x...
```
