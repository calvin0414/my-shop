# 小島果醬：課程範本商店

「不會寫程式，也能讓 AI 幫你開一間店」課程用的範本。用 Next.js 寫成，資料放在 Neon，部署在 Vercel，付款走綠界測試環境（不會真的扣款）。

## 這間店有什麼

| 頁面 | 網址 | 誰會用 |
|---|---|---|
| 首頁，所有商品 | `/` | 客人 |
| 商品頁 | `/products/strawberry` | 客人 |
| 購物車與結帳（可輸入優惠碼） | `/cart` | 客人 |
| 訂單查詢 | `/orders/1001` | 下單的那位客人 |
| 店家後台：訂單、營收、出貨 | `/admin` | 店家 |
| 店家後台：優惠碼（新增、停用、看使用次數） | `/admin/coupons` | 店家 |
| 優惠碼預覽折扣 API | `/api/coupons/preview` | 購物車畫面 |
| 商品資料 API | `/api/products`、`/api/products/1` | 前端、其他程式 |
| 綠界付款通知 | `/api/ecpay/notify` | 綠界的伺服器 |

## 在自己的電腦上跑起來

需要先裝好 Node.js（LTS 版）和 Git。

**第一步：安裝套件**

```
npm install
```

**第二步：建立環境變數檔**

把 `.env.example` 複製一份，改名為 `.env.local`，打開後填兩格：

| 名稱 | 填什麼 |
|---|---|
| `DATABASE_URL` | Neon 專案按 Connect 複製的整串連線字串（有密碼，是秘密） |
| `ADMIN_PASSWORD` | 自己取一個後台密碼 |

綠界的三格（`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`）已經填好綠界公開的測試值，不用改。`ECPAY_MODE` 填 `stage`，代表綠界測試環境。

| `ECPAY_MODE` 的值 | 代表什麼 |
|---|---|
| `stage` | 測試環境：付款送到綠界的測試網址，不會真的扣款 |
| `production` | 正式收款：付款送到綠界的正式網址，會真的扣款 |
| 沒填，或填了其他字 | 一律當成 `stage` |

> **⚠ 換成正式收款金鑰時，一定要把 `ECPAY_MODE` 改成 `production`。**
> 只換掉三把金鑰、沒改這一格，網站會繼續把客人送到綠界的**測試**網址，用正式金鑰在那裡付款會失敗，客人沒辦法結帳。
> 而且在測試模式下，網站會接受綠界的「模擬付款」通知，正式開店時不能留著這個漏洞。
> 只有完整、全小寫的 `production` 才算數。`Production`、`prod`，或前後多了空格，都會被當成測試環境，而且畫面上不會有任何提示。
> Vercel 的 Environment Variables 裡也要一起改，改完按 Redeploy。

**第三步：建立資料表、放進範例商品**

```
npm run db:setup
```

看到兩個 ✔ 就成功了。重複執行也沒關係，不會重複放商品。

**第四步：啟動網站**

```
npm run dev
```

打開 http://localhost:3000 就看得到果醬店。

## 部署到 Vercel

1. 在 Vercel 按 Add New → Project，選這個 GitHub 倉庫，按 Import
2. 展開 Environment Variables，填入下面六個名稱（值和 `.env.local` 一樣）
3. 按 Deploy

| 名稱 | 值 |
|---|---|
| `DATABASE_URL` | 和 `.env.local` 同一串 |
| `ECPAY_MERCHANT_ID` | `3002607` |
| `ECPAY_HASH_KEY` | `pwFHCqoQZGmho4w6` |
| `ECPAY_HASH_IV` | `EkRm7iFT261dpevs` |
| `ECPAY_MODE` | `stage`（正式收款時改成 `production`） |
| `ADMIN_PASSWORD` | 和 `.env.local` 同一個 |

小技巧：把 `.env.local` 的全部內容複製起來，貼進 Vercel 第一個 Key 欄位，它會自動拆成好幾格。

部署後如果首頁說「還沒連上資料庫」，到 Settings → Environment Variables 檢查名稱和值，改完按 Redeploy。

## 測試付款

結帳後會跳到綠界的測試付款頁，用這張測試卡：

- 卡號：4311-9522-2222-2222
- 安全碼：222
- 有效年月：未來的任一個月

**付款結果只有在 Vercel 上線的網址才會自動更新**。綠界付完款，會從它的伺服器通知 `/api/ecpay/notify`，但它連不到你電腦上的 localhost。

