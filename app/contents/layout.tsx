// app/contents/layout.tsx
// contents 이하 페이지들의 공통 프레임 레이아웃 (Server Component)
//
// ✅ 수정 목적
// 1) 전역 헤더(AppHeader)와 contents 헤더 중복 방지: contents 내부 Header 제거 유지
// 2) Footer: 우측 ©/년도/프로그램명 제거
// 3) Footer: 이용약관/개인정보처리방침을 "가운데 정렬" 배치
// 4) Footer는 브라우저 하단에 붙고, 스크롤은 main 영역에서만 발생하도록 유지

import type { ReactNode } from "react";
import Link from "next/link";

import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ✅ Header 제거: 전역 헤더(AppHeader)만 사용 */}

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

        {/* Main (스크롤은 여기만) */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>

      {/* Footer (항상 하단) */}
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
