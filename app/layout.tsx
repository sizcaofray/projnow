// app/layout.tsx
// ✅ 요구사항
// 1) Footer는 항상 화면 맨 하단
// 2) 좌측 메뉴(사이드바) 디자인은 Footer를 덮지 않고 Footer까지 자연스럽게 이어져 보이게
// 3) 팝업(left-full) 메뉴가 잘리지 않게 (가로 overflow 잘림 방지)
// 4) 불필요한 스크롤(특히 body overflow-y-hidden으로 인한 문제) 방지
// 5) 세로선은 "본문 영역"에만 적용해서 footer까지 내려오지 않게

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
      {/* ✅ body는 화면 높이를 차지하며, 레이아웃은 flex-col로 Header / Content / Footer 분리 */}
      {/* ✅ overflow-y-hidden을 강제로 막아버리면 내부 main 스크롤/팝업 동작이 꼬일 수 있어 제거 */}
      {/* ✅ 가로만 차단해서 불필요한 가로 스크롤을 방지 */}
      <body className="min-h-screen flex flex-col overflow-x-hidden transition-colors">
        {/* ✅ Header는 상단 고정(레이아웃 상단) */}
        <AppHeader />

        {/* ✅ Content 영역: 남은 높이를 모두 차지 */}
        {/* ✅ min-h-0 필수: 내부(특히 /contents layout의 main overflow-auto)가 정상 스크롤 되도록 */}
        {/* ✅ overflow-x-visible: left-full 팝업 메뉴가 잘리지 않게 */}
        {/* ✅ 세로선(after)은 여기에서만 렌더링 -> footer에는 절대 내려오지 않음 */}
        <div className="flex-1 min-h-0 relative overflow-x-visible after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64 after:w-px after:bg-gray-800 after:pointer-events-none">
          {children}
        </div>

        {/* ✅ Footer는 Content 영역 밖(Body 직속) -> 항상 화면 맨 아래 */}
        <AppFooter />
      </body>
    </html>
  );
}
