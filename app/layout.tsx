// app/layout.tsx
// ✅ 요구사항 정리
// 1) 모든 페이지에서 Footer는 하단에 1개만 표시
// 2) 첫 커버페이지에는 좌측 메뉴줄/세로선이 나오면 안 됨 (contents 전용 처리로 이동)
// 3) 불필요한 스크롤/잘림 방지

import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";
import AppFooter from "@/components/AppFooter";

export const metadata: Metadata = {
  title: "ProjNow",
  description: "업무 프로세스를 정리하고 실행을 지원하는 서비스",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      {/* ✅ 세로 스크롤 막지 말 것(푸터 잘림 방지) */}
      {/* ✅ 가로만 차단 */}
      <body className="min-h-screen flex flex-col overflow-x-hidden transition-colors">
        {/* 상단 헤더 */}
        <AppHeader />

        {/* ✅ 컨텐츠 영역(남은 높이) */}
        {/* ✅ 여기에는 세로선(after) 절대 넣지 않음 -> 커버페이지에 메뉴줄 생기는 문제 제거 */}
        <div className="flex-1 min-h-0 overflow-x-visible">
          {children}
        </div>

        {/* ✅ Footer는 무조건 여기서 1번만 */}
        <AppFooter />
      </body>
    </html>
  );
}
