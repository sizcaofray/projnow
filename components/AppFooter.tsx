// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항
 * 1) 커버페이지: 하단 푸터만 필요(좌측 메뉴줄/영역 X)
 * 2) /contents: 좌측 메뉴 색상이 footer까지 자연스럽게 이어져 보이기만 하면 됨
 * 3) footer는 1개만 (RootLayout에서만 렌더)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  // ✅ 공통 footer 스타일
  const baseClass = "shrink-0 h-12 border-t border-gray-800";

  // ✅ 커버/일반 페이지: 좌측 영역 없이 가운데 정렬
  if (!isContents) {
    return (
      <footer className={`${baseClass} bg-black`}>
        <div className="h-full px-4 flex items-center justify-center gap-6 text-sm text-gray-300">
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

  // ✅ /contents: 좌측 64는 sidebar 톤으로만 이어 보이게(메뉴가 내려오는 게 아님)
  return (
    <footer className={baseClass}>
      <div className="flex h-full">
        <div className="w-64 bg-slate-800" />
        <div className="flex-1 bg-black flex items-center justify-center gap-6 text-sm text-gray-300">
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
