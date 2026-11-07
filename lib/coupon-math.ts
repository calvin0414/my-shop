// 優惠碼的算錢規則。只放規則，不碰資料庫。
// 這個檔案不准 import 任何東西，也不准用 enum、namespace：
// scripts/coupon-math.test.mjs 會直接用 node 讀它（npm run test:coupon）。
// 規則說明：docs/coupon/SDD.md 4.1。

export type CouponRule = { kind: string; value: number };
export type Priced = { discount: number; shipping: number; total: number };

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

// 去掉前後空白、轉大寫；格式不對就回傳 null
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

// 折扣金額（整數元）。固定金額不超過小計；百分比零頭捨去。
export function computeDiscount(rule: CouponRule, subtotal: number): number {
  const v = rule.value;
  if (!Number.isInteger(v) || v <= 0 || !Number.isInteger(subtotal) || subtotal <= 0) return 0;
  if (rule.kind === "amount") return Math.min(v, subtotal);
  if (rule.kind === "percent" && v <= 99) return Math.floor((subtotal * v) / 100);
  return 0;
}

// 折扣、運費、總額。運費用折扣後的金額判斷；總額不到 1 元回傳 null（不能交給綠界）。
export function priceWithCoupon(subtotal: number, discount: number, shippingFor: (s: number) => number): Priced | null {
  const d = Math.max(0, Math.min(discount, subtotal));
  const after = subtotal - d;
  const shipping = shippingFor(after);
  const total = after + shipping;
  if (total < 1) return null;
  return { discount: d, shipping, total };
}
