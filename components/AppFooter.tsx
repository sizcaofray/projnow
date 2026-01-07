// components/AppFooter.tsx
"use client";

/**
 * 최종 Footer
 * - 좌측 사이드바 배경이 footer까지 자연스럽게 이어져 보이도록 처리
 * - footer 상단선(border-t)은 우측 영역에만 적용
 * - 좌측에는 어떤 border도 두지 않음
 * - footer 중앙에는 이용약관 / 개인정보처리방침만 표시
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

  // contents 전용 footer
  return (
    <footer className="bg-transparent">
      <div className="flex">
        {/* 좌측: 사이드바 연장 (border 절대 금지) */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* 우측: footer 본문 + 상단선 */}
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
