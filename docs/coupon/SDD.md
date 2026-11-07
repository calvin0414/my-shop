# 優惠碼功能 SDD（技術設計）

- 狀態：已確認（2026-11-07），可以開始實作；Q7 待查證
- 日期：2026-11-07
- 對應需求：[PRD.md](PRD.md)（下文用 F1-1 這類編號指 PRD 的驗收條件，用 D1 這類編號指 PRD 的決策）

## 1. 技術選擇

| 項目 | 選擇 | 理由 |
|---|---|---|
| 框架 | 沿用 Next.js（App Router）＋ TypeScript | 現有架構，不換 |
| 資料庫 | 沿用 Neon（PostgreSQL），透過現有的 `pg` 和 `lib/db.ts` 的 `db()` 連線 | 現有架構 |
| 後台權限 | 沿用 `lib/admin-auth.ts` 的 `isAdmin()` | CLAUDE.md 規則 7 |
| 運費規則 | 沿用 `lib/shop.ts` 的 `shippingFor()` | 運費規則只寫在一個地方 |
| 新套件 | **不安裝任何套件** | 依需求要求 |
| 自動檢查 | Node 內建的 `node --test`，不需要安裝套件（Q5 已確認採用） | 用來驗證算錢的規則 |
| 資料庫升級 | 把 SQL 加在 `scripts/schema.sql` 的最後面，沿用 `npm run db:setup` 執行 | 現在建立資料表就是用這個指令，不另外發明新流程 |

## 2. 新增與修改的檔案

### 新增

| 檔案 | 負責什麼 |
|---|---|
| `lib/coupon-math.ts` | **只放算錢的規則，不碰資料庫、不 import 任何東西**：整理碼的格式（`normalizeCode`）、算折扣（`computeDiscount`）、算出折扣／運費／總額（`priceWithCoupon`，運費規則以參數傳入）。購物車預覽、建立訂單、自動檢查三個地方共用同一份規則。 |
| `lib/coupons.ts` | 後端專用。查優惠碼、判斷能不能用（`checkCoupon`）、計算使用次數、在後台顯示的狀態文字。只會被後端程式 import。 |
| `app/api/coupons/preview/route.ts` | `POST /api/coupons/preview`：購物車按「套用」時呼叫。從資料庫重算小計，回答「能不能用、折多少」。**不計次、不保留名額。** |
| `app/admin/coupons/page.tsx` | 後台「優惠碼」頁：新增表單＋列表＋停用按鈕。沒登入就導回 `/admin`。 |
| `components/ConfirmSubmit.tsx` | 實作時補上：送出前跳出確認視窗的按鈕，用在「停用（無法恢復）」（F6-7）。伺服器端頁面沒辦法自己跳確認視窗，所以需要這個小元件。 |
| `scripts/coupon-math.test.mjs` | 算錢規則的自動檢查（是否採用見 Q5）。 |

### 修改

| 檔案 | 改什麼 |
|---|---|
| `scripts/schema.sql` | 最後面加上第 3 節的 SQL。原本的內容一行都不動。 |
| `scripts/db-setup.mjs` | 只改成功訊息，把 `coupons` 加進去。 |
| `app/api/orders/route.ts` | 收下 `couponCode`；鎖住商品、算出小計之後，呼叫 `checkCoupon`；用 `priceWithCoupon` 算錢；訂單多寫三個欄位；付款品名多一段折抵說明。 |
| `app/api/ecpay/notify/route.ts` | 付款成功的一般路徑裡，如果訂單有用優惠碼，就檢查有沒有超用，超用時寫入 `review_note`。 |
| `components/CartView.tsx` | 優惠碼輸入框、套用、移除；顯示預估折扣；結帳時一起送出 `couponCode`；優惠碼錯誤時不清空購物車。 |
| `app/orders/[id]/page.tsx` | 多讀 `coupon_code` 和 `discount`，有折扣時多顯示一行。 |
| `app/admin/page.tsx` | 營收扣掉折扣、多一格「折扣總額」、訂單金額欄顯示用了哪個碼、上方加上「優惠碼」頁的連結。 |
| `app/admin/actions.ts` | 新增 `createCoupon`、`deactivateCoupon`，第一行都先檢查 `isAdmin()`。 |
| `package.json` | 新增 `"test:coupon": "node --test scripts/coupon-math.test.mjs"`（是否採用見 Q5）。 |

