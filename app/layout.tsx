// app/layout.tsx
// - 전역 레이아웃
// ✅ 경계선(세로 1px)을 RootLayout에서 한 번만 그려서 중복 제거
// ✅ footer까지 선이 끊김 없이 유지됨

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
        <AppHeader />

        {/* ✅ 본문 + Footer를 한 컨테이너로 묶고, 여기서 세로 경계선 1px을 '딱 한 번'만 그림 */}
        <div className="flex-1 min-h-0 overflow-hidden relative after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64 after:w-px after:bg-gray-800 after:pointer-events-none">
          {children}
          <AppFooter />
        </div>
      </body>
    </html>
  );
}
