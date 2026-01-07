// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항:
 * 1) footer에는 세로선(경계선) 금지 -> border-l 제거
 * 2) 좌측 메뉴색이 footer에서 겹쳐보임 -> footer 좌측은 단색 bg-slate-800로 고정
 * 3) 링크는 가운데 유지
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  if (!isContents) {
    return (
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="h-12 px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
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
    <footer className="border-t border-gray-800">
      <div className="flex">
        {/* ✅ 좌측: sidebar 하단색과 동일한 단색 (겹침/이중톤 방지) */}
        <div className="w-64 bg-slate-800" />

        {/* ✅ 우측: border-l 제거(세로선 금지) */}
        <div className="flex-1 bg-white dark:bg-gray-900">
          <div className="h-12 px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
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