### 不改

- `lib/shop.ts`、`lib/ecpay.ts`、`lib/orders.ts`、`lib/admin-auth.ts`、`lib/products.ts`、`app/api/products/*`、`scripts/simulate-notify.mjs`
  - `simulate-notify.mjs` 直接讀訂單的 `total`。訂單有折扣時，這個數字已經是折扣後的總額，所以模擬付款不用改。
- `app/globals.css`：先沿用現有的樣式（`field`、`btn`、`sum`、`notice`、`badge`、`table`）。真的不夠用時，會先提出來再改。
- （`CLAUDE.md`、`README.md` 依 Q4 決定，實作時一起更新。）

## 3. 資料表怎麼改

原則：**只新增，不刪除，也不修改既有的欄位和資料。** 下面的 SQL 會加在 `scripts/schema.sql` 的最後面。全部都是「不存在才建立」，所以重複執行也安全（F8-1、F8-2）。

```sql
-- ===== 優惠碼（2026-11 新增）=====

-- 優惠碼：一組碼一筆。不提供刪除，停用改 active。
CREATE TABLE IF NOT EXISTS coupons (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL,                               -- 一律存大寫，例如 SPRING100
  kind            TEXT NOT NULL CHECK (kind IN ('amount','percent')),
  value           INTEGER NOT NULL CHECK (value > 0),          -- amount：折幾元；percent：折掉幾 %（10 代表九折）
  min_subtotal    INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  starts_at       TIMESTAMPTZ,                                 -- 空白代表立即生效
  ends_at         TIMESTAMPTZ,                                 -- 空白代表沒有期限
  max_uses        INTEGER CHECK (max_uses IS NULL OR max_uses > 0),  -- 空白代表不限總次數
  per_email_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_email_limit > 0),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 99),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_key ON coupons (code);

-- 訂單：記下用了哪個碼、折了多少。舊訂單自動是「沒用碼、折 0 元」。
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id   INTEGER REFERENCES coupons(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount    INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0);

-- 查「某個碼被付款用了幾次」時用
CREATE INDEX IF NOT EXISTS orders_coupon_id_idx ON orders (coupon_id) WHERE coupon_id IS NOT NULL;
```

**對既有資料的影響**
- `products`、`customers`、`order_items`、`payments`：完全不動。
- `orders`：多出三個欄位。舊訂單的 `coupon_id`、`coupon_code` 是空白，`discount` 是 0。既有欄位的值都不變（F8-3）。
- 訂單的金額關係從「總額＝小計＋運費」變成「總額＝小計 − 折扣＋運費」。舊訂單的折扣是 0，所以兩個算式結果一樣。

**執行順序**（F8-4）
1. 在 Neon 開一個測試分支，在 `.env.local` 換成那個分支的連線字串，執行 `npm run db:setup`。
2. 在本機走完所有驗收條件。
3. 對**線上**資料庫執行 `npm run db:setup`。
4. 推上 GitHub，讓 Vercel 部署新程式。

步驟 3 一定要在步驟 4 之前。新程式會讀新欄位，如果先部署新程式，結帳會失敗。反過來先加欄位不會有問題：舊程式不認識這些欄位，會直接忽略。

**使用紀錄：不另外開表，也不存計數欄位。** 「用了幾次」一律現場計算：

```sql
-- 總使用次數
SELECT COUNT(*)::int FROM orders WHERE coupon_id = $1 AND payment_status = 'paid';
-- 某個 Email 的使用次數
SELECT COUNT(*)::int FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.coupon_id = $1 AND o.payment_status = 'paid' AND c.email = $2;
```

