"use client";

// components/TopRightAuthButton.tsx
// - 모든 페이지 공통: 우측 상단 로그인/로그아웃 버튼
// - ✅ 로그인 되어야만 "구독" 버튼이 활성(클릭 가능)되도록 처리
// - ✅ users/{uid}.subscribeButtonEnabled 값을 읽어 "구독 버튼 활성/비활성" 반영
// - ✅ rules/권한 문제로 읽기 실패 시: 로그인 상태라도 안전하게 비활성 처리(원하시면 기본 활성으로 바꿀 수 있음)

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/firebase";

export default function TopRightAuthButton() {
  const { user, loading, initError } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // ✅ 구독 버튼 활성 여부 (로그인 전에는 무조건 비활성)
  const [subscribeBtnEnabled, setSubscribeBtnEnabled] = useState(false);

  // ✅ Auth 싱글톤 참조
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  // ✅ 로그인 유저의 subscribeButtonEnabled를 실시간 반영
  useEffect(() => {
    // 비로그인: 구독 버튼 비활성
    if (!user) {
      setSubscribeBtnEnabled(false);
      return;
    }

    // 로그인: 기본값은 true(필드가 없으면 활성)
    setSubscribeBtnEnabled(true);

    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.exists() ? snap.data() : null) as any;

        // 필드가 없으면 기본 true
        const enabled =
          typeof data?.subscribeButtonEnabled === "boolean"
            ? data.subscribeButtonEnabled
            : true;

        setSubscribeBtnEnabled(enabled);
      },
      () => {
        // 읽기 실패 시 비활성(원하시면 true로 바꿔도 됩니다)
        setSubscribeBtnEnabled(false);
      }
    );

    return () => unsub();
  }, [user]);

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
      {/* ✅ 구독 버튼: 로그인 + 활성 true 일 때만 클릭 가능 */}
      {user && subscribeBtnEnabled ? (
        <Link
          href="/contents/subscribe"
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-100 dark:hover:bg-gray-800"
          title="구독"
        >
          구독
        </Link>
      ) : (
        // ✅ 비로그인 또는 비활성화: 버튼은 보이되 비활성 (요구: 로그인 되어야만 활성)
        <button
          type="button"
          disabled
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm opacity-50 cursor-not-allowed dark:border-gray-800"
          title={!user ? "로그인 후 이용 가능합니다." : "관리자 설정으로 비활성화됨"}
        >
          구독
        </button>
      )}

      {/* ✅ 상태 텍스트 */}
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
