// 優惠碼：查詢、判斷能不能用、計算使用次數。只在後端使用。
// 「用掉一次」＝付款狀態是已付款的訂單，不另外記錄（docs/coupon/SDD.md 第 3 節、4.2）。
import type { PoolClient } from "pg";
import { shippingFor } from "@/lib/shop";
import { computeDiscount, normalizeCode, priceWithCoupon, type Priced } from "@/lib/coupon-math";

export type Coupon = {
  id: number;
  code: string;
  kind: "amount" | "percent";
  value: number;
  min_subtotal: number;
  starts_at: Date | null;
  ends_at: Date | null;
  max_uses: number | null;
  per_email_limit: number;
  active: boolean;
};

// 客人看到的訊息（SDD 第 5 節、Q1）
export const COUPON_MSG = {
  unusable: "這組優惠碼無法使用",
  unusableAtCheckout: "這組優惠碼無法使用，請移除優惠碼後再結帳",
  minSubtotal: (n: number) => `商品金額滿 NT$ ${n.toLocaleString("zh-TW")} 才能使用這組優惠碼`,
};

export type CouponCheck =
  | ({ ok: true; coupon: Coupon } & Priced)
  | { ok: false; reason: "unusable" | "min_subtotal"; minSubtotal?: number };

type Db = Pick<PoolClient, "query">;

export async function countPaidUses(client: Db, couponId: number): Promise<number> {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM orders WHERE coupon_id = $1 AND payment_status = 'paid'",
    [couponId]
  );
  return rows[0].n;
}

export async function countPaidUsesByCustomer(client: Db, couponId: number, customerId: number): Promise<number> {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM orders WHERE coupon_id = $1 AND customer_id = $2 AND payment_status = 'paid'",
    [couponId, customerId]
  );
  return rows[0].n;
}

async function countPaidUsesByEmail(client: Db, couponId: number, email: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.coupon_id = $1 AND o.payment_status = 'paid' AND c.email = $2`,
    [couponId, email]
  );
  return rows[0].n;
}

// 依序檢查（SDD 4.2）。email 為 null 時（購物車預覽）跳過每個 Email 的上限。
export async function checkCoupon(client: Db, rawCode: unknown, subtotal: number, email: string | null): Promise<CouponCheck> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "unusable" };

  // 1–3：存在、啟用、在期間內（時間用資料庫的 now()）
  const { rows } = await client.query(
    `SELECT id, code, kind, value, min_subtotal, starts_at, ends_at, max_uses, per_email_limit, active,
            (active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())) AS live
     FROM coupons WHERE code = $1`,
    [code]
  );
  const row = rows[0];
  if (!row || !row.live) return { ok: false, reason: "unusable" };
  const coupon: Coupon = row;

  // 4：最低消費
  if (subtotal < coupon.min_subtotal) return { ok: false, reason: "min_subtotal", minSubtotal: coupon.min_subtotal };

  // 5：總次數
  if (coupon.max_uses !== null && (await countPaidUses(client, coupon.id)) >= coupon.max_uses) {
    return { ok: false, reason: "unusable" };
  }

  // 6：每個 Email 的次數
  if (email !== null && (await countPaidUsesByEmail(client, coupon.id, email)) >= coupon.per_email_limit) {
    return { ok: false, reason: "unusable" };
  }

  // 7：算錢，總額要至少 1 元
  const priced = priceWithCoupon(subtotal, computeDiscount(coupon, subtotal), shippingFor);
  if (!priced || priced.discount <= 0) return { ok: false, reason: "unusable" };

  return { ok: true, coupon, ...priced };
}

// 後台列表的狀態文字（PRD F6-4）
export function couponStatus(c: Coupon & { used: number }, now = new Date()): string {
  if (!c.active) return "停用";
  if (c.starts_at && new Date(c.starts_at) > now) return "未開始";
  if (c.ends_at && new Date(c.ends_at) <= now) return "已過期";
  if (c.max_uses !== null && c.used >= c.max_uses) return "已用完";
  return "有效";
}

export function describeCoupon(c: Pick<Coupon, "kind" | "value">): string {
  if (c.kind === "amount") return `折 NT$ ${c.value.toLocaleString("zh-TW")}`;
  const off = 100 - c.value;
  return `${off % 10 === 0 ? off / 10 : off} 折（折掉 ${c.value}%）`;
}
