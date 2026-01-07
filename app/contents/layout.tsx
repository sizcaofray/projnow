// app/contents/layout.tsx
// ✅ 요구사항(로직 변경 없이 CSS만):
// 1) 좌측 메뉴 배경이 footer까지 이어짐 (h-full)
// 2) hover 플라이아웃 메뉴가 overflow에 잘리지 않게 (overflow-x-visible)
// 3) 하단 가로 스크롤 제거 (부모 overflow-x-hidden + nav overflow-x-hidden)

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ 가로 스크롤 방지 (플라이아웃은 aside 안에서 visible로 보이게 유지)
    <div className="w-full h-full min-h-0 flex overflow-x-hidden">
      {/* Sidebar */}
      <aside className="w-64 h-full shrink-0 bg-gradient-to-b from-slate-900 to-slate-800 relative overflow-visible">
        {/* ✅ 세로만 스크롤, 가로는 숨김(가로 스크롤바 제거)
            ✅ 플라이아웃은 nav가 아니라 'absolute 요소'라면 부모(aside)가 overflow-visible이면 잘리지 않음 */}
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
