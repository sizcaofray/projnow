// app/contents/layout.tsx
// - contents 이하 레이아웃
// ✅ 전역(AppHeader/Footer) 사용하므로 contents 내부 Header/Footer 제거
// ✅ 불필요 스크롤 방지: min-h-screen 제거, flex-1/min-h-0 기반으로만 구성
// ✅ 스크롤은 main 영역에서만 발생

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 relative z-[600]">
        <nav className="p-4 space-y-1">
          <ContentsMenuLinks />

          <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-800 space-y-1">
            <AdminOnlyLinks />
          </div>
        </nav>
      </aside>

      {/* Main (스크롤은 여기만) */}
      <main className="flex-1 min-w-0 min-h-0 overflow-auto relative z-0">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
