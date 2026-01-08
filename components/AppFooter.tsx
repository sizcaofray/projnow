// components/AppFooter.tsx
"use client";

/**
 * 목표
 * - Footer에서 색을 "결정하지 않는다"
 * - 배경색/글자색은 부모 레이아웃에서 상속
 * - 다크모드/라이트모드 토글에 의해 강제 색상 변경 없음
 * - Footer는 레이아웃 요소만 담당
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  return (
    <footer
      className="
        shrink-0 h-12
        border-t border-gray-300
        bg-transparent
        text-inherit
      "
    >
      <div className="flex h-full">
        {/* /contents 인 경우에만 좌측 64px 영역 확보 (색은 상속/투명) */}
        {isContents && <div className="w-64" />}

        {/* Footer 본문: 부모 색상 그대로 사용 */}
        <div className="flex-1 flex items-center justify-center gap-6 text-sm">
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
