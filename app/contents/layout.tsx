// app/contents/layout.tsx
// ✅ 수정 목표(로직 변경 없음)
// - 플라이아웃 메뉴가 메인 뒤로 깔리는 문제: aside/nav에 z-index + relative 부여
// - 가로 스크롤 제거: overflow-x-hidden 유지
// - 좌측 메뉴 배경이 footer까지 이어짐: h-full 유지

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full h-full min-h-0 flex overflow-x-hidden">
      {/* ✅ Sidebar: 레이어 최상단 */}
      <aside className="w-64 h-full shrink-0 bg-gradient-to-b from-slate-900 to-slate-800 relative z-[60] overflow-visible">
        {/* ✅ nav도 relative + z-index (플라이아웃이 nav 내부 absolute면 이걸로 해결) */}
        <nav className="h-full p-4 space-y-1 overflow-y-auto overflow-x-hidden relative z-[61]">
          <ContentsMenuLinks />

          <div className="pt-3 mt-3 border-t border-gray-800 space-y-1">
            <AdminOnlyLinks />
          </div>
        </nav>
      </aside>

      {/* ✅ Main: 사이드바보다 아래 레이어 */}
      <main className="flex-1 min-w-0 h-full min-h-0 overflow-auto relative z-0">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
