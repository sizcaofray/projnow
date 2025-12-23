// app/contents/page.tsx
// - /contents 메인 화면
// - 실제 기능들은 Sidebar로 진입하도록 유도

import Link from "next/link";

export default function ContentsHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ProjNow Dashboard</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        좌측 메뉴에서 기능을 선택하세요. 비로그인 상태에서도 사용하다가 우측 상단에서 언제든 로그인할 수 있습니다.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/workspace" className="rounded-2xl border p-5 hover:bg-gray-50 dark:hover:bg-gray-900">
          <div className="text-base font-semibold">Workspace</div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">작업 공간(예시)</div>
        </Link>

        <Link href="/contents/menu" className="rounded-2xl border p-5 hover:bg-gray-50 dark:hover:bg-gray-900">
          <div className="text-base font-semibold">Menu Manage</div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">메뉴 생성/수정/비활성/권한 관리</div>
        </Link>
      </div>
    </div>
  );
}
