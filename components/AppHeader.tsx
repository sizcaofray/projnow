// components/AppHeader.tsx
// - 모든 페이지 공통 상단 헤더
// - 좌측: 서비스명 ProjNow
// - 우측: TopRightAuthButton (로그인/비로그인 공통)

import Link from "next/link";
import TopRightAuthButton from "@/components/TopRightAuthButton";

export default function AppHeader() {
  return (
    <header className="w-full px-6 py-5">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        {/* ✅ 좌측: 서비스명 / 홈 링크 */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold">ProjNow</span>
          <span className="text-sm text-gray-600 dark:text-gray-300">
            업무 프로세스 지원툴
          </span>
        </Link>

        {/* ✅ 우측: 로그인/로그아웃 버튼 */}
        <TopRightAuthButton />
      </div>
    </header>
  );
}
