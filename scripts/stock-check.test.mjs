// 超賣提醒的自動檢查。用法：node --test scripts/stock-check.test.mjs
// 付款通知扣庫存前用 lib/stock-check.ts 找出庫存不夠的商品；這裡壞了，超賣就會又變成無聲無息。
import test from "node:test";
import assert from "node:assert/strict";
import { findShortages, shortageNote } from "../lib/stock-check.ts";

test("庫存夠：沒有超賣，不寫提醒", () => {
  const s = findShortages([
    { product_name: "大湖草莓果醬", quantity: 2, stock: 30 },
    { product_name: "無花果果醬", quantity: 2, stock: 2 }, // 剛好賣完不算超賣
  ]);
  assert.deepEqual(s, []);
  assert.equal(shortageNote(s), null);
});

test("庫存不夠：找出那一款，並寫出需要與剩下的罐數", () => {
  const s = findShortages([
    { product_name: "大湖草莓果醬", quantity: 1, stock: 30 },
    { product_name: "無花果果醬", quantity: 2, stock: 1 },
  ]);
  assert.deepEqual(s, [{ name: "無花果果醬", need: 2, have: 1 }]);
  assert.equal(shortageNote(s), "超賣：無花果果醬 需要 2 罐，只剩 1 罐，請聯絡客人或補貨");
});

test("庫存已經是 0：也算超賣", () => {
  const s = findShortages([{ product_name: "洛神花果醬", quantity: 1, stock: 0 }]);
  assert.deepEqual(s, [{ name: "洛神花果醬", need: 1, have: 0 }]);
});

test("多款同時不夠：全部列出", () => {
  const note = shortageNote(
    findShortages([
      { product_name: "藍莓果醬", quantity: 3, stock: 1 },
      { product_name: "無花果果醬", quantity: 2, stock: 0 },
    ])
  );
  assert.equal(note, "超賣：藍莓果醬 需要 3 罐，只剩 1 罐；無花果果醬 需要 2 罐，只剩 0 罐，請聯絡客人或補貨");
});