（已取消、但後來還是收到付款的訂單要不要算進去，見待確認 Q2。）

## 4. 後端怎麼驗證優惠碼、怎麼算錢

### 4.1 算錢規則（`lib/coupon-math.ts`）

```
normalizeCode(輸入) = 去掉前後空白 → 轉大寫；只接受 A–Z、0–9、-、_，長度 3–32，不符合就當作無效
computeDiscount(碼, 小計)
  amount  → min(面額, 小計)
  percent → floor(小計 × 百分比 ÷ 100)              （零頭捨去，D1、F2-3）
priceWithCoupon(小計, 折扣, 運費規則)
  折後小計 = 小計 − 折扣
  運費     = 運費規則(折後小計)                       （D2、F2-4）
  總額     = 折後小計 + 運費
  總額 < 1 → 視為不能用                               （F2-5）
```

依現在的運費規則（未滿 1000 元收 80 元），就算折後小計是 0，也要付運費 80 元，所以總額至少 80 元。保留「總額 < 1」這道檢查，是為了以後改成全面免運時還有保護。

### 4.2 能不能用（`lib/coupons.ts` 的 `checkCoupon`）

依序檢查，有一項不通過就停：
1. 碼的格式正確，而且資料庫裡找得到
2. `active = true`
3. 現在的時間在 `starts_at` 和 `ends_at` 之間（用資料庫的 `now()` 判斷，避免伺服器時區不同）
4. 小計 ≥ `min_subtotal`
5. 總使用次數 < `max_uses`
6. 這個 Email 的使用次數 < `per_email_limit`（預覽時還沒有 Email，所以跳過這項）
7. `priceWithCoupon` 算出的總額 ≥ 1

### 4.3 建立訂單（`app/api/orders/route.ts`）

改動放在現有的第 3、4 步之間，其他步驟不動：

```
3. （不變）鎖住商品、檢查庫存
3.5 如果有 couponCode：
      checkCoupon(client, code, 小計, email)
      不通過 → ROLLBACK，回 400 和錯誤訊息（見第 5 節）
4. 折扣 = computeDiscount(...)（沒有碼時折扣是 0）
   運費、總額 = priceWithCoupon(小計, 折扣, shippingFor)
6. INSERT orders 時多寫 coupon_id、coupon_code、discount
7. 付款品名後面加上「#優惠折抵 100 元」，只是顯示給客人看的文字
```

- 前端送來的資料裡，就算有 `discount`、`total` 之類的欄位，也完全不讀（F2-1，CLAUDE.md 規則 1）。
- 下單時**不鎖**優惠碼、**不計次**（D3）。兩個人同時用最後一個名額的情況，交給付款通知處理。

### 4.4 付款通知（`app/api/ecpay/notify/route.ts`）

讀訂單的 SELECT 多讀 `coupon_id` 和 `customer_id`。只在付款成功的「一般路徑」加一段：也就是現在把訂單改成「已付款＋已確認」、扣庫存的那段。

```
（現有）付款帳本 INSERT … ON CONFLICT DO NOTHING → 重複通知在這裡就回 1|OK 離開   ← 規則 5，F4-3
（現有）金額不符／重複付款／已取消 → 照舊，不計次
（現有）更新為已付款＋已確認、扣庫存
（新增）如果 order.coupon_id 有值：
          SELECT … FROM coupons WHERE id = $1 FOR UPDATE      ← 同一個碼的通知排隊，一筆一筆處理
          重算總使用次數、這個 Email 的使用次數（包含這一筆）
          超過 max_uses 或 per_email_limit
            → UPDATE orders SET review_note = '優惠碼 SPRING100 已超過總使用上限（11/10），請確認是否補收差額或接受' 
          訂單狀態照常是已確認                                    ← D3、F4-4
```

