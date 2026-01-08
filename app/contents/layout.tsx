// app/contents/layout.tsx
// ✅ 요구사항
// 1) /contents 에서만 좌측 메뉴(사이드바) 표시
// 2) 좌측 메뉴 디자인은 "푸터 영역을 넘지 않음" -> Sidebar는 content 영역에만 존재
// 3) /contents에서만 세로 경계선 표시(커버페이지에 나오면 안 됨)
// 4) Footer는 RootLayout에서 1번만 렌더(중복 제거)

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ RootLayout의 content 영역을 꽉 채우는 구조
    <div className="flex-1 min-h-0 flex relative overflow-x-visible
                    after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64
                    after:w-px after:bg-gray-800 after:pointer-events-none">
      {/* Sidebar */}
      <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 relative z-[600]">
        <nav className="p-4 space-y-1">
          <ContentsMenuLinks />

          <div className="pt-3 mt-3 border-t border-gray-800 space-y-1">
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
