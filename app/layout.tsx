// app/layout.tsx
// - 전역 레이아웃
// ✅ 불필요 스크롤 방지: body를 h-dvh + overflow-hidden + flex-col로 고정
// ✅ Footer: 이용약관/개인정보처리방침만 "가운데 정렬" (추가 텍스트 없음)

import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "ProjNow | 업무 프로세스 지원툴",
  description: "업무 프로세스를 더 빠르게 정리하고 실행하는 ProjNow",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      {/* ✅ 전체 스크롤을 막고, 스크롤은 내부(main)에서만 발생하도록 */}
      <body className="h-dvh flex flex-col overflow-hidden transition-colors">
        {/* ✅ 전역 헤더 */}
        <AppHeader />

        {/* ✅ 본문(남은 높이 전부) */}
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>

        {/* ✅ 전역 Footer: 링크 2개만 가운데 */}
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
      </body>
    </html>
  );
}
