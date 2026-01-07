// app/contents/layout.tsx
// ✔ 메뉴 hover 방식 유지
// ✔ 플라이아웃 잘림 방지
// ✔ 하단 가로 스크롤 제거
// ✔ 불필요한 z-index 전부 제거

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // 가로 스크롤 방지
    <div className="w-full h-full min-h-0 flex overflow-x-hidden">
      {/* Sidebar */}
      <aside className="w-64 h-full shrink-0 bg-gradient-to-b from-slate-900 to-slate-800 relative overflow-visible">
        {/* 핵심: 세로만 스크롤, 가로는 숨김 */}
        <nav className="h-full p-4 space-y-1 overflow-y-auto overflow-x-hidden">
          <ContentsMenuLinks />

          <div className="pt-3 mt-3 border-t border-gray-800 space-y-1">
            <AdminOnlyLinks />
          </div>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 h-full min-h-0 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
