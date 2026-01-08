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
      <body className="min-h-screen flex flex-col overflow-x-hidden transition-colors">
        <AppHeader />

        {/* ✅ 핵심: 여기를 flex 컨테이너로 만들어야
            /contents/layout.tsx 의 flex-1이 정상 작동합니다. */}
        <div className="flex-1 min-h-0 flex flex-col overflow-x-visible">
          {children}
        </div>

        <AppFooter />
      </body>
    </html>
  );
}
