// app/contents/layout.tsx
import type { ReactNode } from "react";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ 핵심: 상위( app/layout.tsx )가 flex 컨테이너가 됐으니
    // 여기서는 "h-full"로 높이를 확정해서 아래까지 꽉 차게 만듭니다.
    <div className="h-full min-h-0 flex flex-col">
      <div
        className="
          flex-1 min-h-0 flex items-stretch relative overflow-x-visible
          after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64
          after:w-px after:bg-gray-800 after:pointer-events-none
        "
      >
        <aside className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col min-h-0 relative z-40">
          <nav className="p-4 space-y-1 flex-1 min-h-0">
            <ContentsMenuLinks />
            <div className="pt-3 mt-3 border-t border-gray-800 space-y-1">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        <main className="flex-1 min-w-0 min-h-0 overflow-auto relative z-0">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