- 「付款成功＝用掉一次」靠訂單的 `payment_status` 變成 `paid` 自然成立，不需要另外記錄（F4-2）。
- 金額核對沿用現有的 `amount !== order.total`。`total` 已經是折扣後的金額，所以有折扣的訂單也不會被誤判（F4-5）。

### 4.5 預覽（`POST /api/coupons/preview`）

- 收：`{ code, items: [{ productId, quantity }] }`。商品和數量的檢查規則跟建立訂單相同。
- 從資料庫讀價格算小計，不鎖任何資料。執行 `checkCoupon` 時跳過 Email 那項。
- 回：`{ ok: true, code, discount, shipping, total }` 或 `{ ok: false, error }`。
- **不回傳**最低消費以外的任何設定，例如總上限、已用次數、期限（F9-2）。

### 4.6 後台

- `createCoupon`：第一行檢查 `isAdmin()`，然後依 F6-3 的規則檢查欄位。時間欄位用 `datetime-local` 輸入框，以台灣時間解讀，寫入時轉成 `($1::timestamp AT TIME ZONE 'Asia/Taipei')`。碼重複時，資料庫的唯一索引會擋下來，再轉成白話的錯誤訊息。
- `deactivateCoupon`：第一行檢查 `isAdmin()`，然後只做 `UPDATE coupons SET active = false WHERE id = $1`。
- 後台營收的寫法：現在的查詢是把訂單和明細接起來再加總。如果直接把 `discount` 也加進同一個查詢，一張訂單有幾項商品，折扣就會被重複算幾次。所以要拆成兩個子查詢再相減：

```sql
SELECT
  (SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)
     FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.payment_status = 'paid' AND o.status <> 'cancelled')::int AS gross,
  (SELECT COALESCE(SUM(o.discount), 0)
     FROM orders o
    WHERE o.payment_status = 'paid' AND o.status <> 'cancelled')::int AS discount_total;
-- 商品營收 = gross − discount_total
```

- 優惠碼列表：

```sql
SELECT c.*, COUNT(o.id) FILTER (WHERE o.payment_status = 'paid')::int AS used
FROM coupons c LEFT JOIN orders o ON o.coupon_id = c.id
GROUP BY c.id ORDER BY c.id DESC;
```

## 5. 錯誤時客人和店家看到的訊息

| 情況 | 訊息 | 在哪裡出現 |
|---|---|---|
| 碼格式不對、不存在、已停用、還沒開始、已過期、總數用完 | 這組優惠碼無法使用 | 購物車輸入框下方 |
| 沒到最低消費 | 商品金額滿 NT$ 500 才能使用這組優惠碼 | 同上 |
| 這個 Email 已經用到上限 | 這組優惠碼無法使用 | 結帳按鈕上方 |
| 套用後才增減商品，變成沒到最低消費 | 目前金額未達這組優惠碼的使用門檻 | 輸入框下方。這時不計算折扣 |
| 下單時才發現碼不能用（例如預覽之後剛好過期） | 這組優惠碼無法使用，請移除優惠碼後再結帳 | 結帳按鈕上方；購物車不清空（F3-5） |
| 預覽時網路或伺服器出錯 | 暫時無法確認優惠碼，請稍後再試 | 輸入框下方 |
| 後台：碼重複 | 已經有 SPRING100 這組優惠碼了 | 後台新增表單 |
| 後台：百分比不在 1–99 | 百分比折扣請填 1 到 99 | 同上 |
| 後台：固定金額小於 1 | 折抵金額至少 1 元 | 同上 |
| 後台：結束時間不晚於開始時間 | 結束時間要晚於開始時間 | 同上 |
| 後台：碼格式不對 | 優惠碼只能用英文字母、數字、- 和 _，長度 3 到 32 個字 | 同上 |
| 付款時超用 | 優惠碼 SPRING100 已超過總使用上限（11/10）／已超過每個 Email 的使用上限 | 後台「需要人工處理」 |

## 6. 重要設計決策與理由

