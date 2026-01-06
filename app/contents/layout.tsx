// app/contents/layout.tsx
// contents 이하 페이지들의 공통 프레임 레이아웃 (Server Component)
//
// ✅ 변경 요약
// 1) 헤더 왼쪽 끝: 서비스명 Projnow
// 2) 헤더 오른쪽 끝: TopRightAuthButton(구독 버튼 + 로그인 이메일 + 로그인/로그아웃)
// 3) 기존 "구독 버튼만 있는 라인" 제거 (중복 제거)
// 4) 불필요한 위아래 스크롤 방지: flex/min-h-0/overflow 설정 유지
// 5) footer는 브라우저 하단에 붙도록 flex-col 구조 유지

import type { ReactNode } from "react";
import Link from "next/link";

import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";
import TopRightAuthButton from "@/components/TopRightAuthButton";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur">
        <div className="h-14 px-4 flex items-center justify-between">
          {/* ✅ 좌측: 서비스명(좌측 끝) */}
          <Link
            href="/contents"
            className="font-semibold text-gray-900 dark:text-gray-100"
            title="Projnow"
          >
            Projnow
          </Link>

          {/* ✅ 우측: 구독(로그인 조건) + 이메일 + 로그인/로그아웃 (우측 끝) */}
          <TopRightAuthButton />
        </div>
      </header>

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

      {/* Footer (항상 하단) */}
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
