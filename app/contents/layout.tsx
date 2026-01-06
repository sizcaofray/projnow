// app/contents/layout.tsx
// contents 이하 페이지들의 공통 프레임 레이아웃 (Server Component)
//
// ✅ 변경 목적(요청 반영)
// 1) 전역(app/layout.tsx)에서 Footer를 제공하므로, contents에서 Footer 중복 제거
// 2) 전역 헤더(AppHeader)를 사용하므로, contents에서 Header 중복 제거
// 3) 스크롤은 main 영역에서만 발생하도록 min-h-0/overflow 구조 유지

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ 전역 레이아웃이 flex-col 구조이므로 여기서는 남은 공간만 채우도록 구성
    <div className="flex-1 min-h-0 flex">
      {/* Sidebar (메뉴가 메인 컨텐츠보다 위로 보이도록 z-index 유지) */}
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
