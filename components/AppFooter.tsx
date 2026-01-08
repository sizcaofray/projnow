// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항
 * 1) Footer는 항상 화면 하단
 * 2) /contents 에서는 좌측 메뉴 색상이 footer까지 이어져 보이게
 * 3) 좌측 메뉴(사이드바)는 footer 영역을 "덮지" 않아야 함
 *    -> sidebar는 content 영역에서만 높이를 차지하고, footer는 별도 바닥 영역
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  // 공통 footer 스타일
  const base =
    "shrink-0 h-12 border-t border-gray-800";

  // contents가 아니면 단일 footer
  if (!isContents) {
    return (
      <footer className={`${base} bg-white dark:bg-gray-900`}>
        <div className="h-full px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
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

  // contents면 좌측 64px만 sidebar 톤으로 이어주기
  return (
    <footer className={base}>
      <div className="flex h-full">
        <div className="w-64 bg-slate-800" />
        <div className="flex-1 bg-black flex items-center justify-center gap-6 text-sm text-gray-300">
          <Link href="/contents/terms" className="hover:underline">
            이용약관
          </Link>
          <Link href="/contents/privacy" className="hover:underline">
            개인정보처리방침
          </Link>
        </div>
      </div>
    </footer>
  );
}
