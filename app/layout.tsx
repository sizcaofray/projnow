// app/layout.tsx
import "./globals.css";
import { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col overflow-x-hidden">
        <AppHeader />

        {/* 🔴 Footer를 여기서 관리하지 않음 */}
        <div className="flex-1 min-h-0">
          {children}
        </div>
      </body>
    </html>
  );
}
