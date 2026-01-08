import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className="
          flex-1 min-h-0 flex items-stretch relative overflow-x-visible
          after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64
          after:w-px after:bg-gray-300 after:pointer-events-none
        "
      >
        {/* ✅ Sidebar: 어두운 배경 + 밝은 글자 (모드 무관) */}
        <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 flex flex-col min-h-0 relative z-40">
          <nav className="p-4 space-y-1 flex-1 min-h-0">
            <ContentsMenuLinks />
            <div className="pt-3 mt-3 border-t border-slate-700 space-y-1">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        {/* ✅ Main: 밝은 배경 + 어두운 글자 (모드 무관) */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto relative z-0 bg-white text-slate-900">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
