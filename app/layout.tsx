// app/layout.tsx
// ✅ 요구사항
// 1) Footer는 항상 화면 맨 하단
// 2) 좌측 메뉴 디자인은 Footer를 덮지 않고, Footer까지 자연스럽게 이어져 보이게
// ✅ 부작용 제거
// - 팝업(left-full) 메뉴가 안 보이던 원인: overflow-hidden(가로 잘림) 제거
// - 세로선이 footer까지 내려오던 문제: 세로선은 "본문 영역"에만 적용

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
      {/* ✅ 가로 스크롤은 body에서만 차단 (팝업은 content에서 overflow-x-visible 허용) */}
      <body className="h-dvh flex flex-col overflow-x-hidden overflow-y-hidden transition-colors">
        <AppHeader />

        {/* ✅ 여기부터가 핵심:
            - flex-col로 본문/푸터를 분리
            - 본문은 flex-1로 스크롤/레이아웃 담당
            - Footer는 항상 아래에 붙음 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* ✅ 본문 영역 (세로선은 여기서만 그려서 footer에는 내려오지 않게) */}
          <div className="flex-1 min-h-0 relative overflow-y-hidden overflow-x-visible after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64 after:w-px after:bg-gray-800 after:pointer-events-none">
            {children}
          </div>

          {/* ✅ Footer는 본문 밖에 위치 -> 항상 맨 아래 */}
          <AppFooter />
        </div>
      </body>
    </html>
  );
}
