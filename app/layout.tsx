// app/layout.tsx
// - 루트 레이아웃
// - ✅ 헤더 + (남은 높이) + 하위 레이아웃이 정확히 계산되도록 구성
// - ✅ children 래퍼를 flex 컨테이너로 만들어, contents 레이아웃이 "뷰포트 남은 높이"를 확실히 채우도록 함
//   -> footer를 항상 브라우저 하단에 붙이기 위한 핵심

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
      <body className="min-h-screen flex flex-col transition-colors">
        {/* ✅ 상단 고정 영역 */}
        <AppHeader />

        {/* ✅ 남은 높이를 채우는 영역(중요): 하위 layout이 flex-1로 동작 가능 */}
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
