// app/contents/layout.tsx
// - contents 이하 페이지 공통 레이아웃
// - ✅ footer가 브라우저 하단에 붙도록: 루트 컨테이너를 flex-1 + flex-col + min-h-0로 구성
// - ✅ 메인 영역만 스크롤(overflow-auto), footer는 항상 하단 고정

import type { ReactNode } from "react";
import Link from "next/link";
import AdminOnlyLinks from "@/components/AdminOnlyLinks";
import ContentsMenuLinks from "@/components/ContentsMenuLinks";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return (
    // ✅ RootLayout의 children 래퍼가 flex 컨테이너이므로,
    //    여기서 flex-1을 주면 "남은 화면 높이"를 꽉 채움 -> footer 하단 고정
    <div className="flex-1 min-h-0 flex flex-col">
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

        {/* Main (스크롤은 여기만 발생) */}
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
