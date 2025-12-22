// app/layout.tsx
// - 전체 앱 공통 레이아웃
// - 다크모드는 OS 설정 자동 추종
// - body에 강제 배경색 미지정

import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Datalign | 업무 프로세스 지원툴",
  description: "임상/데이터 업무 프로세스를 지원하는 Datalign",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen transition-colors">
        {children}
      </body>
    </html>
  );
}
