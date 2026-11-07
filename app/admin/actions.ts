"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ALLOWED_NEXT } from "@/lib/orders";
import { isAdmin, signIn, signOut } from "@/lib/admin-auth";
import { normalizeCode } from "@/lib/coupon-math";

export async function login(formData: FormData) {
  const ok = await signIn(String(formData.get("password") ?? ""));
  redirect(ok ? "/admin" : "/admin?error=1");
}

export async function logout() {
  await signOut();
  redirect("/admin");
}

// 改訂單狀態：每次都在後端重新確認「是不是店家」與「這條路准不准走」
export async function changeStatus(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin");
  const id = Number(formData.get("orderId"));
  const to = String(formData.get("to"));
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE", [id]);
    const o = rows[0];
    const allowed = o && (ALLOWED_NEXT[o.status] ?? []).includes(to);
    // 已付款的訂單不能直接在這裡取消，要先處理退款
    const blocked = to === "cancelled" && o?.payment_status === "paid";
    if (allowed && !blocked) {
      await client.query("UPDATE orders SET status = $2 WHERE id = $1", [id, to]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  revalidatePath("/admin");
}

// ===== 優惠碼（docs/coupon/SDD.md 4.6）=====

// 錯誤代號 → 訊息放在 app/admin/coupons/page.tsx 的 COUPON_FORM_ERRORS
function couponFormError(code: string): never {
  redirect(`/admin/coupons?error=${code}`);
}

function intField(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
}

function timeField(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? s : "invalid";
}

export async function createCoupon(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin");

  const code = normalizeCode(formData.get("code"));
  if (!code) couponFormError("code");
  const kind = String(formData.get("kind"));
  if (kind !== "amount" && kind !== "percent") couponFormError("kind");
  const value = intField(formData.get("value"));
  if (kind === "percent" && (value === null || Number.isNaN(value) || value < 1 || value > 99)) couponFormError("percent");
  if (kind === "amount" && (value === null || Number.isNaN(value) || value < 1)) couponFormError("amount");
  const minSubtotal = intField(formData.get("min_subtotal")) ?? 0;
  if (Number.isNaN(minSubtotal) || minSubtotal < 0) couponFormError("min");
  const maxUses = intField(formData.get("max_uses"));
  if (maxUses !== null && (Number.isNaN(maxUses) || maxUses < 1)) couponFormError("max");
  const perEmail = intField(formData.get("per_email_limit")) ?? 1;
  if (Number.isNaN(perEmail) || perEmail < 1) couponFormError("per");
  const startsAt = timeField(formData.get("starts_at"));
  const endsAt = timeField(formData.get("ends_at"));
  if (startsAt === "invalid" || endsAt === "invalid") couponFormError("time");
  if (startsAt && endsAt && endsAt <= startsAt) couponFormError("range");

  let duplicate = false;
  try {
    // 時間欄位以台灣時間解讀
    await db().query(
      `INSERT INTO coupons (code, kind, value, min_subtotal, starts_at, ends_at, max_uses, per_email_limit)
       VALUES ($1, $2, $3, $4, ($5::timestamp AT TIME ZONE 'Asia/Taipei'), ($6::timestamp AT TIME ZONE 'Asia/Taipei'), $7, $8)`,
      [code, kind, value, minSubtotal, startsAt, endsAt, maxUses, perEmail]
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505") duplicate = true;
    else throw e;
  }
  if (duplicate) redirect(`/admin/coupons?error=dup&code=${encodeURIComponent(code!)}`);
  revalidatePath("/admin/coupons");
  redirect(`/admin/coupons?created=${encodeURIComponent(code!)}`);
}

// 停用後無法恢復（Q3）
export async function deactivateCoupon(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin");
  await db().query("UPDATE coupons SET active = false WHERE id = $1", [Number(formData.get("couponId"))]);
  revalidatePath("/admin/coupons");
}

export async function clearReview(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin");
  await db().query("UPDATE orders SET review_note = NULL WHERE id = $1", [Number(formData.get("orderId"))]);
  revalidatePath("/admin");
}
