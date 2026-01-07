// app/contents/layout.tsx
// ✅ 실제 원인 수정: nav의 overflow-x-hidden 때문에 left-full 팝업이 잘려서 안 보임
// ✅ hover/팝업 로직(ContentsMenuLinks.tsx)은 변경하지 않음
// ✅ 가로 스크롤은 루트에서 overflow-x-hidden으로 그대로 방지

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // 가로 스크롤 방지(루트에서만)
    <div className="w-full h-full min-h-0 flex overflow-x-hidden">
      {/* Sidebar */}
      <aside className="w-64 h-full shrink-0 bg-gradient-to-b from-slate-900 to-slate-800 relative overflow-visible">
        {/* ✅ 세로만 스크롤
            ❌ overflow-x-hidden 제거: left-full 팝업이 nav 밖으로 나가야 보임 */}
        <nav className="h-full p-4 space-y-1 overflow-y-auto">
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
