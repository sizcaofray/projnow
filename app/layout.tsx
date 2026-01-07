// app/layout.tsx
// - 전역 레이아웃
// ✅ 불필요 스크롤 방지: body를 h-dvh + overflow-hidden + flex-col로 고정
// ✅ Footer: /contents에서는 좌측(사이드바 폭) 분리 적용, 그 외는 기존 형태 유지

import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";
import AppFooter from "@/components/AppFooter"; // ✅ 추가

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

        {/* ✅ 전역 Footer (contents일 때만 좌측 분리) */}
        <AppFooter />
      </body>
    </html>
  );
}
