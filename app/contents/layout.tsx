// app/contents/layout.tsx
import { ReactNode } from "react";
import AppFooter from "@/components/AppFooter";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      {/* ====== 본문 영역 ====== */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar */}
        <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800">
          <nav className="p-4 space-y-1">
            <ContentsMenuLinks />
            <div className="pt-3 mt-3 border-t border-gray-800">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 min-h-0 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* ====== Footer (Sidebar와 같은 레벨) ====== */}
      <AppFooter />
    </div>
  );
}
