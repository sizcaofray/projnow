// components/AppHeader.tsx
// - 모든 페이지 공통 상단 헤더
// - ✅ 좌측 끝: ProjNow
// - ✅ 우측 끝: 구독 버튼 + 로그인 사용자 메일 + 로그인/로그아웃
// - ✅ 헤더 높이를 h-16(64px)로 고정하여 페이지 높이 계산(스크롤) 안정화

import Link from "next/link";
import TopRightAuthButton from "@/components/TopRightAuthButton";

export default function AppHeader() {
  return (
    <header className="w-full h-16 px-4 border-b border-gray-200 dark:border-gray-800 flex items-center">
      {/* ✅ max-w 컨테이너 제거: 좌/우 끝 정렬 */}
      <div className="w-full flex items-center justify-between">
        {/* ✅ 좌측: 서비스명 */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold">ProjNow</span>
        </Link>

        {/* ✅ 우측: 구독 + 로그인 정보 + 로그인/로그아웃 */}
        <TopRightAuthButton />
      </div>
    </header>
  );
}