1. **算錢只在後端；前端算的只是預估。** 建立訂單時重新查優惠碼、重新計算，前端送來的金額一律不讀。（CLAUDE.md 規則 1）
2. **算錢規則抽出成一個沒有任何 import 的 `lib/coupon-math.ts`。** 預覽和下單用同一份規則，結果才不會兩邊不一致；也能直接用 `node --test` 檢查，不用安裝測試套件。
3. **使用次數不存成計數欄位，改成從已付款訂單現場計算。** 資料只有一份，不會出現「計數器寫 10、實際付款 11 筆」這種對不起來的情況。代價是每次要算一次，以這間店的訂單量來說可以忽略。
4. **計次寫在付款通知裡，而且放在付款帳本防重複的檢查之後。** 綠界重送通知時，在付款帳本那一關就會離開，碰不到計次。（規則 5）
5. **付款時超用不擋單，改交給人工處理。** 客人已經付了錢，系統擋不了；照常成立訂單，讓店家看到再決定怎麼處理。這和「已取消的訂單收到付款」的處理方式一致。
6. **用優惠碼的資料列鎖讓同一個碼的付款通知排隊處理。** 兩筆通知同時到時，後到的那筆會等前一筆存完才計算次數，不會兩筆都以為自己沒超用。
7. **成交單價不變，折扣記在訂單層級。** `order_items.unit_price` 仍然代表「當下的商品單價」；營收另外扣掉折扣。不把折扣分攤到每項商品，避免零頭分配的問題。（規則 6，D6）
8. **訂單同時存 `coupon_id` 和 `coupon_code`。** `coupon_id` 用來計算次數；`coupon_code` 讓訂單頁不用另外查優惠碼表就能顯示。優惠碼不能刪除也不能編輯，兩者不會不一致。
9. **百分比限 1–99，固定金額最多折到小計。** 搭配「總額至少 1 元」的檢查，確保每筆訂單都會經過綠界付款。不需要為了 0 元訂單另開「不經綠界直接確認」的路。（規則 4）
10. **不提供編輯和刪除。** 已經用過的碼如果被改了規則或刪掉，舊訂單會對不了帳；資料表也因此不需要處理「碼被刪掉」的情況。（D5）
11. **資料庫升級沿用 `schema.sql` 和 `db:setup`。** 店主只需要記一個指令，而且可以重複執行。（規則 8，F8）
12. **優惠碼清單完全不經過前端。** 預覽只回答單一一組碼的結果，`/api/products` 不變。（規則 2，F9）

## 7. 驗證計畫

- **自動檢查**（如果 Q5 採用）：`npm run test:coupon`，檢查折扣、零頭捨去、免運門檻、總額下限、碼格式整理。
- **建置**：`npm run build` 要成功。
- **本機完整流程**（在 Neon 測試分支上）：
  1. 在後台新增 `TEST100`（固定 100 元、最低消費 500、總上限 1、每個 Email 1 次）。
  2. 在購物車套用，確認金額正確，再下單。
  3. 執行 `npm run simulate:paid -- 訂單編號 --twice`，確認使用次數是 1、營收扣掉 100 元、折扣總額是 100。
  4. 用另一個 Email 下單（預覽時還能用），然後模擬付款，確認這筆訂單出現在「需要人工處理」。
  5. 停用 `TEST100`，再套用一次，確認顯示「這組優惠碼無法使用」。
- 逐條對照 PRD 的 F1–F9。

## 8. SDD 設計 → PRD 需求對照

