import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import SetupNotice, { dbErrorReason } from "@/components/SetupNotice";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import { db } from "@/lib/db";
import { adminEnabled, isAdmin } from "@/lib/admin-auth";
import { couponStatus, describeCoupon, type Coupon } from "@/lib/coupons";
import { SHOP, formatNT } from "@/lib/shop";
import { createCoupon, deactivateCoupon } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `優惠碼｜${SHOP.name}`, robots: { index: false } };

const COUPON_FORM_ERRORS: Record<string, string> = {
  code: "優惠碼只能用英文字母、數字、- 和 _，長度 3 到 32 個字",
  kind: "請選擇折扣種類",
  percent: "百分比折扣請填 1 到 99",
  amount: "折抵金額至少 1 元",
  min: "最低消費請填 0 以上的整數",
  max: "總次數上限請留空，或填 1 以上的整數",
  per: "每個 Email 次數上限請填 1 以上的整數",
  time: "時間格式不正確",
  range: "結束時間要晚於開始時間",
};

const tw = (d: Date | null) =>
  d ? new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }) : "";

export default async function CouponsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string; created?: string }>;
}) {
  if (!adminEnabled() || !(await isAdmin())) redirect("/admin");
  const { error, code, created } = await searchParams;

  let coupons: (Coupon & { used: number })[] = [];
  try {
    coupons = (
      await db().query(`
        SELECT c.*, COUNT(o.id) FILTER (WHERE o.payment_status = 'paid')::int AS used
        FROM coupons c LEFT JOIN orders o ON o.coupon_id = c.id
        GROUP BY c.id ORDER BY c.id DESC`)
    ).rows;
  } catch (e) {
    return <SetupNotice reason={dbErrorReason(e)} />;
  }

  const errorMsg = error === "dup" ? `已經有 ${code ?? ""} 這組優惠碼了` : error ? COUPON_FORM_ERRORS[error] ?? "資料不正確" : "";

  return (
    <div className="section">
      <p><Link href="/admin">← 回店家後台</Link></p>
      <h1>優惠碼</h1>

      <form action={createCoupon} className="panel" style={{ maxWidth: 560 }}>
        <h2 style={{ fontSize: "1.2rem" }}>新增優惠碼</h2>
        <div className="field">
          <label htmlFor="code">優惠碼（英文字母、數字、- 或 _）</label>
          <input id="code" name="code" type="text" required minLength={3} maxLength={32} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="kind">折扣種類</label>
          <select id="kind" name="kind" defaultValue="amount">
            <option value="amount">固定金額（折幾元）</option>
            <option value="percent">百分比（折掉幾 %，例如 10 代表九折）</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="value">數值</label>
          <input id="value" name="value" type="number" min={1} step={1} required />
        </div>
        <div className="field">
          <label htmlFor="min_subtotal">最低消費（商品小計，留空代表沒有門檻）</label>
          <input id="min_subtotal" name="min_subtotal" type="number" min={0} step={1} />
        </div>
        <div className="field">
          <label htmlFor="starts_at">開始時間（台灣時間，留空代表立即生效）</label>
          <input id="starts_at" name="starts_at" type="datetime-local" />
        </div>
        <div className="field">
          <label htmlFor="ends_at">結束時間（台灣時間，留空代表沒有期限）</label>
          <input id="ends_at" name="ends_at" type="datetime-local" />
        </div>
        <div className="field">
          <label htmlFor="max_uses">總次數上限（留空代表不限）</label>
          <input id="max_uses" name="max_uses" type="number" min={1} step={1} />
        </div>
        <div className="field">
          <label htmlFor="per_email_limit">每個 Email 次數上限</label>
          <input id="per_email_limit" name="per_email_limit" type="number" min={1} step={1} defaultValue={1} required />
        </div>
        {errorMsg && <p className="notice err" role="alert">{errorMsg}</p>}
        {created && !error && <p className="notice" role="status">已新增 {created}</p>}
        <button className="btn" type="submit">新增</button>
        <p className="hint">優惠碼建立後不能編輯或刪除，只能停用。</p>
      </form>

      <h2 style={{ fontSize: "1.2rem", marginTop: 32 }}>所有優惠碼</h2>
      {coupons.length === 0 ? (
        <p>還沒有優惠碼。</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">優惠碼</th><th scope="col">折扣</th><th scope="col">最低消費</th><th scope="col">期間</th>
                <th scope="col">已使用／上限</th><th scope="col">每個 Email</th><th scope="col">狀態</th><th scope="col">動作</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.code}</b></td>
                  <td>{describeCoupon(c)}</td>
                  <td className="nowrap">{c.min_subtotal ? formatNT(c.min_subtotal) : "無"}</td>
                  <td>{c.starts_at || c.ends_at ? `${tw(c.starts_at) || "立即"} ～ ${tw(c.ends_at) || "不限"}` : "不限"}</td>
                  <td>{c.used} ／ {c.max_uses ?? "不限"}</td>
                  <td>{c.per_email_limit} 次</td>
                  <td>{couponStatus(c)}</td>
                  <td>
                    {c.active && (
                      <form action={deactivateCoupon}>
                        <input type="hidden" name="couponId" value={c.id} />
                        <ConfirmSubmit message={`確定要停用 ${c.code} 嗎？停用後無法恢復。`}>停用（無法恢復）</ConfirmSubmit>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>「已使用」只算已付款的訂單。</p>
    </div>
  );
}
