# 易搜數碼 Easoug — Digital MVP

易搜數碼的社區好物流轉平台：**手機 PWA（瀏覽＋預約）＋ 後台管理**。
零依賴（不需要 `npm install`）的 Node.js 伺服器 + JSON 檔案資料庫，一鍵啟動即可試用。

> 依《easoug-digital-mvp-plan.md》與 `api/freebuff-prompt.json` 生成（MVP v0.1）。

---

## 快速開始

需要 Node.js 18+。**不需要安裝任何套件**：

```bash
npm start          # 或 node server/index.js
```

| 位置 | 網址 |
|------|------|
| 公眾網站（PWA） | http://localhost:8787 |
| 後台管理 | http://localhost:8787/admin/ |
| 後台預設密碼 | `easoug1234` |

> ⚠️ **正式試點前請改密碼**：以環境變數啟動，例如
> `ADMIN_PASSWORD='你的密碼' npm start`

### 常用指令

```bash
npm test           # 執行 API 端到端測試（node:test，無需安裝）
npm run icons      # 重新產生 PWA 圖示
npm run dev        # 檔案變動自動重啟（--watch）
PORT=9000 npm start                 # 換埠
DB_PATH=/tmp/db.json npm start      # 指定資料檔位置
```

**重設示範資料**：刪除 `db.json` 後重啟，會重新載入種子物品與預約。

---

## 功能對照（與 spec 一致）

| 頁面 | 內容 |
|------|------|
| `/` 首頁 | 物品卡片（圖片＋標題＋狀態），可取／保留中／全部篩選、關鍵字搜尋、**15 秒自動輪詢即時同步** |
| `/item.html?id=` 物品詳細 | 圖片、描述、類別／價格、即時狀態、預約表單（姓名＋電話＋取件時間） |
| `/reserve.html?id=` 預約成功 | 預約編號、姓名、電話、取件時間、24 小時保留提醒 |
| `/my-reservations.html` 我的預約 | 憑電話查詢預約清單、狀態、自行取消 |
| `/support.html` 支援易搜 | 捐款金額選項（50/100/200/500/自訂），前往店主設定的收款連結 |
| `/admin/` 後台登入 | 密碼驗證、Bearer token（記憶體、12 小時有效、失敗 10 次鎖 5 分鐘） |
| `/admin/items.html` 物品管理 | 新增／編輯／刪除、照片上傳（自動壓縮）、**批量上架（CSV，附範本下載）**、一鍵狀態切換（含備註）、狀態篩選、**匯出 CSV** |
| `/admin/reservations.html` 預約管理 | 清單＋狀態標籤、核銷「完成取件」、取消、按狀態篩選／搜尋、**匯出 CSV** |
| `/admin/reports.html` 數據報表 | 流通數、提取率、籌款金額、近 6 個月趨勢圖、活動紀錄、**匯出資料（物品／預約 CSV ＋ 完整備份 JSON）**、**店鋪設定**（含收款連結、Instagram／Facebook） |

### PWA

- 可安裝（`manifest.webmanifest` + 192/512 圖示）
- Service worker：離線仍可開啟網站、瀏覽最後一次抓取的物品清單、快取圖片
- 同瀏覽器跨分頁：後台改動會即時通知前台頁面（BroadcastChannel）＋ 全站輪詢

### 營運規則（已內建）

| 規則 | 實作 |
|------|------|
| 預約後物品標記「保留中」 | 建立預約時自動改 `reserved`，並鎖定持有者 |
| 24 小時逾期自動釋放 | 每分鐘掃描 ＋ 每次讀取前掃描：`expired` 並還原為 `available` |
| 每月每電話最多預約 N 件 | 預設 2（後台「店鋪設定」可改 1–20），超額回 429 |
| 重複預約／已保留／已取走 | 409 並回覆清楚訊息 |
| 取消或釋放即時同步 | 狀態變更 → 活動紀錄 ＋ 公眾頁輪詢即時反映 |
| 只收集姓名＋電話 | 電話只儲存在伺服器資料檔；網站無追蹤分析（私隱最小化） |
| 社交平台連結 | 預設 Instagram https://www.instagram.com/goodschance/ 與 Facebook https://www.facebook.com/GoodsChance，顯示於各頁頁尾與「支援易搜」頁；店主可於「數據報表 → 店鋪設定」修改 |

---

