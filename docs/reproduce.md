# 安裝、執行與重現

此頁的預設路徑是**本機模擬 Agent＋模擬鏈上執行**，不需要 OpenAI key、錢包或資金。安裝相依套件時需要網路；`--offline` 指 benchmark 不呼叫模型或區塊鏈，並非不需安裝套件。

## 環境與下載

- Git、Node.js 22 LTS（與 CI 相同 major）。本次 Windows 另以 Node.js 24.13.1 驗證。
- pnpm 固定為 `9.12.0`，由根目錄 `packageManager` 管理。下方使用 `corepack pnpm`，避免 Windows 的 `pnpm.ps1` 執行政策問題。
- 如 Node 環境沒有 Corepack，可先執行 `npm install --global corepack`；Windows 可用 `npm.cmd`。
- 瀏覽器與可用的 3000／3001 連接埠。若倉庫為私人，需先取得存取權。

```sh
git clone --recurse-submodules https://github.com/MrJ6000/god_damn_chill_out.git
cd god_damn_chill_out
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm bench --offline
```

pnpm 應顯示 `9.12.0`。benchmark 預期列出 100 筆案例，各類別 `passed = total`，以及 `Must-not-execute cases allowed by policy: 0`、`Legitimate allowed: 20`。耗時因硬體而不同。此命令會重寫 `benchmark/benchmark-results.json`；交件原始輸出另存於 [evidence](evidence/offline-benchmark-2026-09-05.json)。

## 啟動展示

請在新的 clone 根目錄操作。下列變數只影響目前終端機，不需要建立 `.env`。模擬 session 設為七天後到期，避免範例預設的 2026-09-07 到期日讓後續評審無法重現。

### Windows PowerShell

```powershell
$env:OPENAI_API_KEY = ''
$env:MOCK_AGENT = '1'
$env:MOCK_CHAIN = '1'
$env:ENABLE_DIRECT_BYPASS = '0'
$env:API_PORT = '3001'
$env:API_HOST = '127.0.0.1'
$env:WEB_ORIGIN = 'http://localhost:3000'
$env:NEXT_PUBLIC_API_BASE = 'http://localhost:3001'
$env:SESSION_EXPIRES_AT = [DateTime]::UtcNow.AddDays(7).ToString('o')
corepack pnpm dev
```

### macOS／Linux（Bash）

```bash
export OPENAI_API_KEY=''
export MOCK_AGENT=1
export MOCK_CHAIN=1
export ENABLE_DIRECT_BYPASS=0
export API_PORT=3001
export API_HOST=127.0.0.1
export WEB_ORIGIN=http://localhost:3000
export NEXT_PUBLIC_API_BASE=http://localhost:3001
export SESSION_EXPIRES_AT="$(node -e 'process.stdout.write(new Date(Date.now()+7*24*60*60*1000).toISOString())')"
corepack pnpm dev
```

