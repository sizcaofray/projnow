// app/contents/layout.tsx
// contents 이하 페이지들의 공통 프레임 레이아웃
// Header(상단) + Sidebar(좌측) + Main(children) + Footer(하단)
// 서비스명: projnow

import type { ReactNode } from "react";
import Link from "next/link";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // 전체 화면을 세로 플렉스 구조로 분리
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

          {/* 우측: 로그인 / 메일 / 로그아웃 (다음 단계에서 Auth 연동) */}
          <div className="flex items-center gap-2 justify-end">
            <Link
              href="/"
              className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-800 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              로그인
            </Link>

            <div className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200">
              mail@example.com
            </div>

            <button
              type="button"
              className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-800 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => alert("로그아웃 로직은 다음 단계에서 연결됩니다.")}
            >
              로그아웃
            </button>
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
            <Link
              href="/contents/convert"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Data Convert
            </Link>

            <Link
              href="/contents/compare"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Compare
            </Link>

            <Link
              href="/contents/data-review"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Data Review
            </Link>

            <Link
              href="/contents/mapping-template"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Mapping Template
            </Link>

            <Link
              href="/contents/canvas"
              className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Canvas
            </Link>

            {/* 관리자 메뉴 (권한 분기는 이후 단계) */}
            <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
              <Link
                href="/contents/server"
                className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Server (Admin)
              </Link>
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* =========================
       * Footer
       * ========================= */}
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="h-12 px-4 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="hover:underline"
              onClick={() => alert("이용약관 페이지는 다음 단계에서 연결됩니다.")}
            >
              이용약관
            </button>
            <button
              type="button"
              className="hover:underline"
              onClick={() => alert("개인정보처리방침 페이지는 다음 단계에서 연결됩니다.")}
            >
              개인정보처리방침
            </button>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            © {new Date().getFullYear()} projnow
          </div>
        </div>
      </footer>
    </div>
  );
}
