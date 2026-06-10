# 台股低基期選股機器人 v3.0

自動篩選台股科技/電子/半導體/電機類前 500 大交易量股票，透過三大篩選門找出低基期轉機股。

## 三大篩選門

| 門 | 名稱 | 條件 |
|---|---|---|
| 1 | 財務防護門 | EPS 連年正 + 負債比 < 50% + 有配息 |
| 2 | 低基期門（錯殺偵測） | 60 個交易日跌幅 > 30% |
| 3 | 轉機訊號門 | 站上 MA60 +（量能上升 或 營收成長） |

## 功能特色

- 動態抓取台股科技/電子/半導體/電機類股票，以交易量排序取前 500 支
- 殖利率合理性檢查（自動修正異常值）
- 月營收 YoY/MoM 分析（FinMind API）
- 歷史回測模組（站上 MA60 訊號勝率）
- LINE Notify 推播
- Excel 匯出
- 排程自動執行
- 深色主題 Web UI

## 快速開始

### 環境需求

- **Node.js** >= 18
- **Python** >= 3.9
- 作業系統：Windows / macOS / Linux 均可

### 安裝步驟

```bash
# 1. 進入專案目錄
cd tw-stock-screener

# 2. 安裝 Python 依賴
pip install -r requirements.txt

# 3. 啟動伺服器
npm start
# 或直接執行
node server.cjs
```

### 開啟瀏覽器

啟動後開啟 http://localhost:3000 即可使用 Web UI。

## 使用方式

1. **執行篩選**：點擊右上角「執行篩選」按鈕，等待完成
2. **查看結果**：表格顯示所有通過至少 1 門的股票
3. **詳細資訊**：點擊任一行查看該股票的完整篩選報告
4. **匯出 Excel**：點擊「匯出」按鈕下載 Excel 報表
5. **設定**：進入設定頁面調整篩選參數、LINE token、排程等

## CLI 模式

```bash
# 完整篩選（500支）
python3 python/screener.py

# 快速測試（15支）
python3 python/screener.py quick

# 回測（預設持有60天）
python3 python/screener.py backtest

# 回測（自訂持有天數）
python3 python/screener.py backtest 90

# 查看股票清單
python3 python/screener.py list

# LINE 測試
python3 python/screener.py line_test

# 匯出 Excel
python3 python/screener.py excel
```

## 部署到 GitHub

### 方法一：推送到 GitHub 並在本機/伺服器執行

```bash
# 1. 在 GitHub 建立新 repo（例如 tw-stock-screener）

# 2. 初始化 git 並推送
cd tw-stock-screener
git init
git add .
git commit -m "台股低基期選股機器人 v3.0"
git branch -M main
git remote add origin https://github.com/你的帳號/tw-stock-screener.git
git push -u origin main

# 3. 在任何電腦 clone 下來使用
git clone https://github.com/你的帳號/tw-stock-screener.git
cd tw-stock-screener
pip install -r requirements.txt
node server.cjs
```

### 方法二：部署到 Render / Railway（免費雲端）

1. 將程式碼推到 GitHub
2. 到 [Render](https://render.com) 或 [Railway](https://railway.app) 建立新專案
3. 連結 GitHub repo
4. 設定啟動指令：`node server.cjs`
5. 設定 Python buildpack（Render 需要 `requirements.txt`）

## 設定說明

設定檔位於 `data/config.json`，可透過 Web UI 的設定頁面修改：

| 參數 | 預設值 | 說明 |
|---|---|---|
| stock_pool_size | 500 | 篩選股票數量 |
| drop_60d_min | 30 | 60日跌幅門檻（%） |
| debt_ratio_max | 50 | 負債比上限（%） |
| require_dividend | true | 是否要求有配息 |
| require_eps_positive | true | 是否要求 EPS 正 |
| max_workers | 6 | 並行執行緒數 |
| line_token | "" | LINE Notify Token |
| finmind_token | "" | FinMind API Token（選填，可加速） |

## 專案結構

```
tw-stock-screener/
├── server.cjs              # Node.js 後端 API
├── package.json            # 專案設定
├── requirements.txt        # Python 依賴
├── public/
│   └── index.html          # Web UI（單頁應用）
├── python/
│   ├── screener.py         # 核心篩選引擎
│   ├── tw_hot_tech_zh.py   # 科技股基礎清單（fallback）
│   └── tw_stocks_zh.py     # 中文名稱對照表
├── data/
│   ├── config.json         # 設定檔
│   ├── screening_result.json  # 篩選結果
│   └── backtest_result.json   # 回測結果
└── logs/
    └── screener.log        # 執行日誌
```

## 注意事項

- 篩選 500 支股票約需 15~30 分鐘（視網路速度）
- yfinance 有 API 限制，建議 max_workers 設為 4~8
- FinMind 免費帳號有每日額度限制，建議申請 token
- 本工具僅供學習研究，非投資建議

## License

MIT
