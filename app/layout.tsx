// app/layout.tsx
// - 전역 레이아웃
// ✅ (중요) 세로 pseudo-line 제거
// ✅ Footer는 body 맨 아래로 분리 (content wrapper 안에 넣지 않음)

import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";
import AppFooter from "@/components/AppFooter";

export const metadata: Metadata = {
  title: "ProjNow | 업무 프로세스 지원툴",
  description: "업무 프로세스를 더 빠르게 정리하고 실행하는 ProjNow",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="h-dvh flex flex-col overflow-hidden transition-colors">
        {/* Header */}
        <AppHeader />

        {/* ✅ 콘텐츠 영역만 flex-1 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {children}
        </div>

        {/* ✅ Footer는 body 마지막 */}
        <AppFooter />
      </body>
    </html>
  );
}
