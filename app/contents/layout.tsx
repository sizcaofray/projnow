// app/contents/layout.tsx
// contents 이하 페이지들의 공통 프레임 레이아웃 (Server Component)
// ✅ 수정사항
// 1) 상단 "구독 버튼만 있는 sticky header" 제거
// 2) RootLayout(AppHeader)에 구독/로그인 UI가 있으므로 중복 제거
// 3) min-h-screen 제거 + flex/min-h-0 정리로 불필요한 스크롤 방지

import type { ReactNode } from "react";
import Link from "next/link";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ RootLayout의 children 영역이 flex-1이므로, 여기서는 h-full/min-h-0로 맞춤
    <div className="h-full min-h-0 flex flex-col">
      {/* ✅ (2) Header(구독 라인) 제거 */}

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <nav className="p-4 space-y-1">
            {/* ✅ Firestore menus 실시간 반영 메뉴 */}
            <ContentsMenuLinks />

            {/* ✅ 관리 메뉴(관리자만 노출) */}
            <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-800 space-y-1">
              <AdminOnlyLinks />
            </div>
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="h-12 px-4 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
          <div className="flex items-center gap-4">
            <Link href="/contents/terms" className="hover:underline">
              이용약관
            </Link>
            <Link href="/contents/privacy" className="hover:underline">
              개인정보처리방침
            </Link>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            © {new Date().getFullYear()} projnow
          </div>
        </div>
      </footer>
    </div>
  );
}
