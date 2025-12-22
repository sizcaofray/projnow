// app/layout.tsx
// - App Router 루트 레이아웃
// - 모든 페이지에 공통 헤더(AppHeader) 표시
// - 다크모드: OS 설정 자동 추종(강제 지정 없음)

import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "ProjNow | 업무 프로세스 지원툴",
  description: "업무 프로세스를 더 빠르게 정리하고 실행하는 ProjNow",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen transition-colors">
        {/* ✅ 전역 헤더: 모든 페이지에서 로그인 버튼 사용 가능 */}
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
