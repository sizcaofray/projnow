// app/layout.tsx
// ✅ 해결 목표
// 1) 첫 접속 페이지에서도 Footer가 "항상" 보이게(잘림 방지)
// 2) /contents에서도 Footer가 창 하단에 붙게
// 3) 좌측 메뉴는 Footer 영역을 넘지 않게(콘텐츠 영역에서만 높이 차지)
// 4) left-full 팝업 메뉴가 가로 overflow 때문에 잘리지 않게

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
      {/* ✅ 세로 스크롤 막지 말 것(푸터 잘림 원인) */}
      {/* ✅ 가로만 차단 */}
      <body className="min-h-screen flex flex-col overflow-x-hidden transition-colors">
        {/* Header */}
        <AppHeader />

        {/* Content: 남은 높이 전부 */}
        {/* ✅ min-h-0: 내부(main overflow-auto)가 정상 동작하도록 */}
        {/* ✅ overflow-x-visible: flyout(왼쪽메뉴 팝업) 잘림 방지 */}
        {/* ✅ 세로선(after)은 content에서만(footer에 내려오지 않음) */}
        <div className="flex-1 min-h-0 relative overflow-x-visible after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64 after:w-px after:bg-gray-800 after:pointer-events-none">
          {children}
        </div>

        {/* Footer: 항상 하단 */}
        <AppFooter />
      </body>
    </html>
  );
}
