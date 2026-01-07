// components/AppFooter.tsx
"use client";

/**
 * components/AppFooter.tsx
 * - 전역 Footer
 * ✅ /contents 하위에서는 Footer를 2컬럼으로 분리:
 *   - 좌측(사이드바 폭 260px): Sidebar 배경이 footer까지 이어지는 것처럼 처리
 *   - 우측: 이용약관/개인정보처리방침 링크 가운데 정렬
 * ✅ 선(테두리) 중복 제거:
 *   - 좌측 더미영역의 border-r 제거
 *   - 우측 영역에 border-l을 주어 "푸터가 경계선을 우선"하도록 정리
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();

  // ✅ /contents 및 하위 경로에서만 "좌측 사이드바 영역 분리 Footer" 적용
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  if (!isContents) {
    // ✅ 기존 Footer 형태(전체 폭 가운데)
    return (
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
    );
  }

  // ✅ /contents 전용 Footer (좌측 260px은 Sidebar 느낌 유지)
  return (
    <footer className="border-t border-gray-800">
      <div className="flex">
        {/* ✅ 좌측: Sidebar 폭(260px/ w-64) 동일 영역
            - ❗중복선 제거를 위해 border-r 제거 (경계선은 우측 영역의 border-l이 담당) */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* ✅ 우측: 경계선은 Footer가 우선으로 그리도록 border-l 부여 */}
        <div className="flex-1 bg-white dark:bg-gray-900 border-l border-gray-800">
          <div className="h-12 px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
            <Link href="/contents/terms" className="hover:underline">
              이용약관
            </Link>
            <Link href="/contents/privacy" className="hover:underline">
              개인정보처리방침
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
