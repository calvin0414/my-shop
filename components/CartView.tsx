"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import JarArt from "./JarArt";
import { readCart, writeCart, type CartLine } from "@/lib/cart";

type P = { id: number; name: string; price: number; stock: number; color: string; slug: string };
const nt = (n: number) => "NT$ " + n.toLocaleString("zh-TW");

export default function CartView({ shippingFee, freeOver }: { shippingFee: number; freeOver: number }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Record<number, P>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 優惠碼：這裡的折扣只是預估，真正的金額由後端建立訂單時重算
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number | null } | null>(null);
  const [couponMsg, setCouponMsg] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setLines(readCart());
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<number, P> = {};
        (d.products ?? []).forEach((p: P) => (map[p.id] = p));
        setProducts(map);
      })
      .catch(() => setError("讀不到商品資料，請稍後重新整理"))
      .finally(() => setLoaded(true));
  }, []);

  function update(next: CartLine[]) {
    setLines(next);
    writeCart(next);
  }

  const shown = lines.filter((l) => products[l.productId]);
  const subtotal = shown.reduce((s, l) => s + products[l.productId].price * l.quantity, 0);
  const discount = coupon?.discount ?? 0;
  // 免運看折扣後的金額（和後端 lib/coupon-math.ts 的規則相同）
  const shipping = subtotal - discount >= freeOver || subtotal === 0 ? 0 : shippingFee;
  const itemsKey = JSON.stringify(shown.map((l) => [l.productId, l.quantity]));

  async function previewCoupon(code: string): Promise<{ ok: boolean; code?: string; discount?: number; error?: string }> {
    try {
      const res = await fetch("/api/coupons/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, items: shown.map((l) => ({ productId: l.productId, quantity: l.quantity })) }),
      });
      return await res.json();
    } catch {
      return { ok: false, error: "暫時無法確認優惠碼，請稍後再試" };
    }
  }

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setChecking(true);
    const d = await previewCoupon(code);
    setChecking(false);
    if (d.ok && d.code) {
      setCoupon({ code: d.code, discount: d.discount ?? 0 });
      setCouponMsg("");
    } else {
      setCoupon(null);
      setCouponMsg(d.error ?? "這組優惠碼無法使用");
    }
  }

  function removeCoupon() {
    setCoupon(null);
    setCouponMsg("");
    setCouponInput("");
  }

  // 已套用優惠碼時，商品或數量一改就重新預估
  useEffect(() => {
    if (!coupon || shown.length === 0) return;
    let stale = false;
    previewCoupon(coupon.code).then((d) => {
      if (stale) return;
      if (d.ok) {
        setCoupon({ code: coupon.code, discount: d.discount ?? 0 });
        setCouponMsg("");
      } else {
        setCoupon({ code: coupon.code, discount: null });
        setCouponMsg(d.error ?? "目前金額未達這組優惠碼的使用門檻");
      }
    });
    return () => {
      stale = true;
    };
  }, [itemsKey, coupon?.code]);

  async function checkout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: shown.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          customer: { name: f.get("name"), email: f.get("email"), phone: f.get("phone"), address: f.get("address") },
          couponCode: coupon?.code ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "結帳失敗，請再試一次");
        if (data.couponError) setCouponMsg(data.error);
        setBusy(false);
        return;
      }
      writeCart([]);
      // 把後端準備好的付款表單送到綠界
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.ecpay.action;
      for (const [k, v] of Object.entries(data.ecpay.fields as Record<string, string>)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch {
      setError("網路連線有問題，請再試一次");
      setBusy(false);
    }
  }

  if (!loaded) return <p className="section">讀取購物車中…</p>;
  if (shown.length === 0)
    return (
      <div className="section">
        <h1>購物車</h1>
        <p>購物車是空的。</p>
        <Link className="btn" href="/">去逛逛</Link>
        {error && <p className="notice err" role="alert">{error}</p>}
      </div>
    );

  return (
    <>
      <h1 style={{ marginTop: 32 }}>購物車</h1>
      <div className="cart-layout">
        <section className="panel" aria-label="購物車內容">
          {shown.map((l) => {
            const p = products[l.productId];
            return (
              <div className="line" key={l.productId}>
                <JarArt color={p.color} label={p.name} size={64} />
                <div>
                  <Link href={`/products/${p.slug}`}><b>{p.name}</b></Link>
                  <div className="meta">
                    <span>{nt(p.price)}</span>
                    <div className="qty" role="group" aria-label={`${p.name} 的數量`}>
                      <button type="button" aria-label="減少一罐"
                        onClick={() => update(lines.map((x) => x.productId === l.productId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>−</button>
                      <output aria-live="polite">{l.quantity}</output>
                      <button type="button" aria-label="增加一罐"
                        onClick={() => update(lines.map((x) => x.productId === l.productId ? { ...x, quantity: Math.min(20, x.quantity + 1) } : x))}>＋</button>
                    </div>
                    <button type="button" className="linkbtn" onClick={() => update(lines.filter((x) => x.productId !== l.productId))}>
                      移除
                    </button>
                  </div>
                </div>
                <b>{nt(p.price * l.quantity)}</b>
              </div>
            );
          })}
        </section>

        <section className="panel" aria-labelledby="checkout-h">
          <h2 id="checkout-h" style={{ fontSize: "1.2rem" }}>結帳</h2>
          <div className="field">
            <label htmlFor="coupon">優惠碼</label>
            {coupon ? (
              <p style={{ margin: 0 }}>
                已套用 <b>{coupon.code}</b>{" "}
                <button type="button" className="linkbtn" onClick={removeCoupon}>移除</button>
              </p>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="coupon"
                  type="text"
                  value={couponInput}
                  autoComplete="off"
                  style={{ flex: 1, minWidth: 0 }}
                  aria-describedby={couponMsg ? "coupon-msg" : undefined}
                  onChange={(e) => setCouponInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCoupon();
                    }
                  }}
                />
                <button type="button" className="btn ghost" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={applyCoupon} disabled={checking || !couponInput.trim()}>
                  {checking ? "確認中…" : "套用"}
                </button>
              </div>
            )}
            {couponMsg && <p id="coupon-msg" className="notice err" role="alert">{couponMsg}</p>}
          </div>
          <div className="sum"><span>商品小計</span><span>{nt(subtotal)}</span></div>
          {discount > 0 && (
            <div className="sum"><span>優惠折扣</span><span>−{nt(discount)}</span></div>
          )}
          <div className="sum"><span>運費</span><span>{shipping === 0 ? "免運" : nt(shipping)}</span></div>
          <div className="sum total"><span>預估總金額</span><span>{nt(subtotal - discount + shipping)}</span></div>
          <p className="hint">實際金額以送出後店家系統計算為準。滿 {nt(freeOver)} 免運。</p>
          <form onSubmit={checkout} style={{ marginTop: 16 }}>
            <div className="field"><label htmlFor="name">收件人姓名</label><input id="name" name="name" type="text" required autoComplete="name" /></div>
            <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
            <div className="field"><label htmlFor="phone">手機</label><input id="phone" name="phone" type="tel" required autoComplete="tel" /></div>
            <div className="field"><label htmlFor="address">收件地址</label><input id="address" name="address" type="text" required autoComplete="street-address" /></div>
            {error && <p className="notice err" role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "建立訂單中…" : "前往綠界付款（測試）"}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
