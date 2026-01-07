// app/contents/layout.tsx
// ✅ 요구사항:
// 1) 좌측 메뉴 배경이 footer까지 끊김 없이 이어져 보이게
//    - 레이아웃 루트를 h-full로 고정
//    - aside를 h-full로 강제
//    - 메뉴가 길면 aside 내부만 스크롤 가능하게

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ 핵심: 부모(content 영역)가 준 높이를 "끝까지" 채움
    <div className="w-full h-full min-h-0 flex">
      {/* Sidebar */}
      <aside className="w-64 h-full shrink-0 bg-gradient-to-b from-slate-900 to-slate-800">
        {/* ✅ 사이드바 내부만 스크롤 */}
        <nav className="h-full p-4 space-y-1 overflow-auto">
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
