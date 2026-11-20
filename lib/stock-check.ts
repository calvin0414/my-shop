// 付款成功要扣庫存時，找出「訂單要的罐數比現在庫存多」的商品（超賣）。
// 下單時只檢查、不保留庫存，所以兩張未付款訂單可能搶同一批貨；付款通知時用這裡發現並提醒店家。

export type StockLine = { product_name: string; quantity: number; stock: number };
export type Shortage = { name: string; need: number; have: number };

export function findShortages(lines: StockLine[]): Shortage[] {
  return lines
    .filter((l) => Number(l.stock) < Number(l.quantity))
    .map((l) => ({ name: l.product_name, need: Number(l.quantity), have: Number(l.stock) }));
}

export function shortageNote(shortages: Shortage[]): string | null {
  if (shortages.length === 0) return null;
  const parts = shortages.map((s) => `${s.name} 需要 ${s.need} 罐，只剩 ${s.have} 罐`);
  return `超賣：${parts.join("；")}，請聯絡客人或補貨`;
}
