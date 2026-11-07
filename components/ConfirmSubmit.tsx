"use client";

// 送出前先跳出確認視窗的按鈕（例如「停用優惠碼」這種不能恢復的動作）
export default function ConfirmSubmit({ message, children }: { message: string; children: React.ReactNode }) {
  return (
    <button
      className="btn ghost"
      type="submit"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
