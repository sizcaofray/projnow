// app/contents/layout.tsx
// ✅ 목표
// - 좌측 사이드바 배경이 푸터 윗선까지 쭉 내려가도록(빈 공간 제거)
// - 우측 Main 영역이 다크/라이트 모드에 따라 “강제 흰색/강제 검정”으로 튀지 않도록
//   → Main은 부모 배경/글자색을 그대로 상속(bg-transparent + text-inherit)
// - 불필요한 구조 변경 없이 className 최소 수정

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
          after:w-px after:bg-gray-300 after:pointer-events-none
        "
      >
        {/* ✅ Sidebar: 어두운 배경 + 밝은 글자 (모드 무관, 배경 기준 대비) */}
        <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 flex flex-col min-h-0 relative z-40">
          {/* ✅ nav가 flex-1을 가져야 사이드바 배경 높이가 끝까지 유지됨 */}
          <nav className="p-4 space-y-1 flex-1 min-h-0">
            <ContentsMenuLinks />

            <div className="pt-3 mt-3 border-t border-slate-700 space-y-1">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        {/* ✅ Main: 강제 배경/글자색 제거 → 부모(페이지)에서 결정된 색을 그대로 상속 */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto relative z-0 bg-transparent text-inherit">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