在自己電腦上想測試「付款成功之後」的流程，可以用模擬通知（網站要開著）：

```
npm run simulate:paid -- 1001
npm run simulate:paid -- 1001 --twice
```

`1001` 換成你的訂單編號。加上 `--twice` 會把同一筆通知送兩次，可以到後台確認營收沒有被算兩次。

## 資料表

| 資料表 | 存什麼 |
|---|---|
| `products` | 商品：名稱、價格、庫存 |
| `customers` | 客人：同一個 Email 只存一筆 |
| `orders` | 訂單：訂單狀態 `status` 和付款狀態 `payment_status` 是兩個欄位；用了優惠碼時記下 `coupon_code` 和 `discount`（總額＝小計 − 折扣＋運費） |
| `order_items` | 訂單明細：記下成交當下的單價 |
| `payments` | 付款通知帳本：同一個綠界交易編號只處理一次 |
| `coupons` | 優惠碼：固定金額或百分比、最低消費、期間、總次數與每個 Email 次數上限。只能停用，不能刪除 |

優惠碼的「使用次數」不另外記，就是「用了這個碼、而且已付款的訂單數」。設計細節見 `docs/coupon/`。

### 資料表有更新時（例如加上優惠碼）

`npm run db:setup` 只會新增缺少的資料表和欄位，不會動到既有資料，重複執行也沒關係。已經上線的店要照這個順序：

1. 先對**線上**的 Neon 執行 `npm run db:setup`
2. 再把程式推上 GitHub，讓 Vercel 部署

順序反過來的話，新程式會找不到新欄位，結帳會失敗。

訂單狀態只能沿著這條路走：

```
pending 待付款 → confirmed 已確認 → shipped 已出貨 → completed 已完成
pending 待付款 → cancelled 已取消（只有未付款的訂單可以取消）
```

`pending → confirmed` 只會由綠界的付款通知觸發。已取消的訂單如果收到付款，不會自動恢復，會出現在後台的「需要人工處理」。

## 檔案在哪裡

| 想改什麼 | 檔案 |
|---|---|
| 店名、標語、運費 | `lib/shop.ts` |
| 顏色、字體、版面 | `app/globals.css` |
| 首頁 | `app/page.tsx` |
| 商品頁 | `app/products/[slug]/page.tsx` |
| 購物車與結帳畫面 | `components/CartView.tsx` |
| 建立訂單（後端算錢） | `app/api/orders/route.ts` |
| 綠界付款通知 | `app/api/ecpay/notify/route.ts` |
| 後台 | `app/admin/` |
| 資料表結構與範例商品 | `scripts/schema.sql`、`scripts/db-setup.mjs` |
| 優惠碼的算錢規則 | `lib/coupon-math.ts`（自動檢查：`npm run test:coupon`） |
| 優惠碼能不能用、使用次數 | `lib/coupons.ts` |
| 購物車預覽優惠碼 | `app/api/coupons/preview/route.ts` |
| 後台優惠碼管理 | `app/admin/coupons/page.tsx`、`app/admin/actions.ts` |

## 已知限制

這一版優惠碼**先不做**下面這些事：

- 免運券、只限指定商品使用的碼
- 一人一碼的專屬碼、一次大量產生很多組碼
- 編輯或刪除優惠碼；已停用的碼不能重新啟用（停用前後台會再確認一次）
- 匯出優惠碼的使用紀錄
- 防止有人一直猜碼（限制嘗試次數）
- 退款時把使用次數還回去：店裡目前沒有退款流程，退款訂單仍是「已付款」，會算用掉一次
- 會員系統，或用 Email 以外的方式辨認客人
- 下單時的「庫存超賣」：這個問題在加優惠碼之前就存在，這次沒有處理

另外要知道的行為：

- **次數上限可能被小幅超過。** 次數是在「付款成功」時才計算。如果好幾位客人幾乎同時用同一組碼下單，付款後可能超過上限。這時訂單不會被擋下，後台會出現在「需要人工處理」，由店家決定要補收差額還是接受。
- **每個 Email 的次數限制**只認 Email，換一個 Email 就能再用一次。

## 給 Claude Code 的規則

請 Claude Code 工作前先讀 `CLAUDE.md`。裡面寫了這間店不准破壞的幾條規則。

綠界有官方釋出給 AI 開發工具用的 Skill（[ecpay/ecpay-api-skill](https://github.com/ecpay/ecpay-api-skill)），要加新的付款方式、電子發票或物流時，可以請 Claude Code 先裝上它再動手。
