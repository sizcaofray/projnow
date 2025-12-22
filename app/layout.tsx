// app/layout.tsx
// - 전체 앱 공통 레이아웃
// - 다크모드는 OS 설정을 자동 추종 (globals.css의 dark 클래스 기반)
// - body에 강제 색 지정하지 않음

import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Datalign | 업무 프로세스 지원툴",
  description: "임상/데이터 업무 프로세스를 지원하는 Datalign",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen transition-colors">{children}</body>
    </html>
  );
}