## API（全部 JSON）

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| GET | `/api/items?status=&type=&q=` | 物品列表（可取優先排序） | 公開 |
| GET | `/api/items/:id` | 單一物品 | 公開 |
| PATCH | `/api/items/:id/status` | 改狀態（需管理 token；保留中自動核銷／釋放） | 管理 |
| POST | `/api/reservations` | 預約（`item_id, customer_name, phone, pickup_time`） | 公開 |
| GET | `/api/reservations?phone=` | 憑電話查自己的預約 | 公開 |
| GET | `/api/reservations/:id?phone=` | 單筆預約（需自己的電話） | 公開 |
| POST | `/api/reservations/:id/cancel` | 取消（需自己的電話） | 公開 |
| GET | `/api/settings` | 店鋪公開資料（含收款連結） | 公開 |
| POST | `/api/admin/login` · `/logout` · GET `/auth` | 登入管理 | — |
| GET/POST | `/api/admin/items` · PATCH/DELETE `/api/admin/items/:id` | 物品 CRUD | 管理 |
| POST | `/api/admin/items/bulk` | 批量上架（`{ items: [...] }`，逐行驗證、回報錯誤行） | 管理 |
| GET | `/api/admin/export/items.csv` · `/api/admin/export/reservations.csv` · `/api/admin/export/backup.json` | 匯出（UTF-8 BOM CSV 可直接用 Excel 開啟；backup 為完整 JSON 備份） | 管理 |
| PATCH | `/api/admin/items/:id/status` | 狀態切換＋備註 | 管理 |
| GET | `/api/admin/reservations` | 全部預約 | 管理 |
| PATCH | `/api/admin/reservations/:id` | `status: completed \| cancelled` | 管理 |
| GET | `/api/admin/actions` | 最近活動紀錄 | 管理 |
| GET/PATCH | `/api/admin/settings` | 店鋪設定（配額、收款連結等） | 管理 |
| GET | `/api/reports/summary` | 數據報表 | 管理 |

### 資料模型

- **item**：`id, name, description, image_url, status[available|reserved|taken|sold], type[free|donation|special], price|null, created_at, updated_at`（另加內部 `reservation_id` 追蹤持有者）
- **reservation**：`id, item_id, customer_name, phone, pickup_time, status[pending|confirmed|completed|cancelled|expired], created_at, updated_at`
- **item_action**（活動紀錄）：`id, item_id, admin_id, action[reserve|release|take|sell|create|update], notes, created_at`

---

## 目錄結構

```
├── index.html / item.html / reserve.html / my-reservations.html / support.html   公眾頁面
├── admin/                 後台頁面（index/items/reservations/reports + js）
├── css/ js/               共用樣式與前端邏輯
├── images/seed/           種子物品插圖（可重新產生）
├── images/icons/          PWA 圖示（scripts/gen-icons.js 產生）
├── server/                後端：index.js(HTTP+靜態) api.js(路由) store.js(JSON DB+種子) auth.js util.js
├── test/api.test.js       API 端到端測試
├── db.json                資料檔（首次啟動自動建立，含示範資料）
└── scripts/               圖示／插圖產生器
```

---

## 部署

MVP 是「靜態網站 ＋ API」單一 Node 程序，最簡單的部署方式：

- **Render / Railway / Fly.io（推薦）**：Start command `node server/index.js`，`PORT` 由平台注入；
  若平台提供持久化磁碟，把 `DB_PATH` 指到磁碟目錄（如 `/data/db.json`）以免重啟後資料重置。
- **自家 VPS / NAS**：`node server/index.js` + pm2/systemd 即可。
- **Vercel / Netlify**：此版本使用長駐 Node 程序而非 Serverless Functions；如需放上 Vercel，
  需將 `/api/*` 移植為 Vercel Functions（或改用 Supabase 版後端），前端檔案可直接靜態託管。

---

## 已知限制（MVP 範圍）

- 管理認證為單一密碼 + 記憶體 token；多人後台請加上真正的帳號系統。
- 照片上傳會壓縮為 data URL 存進 `db.json`，大量圖片會令檔案變大（MVP 夠用，長期建議 S3/物件儲存）。
- 預約資料以明文存於 `db.json`，僅收集姓名與電話；如需刪除資料，直接編輯或刪除檔案即可。
- 收款連結由店主在「數據報表 → 店鋪設定」填入；捐款狀態由店主於報表／實體流程自行核對。
