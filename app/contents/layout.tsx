// app/contents/layout.tsx
// - contents 이하 레이아웃
// ✅ 경계선은 RootLayout에서만 그립니다(중복 제거)
// ✅ 따라서 main의 border-l 제거

import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex">
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