| SDD 設計 | 對應 PRD |
|---|---|
| 3. `coupons` 資料表 | D1、D4、D7、F6-2、F6-3 |
| 3. `orders` 新增 `coupon_id`、`coupon_code`、`discount` | F2-6、F5-1、F5-3、F7-1、F8-3 |
| 3. 只新增、`IF NOT EXISTS`、執行順序 | F8-1、F8-2、F8-3、F8-4 |
| 3. 使用次數現場計算（不開紀錄表） | D3、F4-2、F6-4、F6-8 |
| 4.1 `normalizeCode` | F1-2 |
| 4.1 `computeDiscount`（含零頭捨去） | D1、F2-2、F2-3 |
| 4.1 `priceWithCoupon`（折後判斷免運、總額 ≥ 1） | D2、F2-4、F2-5 |
| 4.2 `checkCoupon` 第 1–3 項 | F3-1、F6-5 |
| 4.2 `checkCoupon` 第 4 項 | F3-2、F1-4 |
| 4.2 `checkCoupon` 第 5–6 項 | D4、F3-3、F3-4 |
| 4.3 建立訂單：只收碼、後端重算 | F2-1、F2-6 |
| 4.3 建立訂單：碼不能用就整筆不建立 | F3-1～F3-5 |
| 4.4 付款通知：放在付款帳本之後 | F4-3 |
| 4.4 付款通知：鎖住優惠碼、超用寫入人工處理 | D3、F4-4 |
| 4.4 沿用金額核對 | F4-5 |
| 4.5 預覽 API | F1-1、F1-4、F9-2 |
| 4.6 `createCoupon`、`deactivateCoupon`、`isAdmin()` | D5、F6-1、F6-2、F6-3、F6-5、F6-7 |
| 4.6 優惠碼列表查詢 | F6-4、F6-6 |
| 4.6 營收拆兩個子查詢 | D6、F7-1、F7-2、F7-3 |
| 2. `CartView.tsx` 修改 | F1-1～F1-5、F3-5 |
| 2. `app/orders/[id]/page.tsx` 修改 | F5-1、F5-2 |
| 2. `app/admin/page.tsx` 修改 | F5-3、F7-1、F7-2 |
| 5. 錯誤訊息表 | F1-3、F3-1～F3-5、F6-3、F4-4 |
| 6. 第 12 點：清單不經過前端 | F9-1、F9-2 |
| 7. 自動檢查 | F2-2～F2-5 |

## 9. 已確認的決策（2026-11-07，Q1–Q7 照預設）

- **Q1 錯誤訊息：** 「沒到最低消費」明講門檻金額；「這個 Email 已用到上限」不明講，一律顯示「這組優惠碼無法使用」。第 5 節的訊息表照此定案。
- **Q2 已取消但已付款的訂單：** 算用掉一次。計次條件只看 `payment_status = 'paid'`，跟第 3 節的 SQL 一致。
- **Q3 重新啟用：** 這一版不做，停用之後無法恢復。後台的停用按鈕旁要寫清楚「停用後無法恢復」，並且按下去前要再確認一次。
- **Q4 CLAUDE.md 與 README：** 實作時一起更新。
  - CLAUDE.md 規則 6 補上：「有優惠折扣時，營收再扣掉 `orders.discount`；不准把折扣分攤進 `order_items.unit_price`。」
  - README 補上 `coupons` 資料表、`orders` 的新欄位、優惠碼相關檔案的位置，以及「先升級資料庫再部署」的步驟。
- **Q5 自動檢查：** 採用。已在 2026-11-07 驗證過：Node v26.13.0 的 `node --test` 可以直接 import `.ts` 檔，測試能通過。
  - 限制：`lib/coupon-math.ts` 只能用「拿掉型別標註後就是普通 JavaScript」的寫法，不能用 `enum`、`namespace`，也不能用 `@/` 這種路徑別名。
- **Q6 Neon 測試分支：** 由店主在 Neon 後台建立，我提供逐步說明，但不會碰你的 Neon 帳號。換連線字串之前，店主要先把線上用的連線字串另外存一份。
- **Q7 綠界最低金額：** 2026-11-07 查了綠界官方文件（https://developers.ecpay.com.tw/2864/ 全方位金流付款），`TotalAmount` 只寫「整數、僅限新台幣」，**沒有寫最低金額**。所以「總額 ≥ 1」這道檢查維持不變。以現在的運費規則，總額最少 80 元，不會碰到這個邊界。
