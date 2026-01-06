// app/contents/layout.tsx
// ✅ 목적
// - 메뉴(사이드바/오버패널)가 메인 표에 가려지는 문제 해결: sidebar z-index 상향
// - footer: 이용약관/개인정보처리방침만 중앙 배치 (불필요한 내용 제거)
// - 스크롤은 main 영역에서만 생기도록 유지

import type { ReactNode } from "react";
import Link from "next/link";

import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar (✅ 메인보다 항상 위) */}
        <aside className="w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 relative z-[600]">
          <nav className="p-4 space-y-1">
            <ContentsMenuLinks />

            <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-800 space-y-1">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        {/* Main (✅ z 낮게) */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto relative z-0">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* Footer (요구사항 그대로: 중앙) */}
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="h-12 px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/contents/terms" className="hover:underline">
            이용약관
          </Link>
          <Link href="/contents/privacy" className="hover:underline">
            개인정보처리방침
          </Link>
        </div>
      </footer>
    </div>
  );
}
