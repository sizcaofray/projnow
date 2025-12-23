// app/contents/layout.tsx
// contents 이하 페이지들의 공통 프레임 레이아웃 (Server Component)
// 요청사항 반영:
// 1) 헤더 우측의 로그인/이메일/로그아웃 제거 → "구독" 버튼 1개만 노출
// 2) 좌측 메뉴는 샘플 메뉴명만 노출, "Server (Admin)" 대신 "Menu Setting" 메뉴로 교체
//    - Menu Setting 클릭 시 실제 메뉴 구성 화면(/contents/menu-setting)으로 이동

import type { ReactNode } from "react";
import Link from "next/link";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* =========================
       * Header
       * ========================= */}
      <header className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur">
        <div className="h-14 px-4 flex items-center justify-between">
          {/* 좌측: 서비스명 */}
          <div className="flex items-center gap-3">
            <Link href="/contents" className="font-bold text-lg">
              projnow
            </Link>
          </div>

          {/* 우측: 구독 버튼 1개만 */}
          <div className="flex items-center justify-end">
            {/* TODO: 다음 단계에서 구독 팝업/결제 페이지로 연결 */}
            <Link
              href="/contents/subscribe"
              className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-800 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              title="구독"
            >
              구독
            </Link>
          </div>
        </div>
      </header>

      {/* =========================
       * Body: Sidebar + Main
       * ========================= */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <nav className="p-4 space-y-1">
            {/* 샘플 메뉴명(임시) */}
            <Link
              href="/contents/sample-1"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Sample Menu 1
            </Link>

            <Link
              href="/contents/sample-2"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Sample Menu 2
            </Link>

            <Link
              href="/contents/sample-3"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Sample Menu 3
            </Link>

            {/* 기존 Server(Admin) 대신 Menu Setting */}
            <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
              <Link
                href="/contents/menu-setting"
                className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Menu Setting
              </Link>
            </div>
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* =========================
       * Footer (향후 약관/개인정보 링크 예정)
       * ========================= */}
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
