// app/contents/layout.tsx
// ✅ 목표: 좌측 사이드바 배경이 "푸터 윗선까지" 쭉 내려가 빈 공간이 보이지 않게
// ✅ 핵심: 부모/자식 flex 높이 전파(min-h-0, flex-1) + items-stretch 강제

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ RootLayout의 content 영역을 꽉 채우도록(세로로 늘어남)
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ✅ 본문(사이드바 + 메인) 영역: 남은 높이를 전부 차지 */}
      <div
        className="
          flex-1 min-h-0 flex items-stretch relative overflow-x-visible
          after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64
          after:w-px after:bg-gray-800 after:pointer-events-none
        "
      >
        {/* ✅ Sidebar: 반드시 세로로 stretch 되도록 flex-col + min-h-0 */}
        <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col min-h-0 relative z-[600]">
          {/* ✅ nav가 flex-1을 가져야 사이드바 배경 높이가 끝까지 유지됨 */}
          <nav className="p-4 space-y-1 flex-1 min-h-0">
            <ContentsMenuLinks />

            <div className="pt-3 mt-3 border-t border-gray-800 space-y-1">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        {/* ✅ Main: 스크롤은 여기만 */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto relative z-0">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
