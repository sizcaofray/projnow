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
    // ✅ RootLayout의 children 래퍼는 flex 컨테이너가 아니므로
    //    이 레이아웃은 스스로 header~footer 사이 높이를 "꽉" 채워야 합니다.
    //    (flex-1은 부모가 flex일 때만 동작)
    // ✅ 스크롤은 main에서만 발생하도록 루트는 overflow-hidden
    <div className="h-full min-h-0 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 h-full border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 relative z-[600]">
        {/* ✅ 메뉴가 길어질 수 있으니 Sidebar 자체도 필요 시 스크롤 가능 */}
        <nav className="h-full p-4 space-y-1 overflow-auto">
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
