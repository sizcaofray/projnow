// components/AppFooter.tsx
"use client";

/**
 * components/AppFooter.tsx
 * ✅ /contents 하위에서는 Footer를 2컬럼으로 분리
 * ✅ "좌측하단 선 중복/두꺼움" 제거:
 *   - 우측 영역 border-l 제거 (border-t와 만나는 코너에서 두꺼워 보이는 현상 방지)
 *   - Footer 자체에 1px 세로선(absolute pseudo line)을 그려 "푸터가 선을 우선 관리"
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
    // ✅ footer 자체에 세로선(1px)을 그립니다. (left-64 = w-64 경계)
    <footer className="border-t border-gray-800 relative after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-64 after:w-px after:bg-gray-800">
      <div className="flex">
        {/* 좌측: 사이드바 폭 유지 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* ✅ 우측: border-l 제거 (코너 두꺼움 방지) */}
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
