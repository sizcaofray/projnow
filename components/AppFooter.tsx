// components/AppFooter.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  if (!isContents) {
    return (
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <div className="h-12 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/contents/terms">이용약관</Link>
          <Link href="/contents/privacy">개인정보처리방침</Link>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-transparent">
      <div className="flex">
        {/* 좌측: sidebar 연장 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* 우측: footer 내용 (세로선 없음) */}
        <div className="flex-1 bg-white dark:bg-gray-900 border-t border-gray-800">
          <div className="h-12 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
            <Link href="/contents/terms">이용약관</Link>
            <Link href="/contents/privacy">개인정보처리방침</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
