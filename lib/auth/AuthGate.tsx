// lib/auth/AuthGate.tsx
// - A안(리다이렉트 없이 조건부 렌더링) 가드 컴포넌트
// - 로그인 전: 로그인 안내 UI 렌더링
// - 로그인 후: children(보호된 기능 UI) 렌더링

"use client";

import { ReactNode } from "react";
import { useAuth } from "@/lib/auth/useAuth";

type AuthGateProps = {
  children: ReactNode;
  // 로그인 전 노출할 UI를 커스터마이즈하고 싶을 때 사용
  fallback?: ReactNode;
};

export default function AuthGate({ children, fallback }: AuthGateProps) {
  const { user, loading, errorMsg } = useAuth();

  // 로딩 중 표시
  if (loading) {
    return (
      <div className="p-10">
        <p className="text-gray-600 dark:text-gray-300">로그인 상태 확인 중...</p>
      </div>
    );
  }

  // 환경변수 누락 등 오류 표시
  if (errorMsg) {
    return (
      <div className="p-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {errorMsg}
        </div>
      </div>
    );
  }

  // 로그인 전: fallback UI
  if (!user) {
    return (
      fallback ?? (
        <div className="p-10">
          <h2 className="text-xl font-bold mb-2">로그인이 필요합니다</h2>
          <p className="text-gray-600 dark:text-gray-300">
            이 페이지의 기능은 로그인 후에 사용할 수 있습니다.
          </p>
          {/* ⚠️ 여기서는 리다이렉트 하지 않습니다(A안).
              사용자는 직접 로그인 화면에서 로그인 후 다시 접근하면 됩니다. */}
        </div>
      )
    );
  }

  // 로그인 후: 보호된 UI 렌더링
  return <>{children}</>;
}
