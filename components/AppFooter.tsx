// components/AppFooter.tsx
"use client";

/**
 * components/AppFooter.tsx
 * ✅ /contents 하위에서는 Footer를 2컬럼으로 분리
 * ✅ 중복선 제거:
 *   - 본문 구간 경계선은 sidebar(border-r)가 담당
 *   - footer 구간 경계선은 footer 우측(border-l)가 담당
 *   - 좌측 더미 영역에는 border를 절대 넣지 않음
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
        {/* 좌측: 사이드바 폭 유지 (❗border 금지) */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* 우측: footer 구간 경계선은 여기서만 1번 그리기 */}
        <div className="flex-1 bg-white dark:bg-gray-900 border-l border-gray-800">
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
