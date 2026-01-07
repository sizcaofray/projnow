// components/AppFooter.tsx
"use client";

/**
 * components/AppFooter.tsx
 * ✅ /contents 하위에서는 Footer를 2컬럼으로 분리
 * ✅ 경계선은 Footer(우측 영역 border-l)가 담당
 *   - Sidebar에는 border-r이 없으므로 중복선이 생기지 않음
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
        {/* 좌측: 사이드바 폭 유지 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* 우측: Footer가 경계선 우선 */}
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
