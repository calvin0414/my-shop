import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCoupon, COUPON_MSG } from "@/lib/coupons";

export const dynamic = "force-dynamic";

// POST /api/coupons/preview：購物車按「套用」時用，只回答「這組碼現在能不能用、折多少」。
// 不計次、不保留名額；真正的金額在建立訂單時重算（docs/coupon/SDD.md 4.5）。
export async function POST(req: Request) {
  let body: { code?: unknown; items?: { productId?: unknown; quantity?: unknown }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: COUPON_MSG.unusable }, { status: 400 });
  }

  // 商品與數量的檢查規則和 app/api/orders/route.ts 相同
  const qty = new Map<number, number>();
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const id = Number(it.productId);
    const q = Number(it.quantity);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(q) || q <= 0 || q > 20) {
      return NextResponse.json({ ok: false, error: "購物車裡有商品或數量不正確" }, { status: 400 });
    }
    qty.set(id, (qty.get(id) ?? 0) + q);
  }
  if (qty.size === 0 || qty.size > 20) {
    return NextResponse.json({ ok: false, error: "購物車裡有商品或數量不正確" }, { status: 400 });
  }

  try {
    const client = db();
    const { rows } = await client.query("SELECT id, price FROM products WHERE id = ANY($1::int[])", [[...qty.keys()]]);
    const subtotal = rows.reduce((s: number, p: { id: number; price: number }) => s + p.price * qty.get(p.id)!, 0);

    const r = await checkCoupon(client, body.code, subtotal, null);
    if (!r.ok) {
      const error = r.reason === "min_subtotal" ? COUPON_MSG.minSubtotal(r.minSubtotal!) : COUPON_MSG.unusable;
      return NextResponse.json({ ok: false, error });
    }
    return NextResponse.json({ ok: true, code: r.coupon.code, discount: r.discount, shipping: r.shipping, total: r.total });
  } catch (e) {
    console.error("預覽優惠碼失敗", e);
    return NextResponse.json({ ok: false, error: "暫時無法確認優惠碼，請稍後再試" }, { status: 500 });
  }
}
