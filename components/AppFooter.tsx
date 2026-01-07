// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항
 * 1) 좌측 사이드바 배경이 footer까지 자연스럽게 이어져 보이기 (색상/그라데이션 동일)
 * 2) footer에는 세로선 없음 (border-l / pseudo-line 금지)
 * 3) footer가 겹침/가림 없이 정상 레이어로 보이기 (z-index)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  if (!isContents) {
    return (
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 relative z-[80]">
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
    <footer className="bg-transparent relative z-[80]">
      <div className="flex">
        {/* ✅ 좌측: sidebar와 완전 동일한 배경 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* ✅ 우측: footer 내용 (세로선 없음), 상단선은 우측만 */}
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
