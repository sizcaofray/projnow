// app/workspace/page.tsx
// - 기존 /convert 대체용 워크스페이스 페이지
// - A안(AuthGate)으로 "리다이렉트 없이" 로그인 전/후 화면만 제어

"use client";

import AuthGate from "@/lib/auth/AuthGate";
import { useAuth } from "@/lib/auth/useAuth";

export default function WorkspacePage() {
  return (
    <AuthGate
      // 로그인 전 보여줄 UI(원하시면 Datalign 로그인 카드와 동일 UI로 여기 넣어드리겠습니다)
      fallback={
        <main className="p-10">
          <h1 className="text-2xl font-bold mb-2">Workspace</h1>
          <p className="text-gray-600 dark:text-gray-300">
            업무 기능을 사용하려면 로그인해 주세요.
          </p>
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            ※ 리다이렉트 없이, 로그인 여부에 따라 화면만 제어합니다.
          </p>
        </main>
      }
    >
      <WorkspaceInner />
    </AuthGate>
  );
}

// ✅ 로그인 이후에만 렌더링되는 내부 화면
function WorkspaceInner() {
  const { user } = useAuth(); // 이미 AuthGate가 걸러주므로 user는 보통 null이 아님

  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold mb-2">Workspace</h1>
      <p className="text-gray-700 dark:text-gray-200">
        로그인 사용자: <span className="font-semibold">{user?.email ?? "Unknown"}</span>
      </p>

      <div className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <div className="font-semibold mb-2">여기에 기존 변환/업무 기능 UI를 배치</div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          다음 단계에서 기존 convert 페이지 기능을 이 영역으로 옮겨 붙이면 됩니다.
        </p>
      </div>
    </main>
  );
}
