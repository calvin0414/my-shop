-- 小島果醬的五張資料表。重複執行也安全（IF NOT EXISTS）。

-- 商品
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,          -- 網址用的英文代號，例如 strawberry
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price >= 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  color       TEXT NOT NULL DEFAULT '#B45309', -- 果醬罐插圖的顏色
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 客人：同一個 email 只存一筆，地址不用每張訂單重打
CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  phone      TEXT NOT NULL,
  address    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 訂單：訂單狀態與付款狀態分成兩個欄位
CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','shipped','completed','cancelled')),
  payment_status    TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','paid','failed','refunded')),
  subtotal          INTEGER NOT NULL,
  shipping_fee      INTEGER NOT NULL,
  total             INTEGER NOT NULL,
  merchant_trade_no TEXT UNIQUE NOT NULL,    -- 送給綠界的交易編號
  access_token      TEXT NOT NULL,           -- 只有下單的瀏覽器拿得到，用來確認「這張訂單是你的」
  review_note       TEXT,                    -- 需要人工處理時寫在這裡
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 訂單編號從 1001 開始
SELECT setval(pg_get_serial_sequence('orders','id'), 1000, true)
WHERE NOT EXISTS (SELECT 1 FROM orders);

-- 訂單明細：記下「成交當下」的單價，之後商品改價也不影響這筆
CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price   INTEGER NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0)
);

-- 付款通知帳本：每一筆綠界通知都記下來，同一個綠界交易編號只處理一次
CREATE TABLE IF NOT EXISTS payments (
  id                SERIAL PRIMARY KEY,
  ecpay_trade_no    TEXT UNIQUE NOT NULL,
  merchant_trade_no TEXT NOT NULL,
  rtn_code          TEXT NOT NULL,
  amount            INTEGER NOT NULL,
  simulate_paid     BOOLEAN NOT NULL DEFAULT false,
  raw               JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- ===== 訂單收件資料（2026-11 新增）=====

-- 每張訂單存下「下單當下」的收件人、電話、地址。
-- 客人資料表同一個 Email 只有一筆、會被下一次下單蓋掉，所以出貨要看這裡，不看 customers。
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_name    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_phone   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_address TEXT;

-- 補舊單：加欄位之前的訂單沒有記錄，用客人資料表「目前」的資料補上（只補還是空的，重複執行不會蓋掉）。
-- 注意：若那位客人之後又下過單，補進來的是最新一次的資料，不一定是當時的地址。
UPDATE orders o
   SET ship_name = c.name, ship_phone = c.phone, ship_address = c.address
  FROM customers c
 WHERE c.id = o.customer_id AND o.ship_name IS NULL;
