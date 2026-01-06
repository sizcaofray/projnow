"use client";

// components/TopRightAuthButton.tsx
// - 모든 페이지 공통: 우측 상단 로그인/로그아웃 버튼
// - ✅ 구독 버튼을 로그인 정보(메일) 앞에 배치
// - ✅ 다크/라이트에서 자연스럽게 보이도록 색상 클래스 명시

import Link from "next/link";
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

  const errorMsg = initError || actionError;

  return (
    <div className="flex items-center gap-3 justify-end">
      {/* ✅ (2) 구독 버튼: “로그인 정보(메일)” 바로 앞 */}
      <Link
        href="/contents/subscribe"
        className="px-3 py-1.5 rounded border border-gray-200 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
        title="구독"
      >
        구독
      </Link>

      {/* ✅ 로그인 사용자 메일 */}
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

      {/* ✅ 에러는 헤더를 망치지 않게 작게 표시 */}
      {errorMsg ? (
        <span className="hidden max-w-[260px] truncate text-xs text-red-600 dark:text-red-300 md:inline">
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}
