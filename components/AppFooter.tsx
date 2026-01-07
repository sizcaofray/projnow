// components/AppFooter.tsx
"use client";

/**
 * components/AppFooter.tsx
 * ✅ /contents 하위에서는 Footer를 2컬럼으로 분리
 * ✅ 하단 좌측(경계선) 두꺼워 보이는 현상 해결:
 *   - footer 우측 영역의 border-l 제거 (main의 border-l과 중복 제거)
 *   - footer 자체에 1px 세로선을 pseudo-element로 그림
 *   - top-px로 시작하여 border-t와 겹치지 않게 처리 (코너 두께 방지)
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
    // ✅ footer 세로 경계선은 pseudo-element로 1px만 그림
    // ✅ after:top-px 로 시작해서 border-t(상단선)과 겹치지 않게 함
    <footer className="border-t border-gray-800 relative">
      <div className="flex relative">
        {/* ✅ 세로 경계선: x = 64(w-64), 1px */}
        <div className="pointer-events-none absolute left-64 top-px bottom-0 w-px bg-gray-800" />

        {/* 좌측: 사이드바 폭 유지 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* ❗ border-l 제거 (중복 원인 제거) */}
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
