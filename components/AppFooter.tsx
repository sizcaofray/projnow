// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항:
 * 1) 좌측 메뉴 배경이 footer까지 연결되어 보이게 (좌측 w-64 동일 배경)
 * 2) footer에는 세로선(경계선) 절대 없음 (border-l / pseudo-line 금지)
 * 3) 링크는 가운데
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

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

  return (
    <footer className="bg-transparent">
      <div className="flex">
        {/* 좌측: sidebar 배경 연장 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* 우측: footer 내용 (✅ 세로선 금지: border-l 없음)
            ✅ 상단선은 우측에만 */}
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
