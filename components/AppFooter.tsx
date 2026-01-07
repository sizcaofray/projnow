// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항:
 * 2) footer에는 세로선(경계선) 절대 없음
 * - /contents 에서는 footer 좌측을 w-64로 분리해 sidebar 배경을 "연장"처럼 보이게
 * - border-l / pseudo 세로선은 사용하지 않음
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  // contents 외 페이지용 footer
  if (!isContents) {
    return (
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <div className="h-12 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/contents/terms" className="hover:underline">
            이용약관
          </Link>
          <Link href="/contents/privacy" className="hover:underline">
            개인정보처리방침
          </Link>
        </div>
      </footer>
    );
  }

  // contents 전용 footer (✅ 세로선 없음)
  return (
    <footer className="bg-transparent">
      <div className="flex">
        {/* 좌측: sidebar 배경 연장 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* 우측: footer 내용 (✅ border-l 없음) */}
        <div className="flex-1 bg-white dark:bg-gray-900 border-t border-gray-800">
          <div className="h-12 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
            <Link href="/contents/terms" className="hover:underline">
              이용약관
            </Link>
            <Link href="/contents/privacy" className="hover:underline">
              개인정보처리방침
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
