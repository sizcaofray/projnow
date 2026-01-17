// app/layout.tsx
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
      {/* ✅ 핵심: 헤더/푸터 포함 전체 높이 계산 + 남은 영역 채우기
          - min-h-dvh: 불필요 스크롤 방지에 유리
          - flex flex-col: Header / Content / Footer 레이아웃
          - overflow-x-hidden: 가로 스크롤 방지
      */}
      <body className="min-h-dvh flex flex-col overflow-x-hidden transition-colors">
        <AppHeader />

        {/* ✅ 남은 영역 컨테이너: flex-1 + min-h-0 유지
            - overflow-x-visible 제거(기본값 사용): 불필요한 가로 스크롤 방지
        */}
        <div className="flex-1 min-h-0 flex flex-col">
          {children}
        </div>

        <AppFooter />
      </body>
    </html>
  );
}
