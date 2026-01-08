// components/AppFooter.tsx
"use client";

import Link from "next/link";

export default function AppFooter() {
  return (
    <footer className="h-12 flex border-t border-gray-800">
      {/* Sidebar 영역 */}
      <div className="w-64 bg-slate-800" />

      {/* Footer 본문 */}
      <div className="flex-1 bg-black flex items-center justify-center gap-6 text-sm text-gray-300">
        <Link href="/contents/terms">이용약관</Link>
        <Link href="/contents/privacy">개인정보처리방침</Link>
      </div>
    </footer>
  );
}
