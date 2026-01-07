// app/layout.tsx
// - 전역 레이아웃
// ✅ 팝업(flyout) 메뉴가 잘리는 원인: 본문 컨테이너 overflow-hidden
// ✅ 해결: x축은 visible 허용, 전체 페이지 가로스크롤은 body에서만 차단
// ✅ 세로 경계선은 footer 영역에는 내려오지 않게 bottom을 footer 높이(h-12=48px)만큼 올림

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
      {/* ✅ 가로 스크롤은 body에서만 막고, (팝업이 잘리게 만드는) overflow-hidden은 금지 */}
      <body className="h-dvh flex flex-col overflow-x-hidden overflow-y-hidden transition-colors">
        <AppHeader />

        {/* ✅ 본문+Footer 컨테이너: x축 overflow는 visible (팝업 잘림 방지)
            ✅ 세로선은 footer(h-12) 영역 제외: after:bottom-12 */}
        <div className="flex-1 min-h-0 relative overflow-y-hidden overflow-x-visible after:content-[''] after:absolute after:top-0 after:bottom-12 after:left-64 after:w-px after:bg-gray-800 after:pointer-events-none">
          {children}
          <AppFooter />
        </div>
      </body>
    </html>
  );
}
