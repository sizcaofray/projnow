// app/layout.tsx
// - App Router 루트 레이아웃
// - 모든 페이지에 공통 헤더(AppHeader) 표시
// - ✅ 모든 페이지(커버 포함) 하단 Footer 표시 (이용약관/개인정보처리방침만 중앙 배치)
// - 다크모드: OS 설정 자동 추종(강제 지정 없음)

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
      {/* ✅ footer를 하단에 고정하려면 body를 flex-col 구조로 구성 */}
      <body className="min-h-screen flex flex-col transition-colors">
        {/* ✅ 전역 헤더 */}
        <AppHeader />

        {/* ✅ 페이지 본문 영역 (남은 공간을 채움) */}
        <div className="flex-1 min-h-0">{children}</div>

        {/* ✅ 전역 Footer: 가운데 정렬(요구사항) */}
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
