// 優惠碼算錢規則的自動檢查。用法：npm run test:coupon
// 規則改壞了，這裡就會失敗。對應 docs/coupon/PRD.md 的 F1-2、F2-2～F2-5。
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, computeDiscount, priceWithCoupon } from "../lib/coupon-math.ts";

// 和 lib/shop.ts 現在的規則相同：滿 1000 免運，否則 80
const shipping = (s) => (s >= 1000 ? 0 : 80);

test("碼：去掉前後空白、轉大寫（F1-2）", () => {
  assert.equal(normalizeCode("  spring100 "), "SPRING100");
  assert.equal(normalizeCode("new_year-2027"), "NEW_YEAR-2027");
});

test("碼：格式不對就是 null", () => {
  assert.equal(normalizeCode(""), null);
  assert.equal(normalizeCode("ab"), null);
  assert.equal(normalizeCode("A".repeat(33)), null);
  assert.equal(normalizeCode("有中文"), null);
  assert.equal(normalizeCode("HAS SPACE"), null);
  assert.equal(normalizeCode(123), null);
  assert.equal(normalizeCode(undefined), null);
});

test("固定金額：折面額，但不超過小計（F2-2）", () => {
  assert.equal(computeDiscount({ kind: "amount", value: 100 }, 659), 100);
  assert.equal(computeDiscount({ kind: "amount", value: 500 }, 320), 320);
});

test("百分比：零頭捨去（F2-3）", () => {
  assert.equal(computeDiscount({ kind: "percent", value: 10 }, 659), 65);
  assert.equal(computeDiscount({ kind: "percent", value: 15 }, 999), 149);
  assert.equal(computeDiscount({ kind: "percent", value: 99 }, 1), 0);
});

test("不認得的種類或不合理的數值，一律不折", () => {
  assert.equal(computeDiscount({ kind: "free", value: 100 }, 659), 0);
  assert.equal(computeDiscount({ kind: "amount", value: -5 }, 659), 0);
  assert.equal(computeDiscount({ kind: "percent", value: 150 }, 659), 0);
  assert.equal(computeDiscount({ kind: "amount", value: 1.5 }, 659), 0);
});

test("免運用折扣前的商品小計判斷（F2-4）", () => {
  // 小計 1000 已達免運門檻，折 100 之後仍然免運
  assert.deepEqual(priceWithCoupon(1000, 100, shipping), { discount: 100, shipping: 0, total: 900 });
  assert.deepEqual(priceWithCoupon(1099, 100, shipping), { discount: 100, shipping: 0, total: 999 });
  assert.deepEqual(priceWithCoupon(1200, 100, shipping), { discount: 100, shipping: 0, total: 1100 });
  assert.deepEqual(priceWithCoupon(999, 100, shipping), { discount: 100, shipping: 80, total: 979 });
  assert.deepEqual(priceWithCoupon(659, 0, shipping), { discount: 0, shipping: 80, total: 739 });
});

test("小計達免運門檻、折扣等於小計時，總額 0 元不能用", () => {
  assert.equal(priceWithCoupon(1000, 1000, shipping), null);
});

test("總額＝小計−折扣＋運費；折扣不超過小計（F2-5）", () => {
  assert.deepEqual(priceWithCoupon(320, 320, shipping), { discount: 320, shipping: 80, total: 80 });
  assert.deepEqual(priceWithCoupon(320, 999, shipping), { discount: 320, shipping: 80, total: 80 });
});

test("總額不到 1 元時回傳 null", () => {
  assert.equal(priceWithCoupon(320, 320, () => 0), null);
});
