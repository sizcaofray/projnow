"use client";

// components/TopRightAuthButton.tsx
// - 모든 페이지 공통: 우측 상단 로그인/로그아웃 버튼
// - 비로그인 상태에서도 언제든 로그인 가능 (요구사항 핵심)
// - 강제 리다이렉트 없음
// - "업로드된 page.tsx의 로그인 구현 방식"을 참고(버튼/로직/disabled 처리)

import { useMemo, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth } from "@/lib/firebase/client";

export default function TopRightAuthButton() {
  const { user, loading, initError } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // ✅ Auth 싱글톤 참조
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  /** Google 로그인 */
  const handleLogin = async () => {
    try {
      setActionError("");
      if (!auth) {
        setActionError("Firebase Auth 초기화에 실패했습니다. 환경변수를 확인해주세요.");
        return;
      }

      setAuthBusy(true);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      setActionError(e?.message ?? "로그인 중 오류가 발생했습니다.");
    } finally {
      setAuthBusy(false);
    }
  };

  /** 로그아웃 */
  const handleLogout = async () => {
    try {
      setActionError("");
      if (!auth) return;

      setAuthBusy(true);
      await signOut(auth);
    } catch (e: any) {
      setActionError(e?.message ?? "로그아웃 중 오류가 발생했습니다.");
    } finally {
      setAuthBusy(false);
    }
  };

  // 초기화 에러(환경변수 누락 등) 또는 액션 에러 메시지
  const errorMsg = initError || actionError;

  return (
    <div className="flex items-center gap-3">
      {/* ✅ 상태 텍스트는 작게 (원하시면 제거 가능) */}
      <div className="hidden text-sm text-gray-600 dark:text-gray-300 sm:block">
        {loading ? "..." : user ? user.email ?? "Signed in" : "Guest"}
      </div>

      {/* ✅ 로그인/로그아웃 버튼 */}
      {user ? (
        <button
          onClick={handleLogout}
          disabled={loading || authBusy}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {authBusy ? "..." : "Logout"}
        </button>
      ) : (
        <button
          onClick={handleLogin}
          disabled={loading || authBusy}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {authBusy ? "..." : "Google Login"}
        </button>
      )}

      {/* ✅ 에러는 헤더를 망치지 않게 아주 작게 표시 */}
      {errorMsg ? (
        <span className="hidden max-w-[260px] truncate text-xs text-red-600 dark:text-red-300 md:inline">
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}