開啟 [Web](http://localhost:3000) 與 [API health](http://localhost:3001/api/health)。Health 預期含 `ok: true`、`data.status: "ok"`；它只證明 API 存活，不能證明模型或鏈上 runtime 可執行。

按 `Ctrl+C` 停止。若同時啟動不便，可在同一組環境變數下分別用 `corepack pnpm dev:api`、`corepack pnpm dev:web` 啟動兩個終端機。

### 三個情境的驗收

| 操作 | 預期可見結果 |
| --- | --- |
| 首頁「產生付款計畫」 | 18 筆提案；乾淨資料為 16 ALLOW／1 REVIEW／1 DENY |
| 「① 正常付款」 | 只執行 `INV-8801`；收據為 `API MOCK MODE`、`MOCK_CHAIN`，金額 1,250 USDC，未上鏈 |
| 「② AI 遭入侵」 | `INV-8821`；提議地址與可信地址不同；`BENEFICIARY_MISMATCH`；付款未送出 |
| 「③ 直接攻擊」 | `NOT SUBMITTED`、`API MOCK MODE`、`MOCK_CHAIN`；沒有真實交易 hash |

`MOCK_CHAIN=1` 讓第三個情境直接回傳 `SKIPPED`，不需要開啟真實繞過測試。`ENABLE_DIRECT_BYPASS` 只管制真實鏈上直接呼叫路徑，因此本機步驟設為 `0`。`API 回應` 只代表資料來自後端，不代表 live AI 或鏈上執行。

正常模擬付款會保存到這份 clone 的 `data/payments.json`，重複按正常付款可能出現 `DUPLICATE_PAYMENT` 或按鈕停用。**「重設畫面」不會清除後端付款紀錄。** 要重新從零演練，停止展示後另建新的 demo clone；不要刪除真實付款環境的歷史紀錄。

### 3000／3001 已被其他專案使用

保留既有服務，在兩個終端機改用其他埠。API 終端機保留上方模擬變數，另設定：

```powershell
$env:API_PORT = '3311'
$env:WEB_ORIGIN = 'http://localhost:3310'
corepack pnpm --filter @pv/api exec tsx src/index.ts
```

Web 終端機：

```powershell
$env:NEXT_PUBLIC_API_BASE = 'http://localhost:3311'
corepack pnpm --filter @pv/web exec next dev -p 3310
```

開啟 [localhost:3310](http://localhost:3310)。本次截圖即使用此埠號組合；macOS/Linux 使用相同指令，將變數語法換成 `export`。

## 執行檢查

### 建置與 Vitest

在乾淨 clone 中執行。Smart Account 的單元測試需要 CI 同款**非機密測試 fixture**；它不是真實 session 授權，不能拿來轉帳。

PowerShell：

```powershell
$env:OPENAI_API_KEY = ''
$env:CFO_ROOT_PRIVATE_KEY = ''
$env:DEPLOYER_PRIVATE_KEY = ''
$env:SESSION_KEY_APPROVAL = 'eyJwZXJtaXNzaW9uUGFyYW1zIjp7InBlcm1pc3Npb25JZCI6IjB4MDAifX0='
corepack pnpm -r build
corepack pnpm -r test
```

Bash：

```bash
export OPENAI_API_KEY=''
export CFO_ROOT_PRIVATE_KEY=''
export DEPLOYER_PRIVATE_KEY=''
export SESSION_KEY_APPROVAL='eyJwZXJtaXNzaW9uUGFyYW1zIjp7InBlcm1pc3Npb25JZCI6IjB4MDAifX0='
corepack pnpm -r build
corepack pnpm -r test
```

提交基準 `5820eb7` 的預期為 195 項測試通過。Shared 沒有測試；Blast Radius 目前沒有獨立測試檔，命令會明示跳過，不計入 195。

### 保留可追溯的 benchmark

PowerShell：

```powershell
$env:GITHUB_SHA = git rev-parse HEAD
corepack pnpm bench --offline
```

Bash：

```bash
GITHUB_SHA="$(git rev-parse HEAD)" corepack pnpm bench --offline
```

原始輸出位於 `benchmark/benchmark-results.json`。runner 保存 commit 的前七碼；CI 會自動提供 `GITHUB_SHA` 並上傳 [benchmark-results artifact](https://github.com/MrJ6000/god_damn_chill_out/actions)。

### Solidity／Foundry

需要另行安裝 [Foundry](https://getfoundry.sh/)。已遞迴 clone 的情況可直接執行；若先前沒有下載 submodule：

```sh
git submodule update --init --recursive
cd contracts
forge test -vv
```

本次本機沒有執行 Foundry；[已完成的 main CI](https://github.com/MrJ6000/god_damn_chill_out/actions/runs/33842721710) 另有 contracts job，應與最終提交版本的 CI 分開核對。

## 真實模型與鏈上執行

| 模式 | 設定／前提 | 能證明什麼 |
| --- | --- | --- |
| 本機模擬 | 本頁預設兩個 `MOCK_* = 1` | 流程、政策結果、收據呈現 |
| 真實 AI＋模擬鏈 | `MOCK_AGENT=0`、有效 `OPENAI_API_KEY`；`MOCK_CHAIN=1` | 當次模型提出的意圖及政策結果；未上鏈 |
| 真實鏈上 runtime | `MOCK_CHAIN=0`，依 [隔離環境](../packages/smart-account/AI_RUNTIME_ENV.md) 完成 session 與鏈設定 | 只有最終 receipt 與 token logs 才證明付款結果 |
| 歷史交易 | [驗證紀錄](verification.md) 中既有 hash | 指定時間、指定合約與路徑的既有結果 |

真實模式需獨立設定 RPC、bundler、session signer、合約與授權；不得把含 CFO root／deployer 私鑰的整份環境載入 AI runtime。缺條件可能回 `AGENT_INTEGRATION_NOT_READY` 或 `CHAIN_INTEGRATION_NOT_READY`。本文件不替評審自動執行任何真實付款。

## 常見問題

| 現象 | 處理 |
| --- | --- |
| 沒有 OpenAI key，提案失敗 | 確認 API 啟動的同一終端機有 `MOCK_AGENT=1` |
| 畫面顯示前端備援 | 查看 API health、`NEXT_PUBLIC_API_BASE` 與 `WEB_ORIGIN`，重啟 Web 讓變數生效 |
| `SESSION_EXPIRED` | 僅本機模擬可更新上方到期時間；真實鏈上到期由授權／合約狀態管理 |
| 正常付款不能再按 | 已有付款紀錄觸發防重複；用新的 demo clone 演練 |
| 測試在 Smart Account 匯入時失敗 | 使用乾淨 clone 及上方 CI fixture；不要混入真實 `.env.ai-runtime` |
| CI 綠燈，live demo 卻失敗 | CI 的測試與離線 benchmark 不等於即時模型、bundler 或資金可用 |
