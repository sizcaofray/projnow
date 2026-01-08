// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항
 * 1) Footer는 항상 화면 하단 (RootLayout이 flex-col + Footer를 body 직속으로 보장)
 * 2) /contents 하위에서는 좌측 메뉴 색상이 Footer까지 이어져 보이게
 * 3) Footer에 세로선이 생기면 안 됨 (border-l 금지)
 * 4) 불필요한 요소(우측 끝 연도/프로그램명 등) 추가 금지 -> 링크 2개만 중앙 배치
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();

  // ✅ contents 영역 판단
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  // ✅ 공통 Footer 높이(디자인 일관성)
  const baseFooterClass =
    "shrink-0 border-t border-gray-200 dark:border-gray-800";

  // ✅ contents가 아닌 경우: 단일 바 형태
  if (!isContents) {
    return (
      <footer className={`${baseFooterClass} bg-white dark:bg-gray-900`}>
        <div className="h-12 px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/contents/terms" className="hover:underline">
            이용약관
          </Link>
          <Link href="/contents/privacy" className="hover:underline">
            개인정보처리방침
          </Link>
        </div>
      </footer>
    );
  }

  // ✅ contents인 경우: 좌측(사이드바 영역) + 우측(본문 영역) 2컬럼 footer
  return (
    <footer className="shrink-0 border-t border-gray-800">
      <div className="flex h-12">
        {/* ✅ 좌측: 사이드바 색상과 동일하게 이어지도록 */}
        <div className="w-64 bg-slate-800" />

        {/* ✅ 우측: 세로선 금지(border-l 없음), 중앙 정렬 */}
        <div className="flex-1 bg-white dark:bg-gray-900 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/contents/terms" className="hover:underline">
            이용약관
          </Link>
          <Link href="/contents/privacy" className="hover:underline">
            개인정보처리방침
          </Link>
        </div>
      </div>
    </footer>
  );
}
