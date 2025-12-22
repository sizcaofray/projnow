// app/page.tsx
// - ProjNow 랜딩 페이지
// - 중앙에 "시작하기" 텍스트 링크를 배치
// - 클릭 시 /contents(사이드바가 있는 메인 메뉴 화면)로 이동
// - 로그인/비로그인 모두 접근 가능

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-6">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="text-3xl font-bold">ProjNow</h1>

        <p className="mt-4 text-gray-700 dark:text-gray-300">
          업무 프로세스를 정리하고 실행을 지원하는 서비스입니다.
          <br />
          비로그인 상태에서도 둘러보고, 필요할 때 언제든 로그인할 수 있습니다.
        </p>

        {/* ✅ 중앙 "시작하기" 링크 */}
        <div className="mt-10">
          <Link
            href="/contents"
            className="text-lg font-semibold text-gray-900 underline underline-offset-4 hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300"
          >
            시작하기
          </Link>
        </div>
      </div>
    </main>
  );
}
