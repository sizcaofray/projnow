// app/contents/layout.tsx
// ✅ 목표
// 1) 좌측 사이드바 배경이 푸터 윗선까지 쭉 내려가도록(빈 공간 제거)
// 2) 다크/라이트모드에 상관없이 /contents 프레임 색이 자연스럽게 동일하게 보이도록(모드 비의존)
// 3) 기존 마크업 구조는 유지, 클래스만 최소 수정

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ /contents 프레임 배경을 고정해서 라이트모드에서도 하얀 바닥이 튀지 않게 함
    <div className="flex-1 min-h-0 flex flex-col bg-black text-gray-200">
      {/* ✅ 본문(사이드바 + 메인) 영역: 남은 높이를 전부 차지 */}
      <div
        className="
          flex-1 min-h-0 flex items-stretch relative overflow-x-visible
          after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64
          after:w-px after:bg-gray-800 after:pointer-events-none
        "
      >
        {/* ✅ Sidebar: min-h-0 추가(높이 전파) */}
        <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col min-h-0 relative z-40">
          {/* ✅ nav가 flex-1을 가져야 사이드바가 푸터 윗선까지 ‘끝까지’ 늘어남 */}
          <nav className="p-4 space-y-1 flex-1 min-h-0">
            <ContentsMenuLinks />

            <div className="pt-3 mt-3 border-t border-gray-800 space-y-1">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        {/* ✅ Main: 배경을 고정해서 라이트모드에서도 동일 톤 유지 */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto relative z-0 bg-black">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
