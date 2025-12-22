"use client";

// lib/auth/AuthGate.tsx
// - 로그인 상태가 필요할 때 감싸는 게이트 컴포넌트
// - 요구사항상 "강제 리다이렉트"는 하지 않음
// - useAuth()의 반환 필드명(user, loading, initError)에 맞춰 타입 에러 해결

import { ReactNode } from "react";
import { useAuth } from "@/lib/auth/useAuth";

type AuthGateProps = {
  children: ReactNode;
  /** 로그인/초기화 오류/비로그인 상태일 때 표시할 UI */
  fallback?: ReactNode;
};

export default function AuthGate({ children, fallback }: AuthGateProps) {
  const { user, loading, initError } = useAuth();

  // ✅ 로딩 중
  if (loading) {
    return (
      fallback ?? (
        <div className="p-6 text-sm text-gray-600 dark:text-gray-300">
          Loading...
        </div>
      )
    );
  }

  // ✅ Firebase 초기화 에러(환경변수 누락 등)
  if (initError) {
    return (
      fallback ?? (
        <div className="p-6 text-sm text-red-600 dark:text-red-300">
          {initError}
        </div>
      )
    );
  }

  // ✅ 비로그인
  if (!user) {
    return (
      fallback ?? (
        <div className="p-6 text-sm text-gray-600 dark:text-gray-300">
          로그인 후 이용 가능합니다. (우측 상단에서 로그인)
        </div>
      )
    );
  }

  // ✅ 로그인 완료
  return <>{children}</>;
}
