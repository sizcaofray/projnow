// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항
 * 1) footer는 화면 하단에 붙어야 함 -> (이건 app/layout.tsx에서 flex-col로 해결)
 * 2) 좌측 메뉴 디자인이 footer까지 이어져 보이되, footer를 덮지 않아야 함
 * 3) footer 영역에는 세로선이 절대 생기면 안 됨 (border-l 금지)
 *
 * ✅ 해결 포인트
 * - /contents 하위에서 footer를 2컬럼으로 구성
 * - 좌측 64px 영역은 "사이드바 하단색(bg-slate-800)"으로 고정 (겹침/이중톤 방지)
 * - 우측 영역은 border-l 제거 (세로선 0)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  if (!isContents) {
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

  return (
    <footer className="border-t border-gray-800">
      <div className="flex">
        {/* ✅ 좌측: 사이드바 하단색과 동일 (겹쳐보임 방지, 이어지는 느낌 유지) */}
        <div className="w-64 bg-slate-800" />

        {/* ✅ 우측: 세로선 금지 -> border-l 없음 */}
        <div className="flex-1 bg-white dark:bg-gray-900">
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
