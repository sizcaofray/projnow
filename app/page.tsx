// app/page.tsx
// - ProjNow 랜딩(소개/메뉴 진입)
// - 로그인 UI는 전역 헤더(AppHeader)에서 제공
// - 비로그인 상태로도 페이지 탐색 가능(요구사항 준수)

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-2xl border p-8">
          <h1 className="text-2xl font-bold">ProjNow</h1>
          <p className="mt-3 text-gray-700 dark:text-gray-200">
            업무 프로세스를 정리하고 실행을 지원하는 워크스페이스입니다.
            비로그인 상태에서도 기능을 둘러보고, 필요할 때 우측 상단에서 로그인할 수 있습니다.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            {/* ✅ 예시 메뉴(추후 확장) */}
            <Link
              href="/workspace"
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900"
            >
              Workspace
            </Link>

            {/* 필요 시 여기부터 추가 메뉴 링크 확장 */}
          </div>
        </section>
      </div>
    </main>
  );
}
