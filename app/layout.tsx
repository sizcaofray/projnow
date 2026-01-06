// app/layout.tsx
// - 루트 레이아웃
// - ✅ 헤더 + children을 flex-col로 구성하여 불필요한 body 스크롤 방지
// - ✅ children이 남은 높이를 채우도록 flex-1/min-h-0 적용

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
      {/* ✅ body를 flex-col로: 헤더 높이를 제외한 나머지를 children이 차지 */}
      <body className="min-h-screen flex flex-col transition-colors">
        <AppHeader />

        {/* ✅ 남은 공간을 children이 채우도록 */}
        <div className="flex-1 min-h-0">{children}</div>
      </body>
    </html>
  );
}
